const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Run only against a disposable schema with no public-schema fallback.
test('booking retries preserve one draft and only paid requests reach the lender', {
  skip: process.env.RENTAL_BOOKING_E2E !== '1', timeout: 180000,
}, async (t) => {
  require('dotenv').config({ quiet: true });
  const pool = require('../src/config/database');
  const ids = Array.from({ length: 3 }, () => randomUUID());
  const listings = [];
  let isolated = false;
  try {
    const namespace = (await pool.query('SELECT current_schema() AS schema,current_schemas(false) AS schemas')).rows[0];
    assert(namespace.schema && namespace.schema !== 'public', 'Refusing to test against the public schema');
    assert(!namespace.schemas.includes('public'), 'Test search_path must not include public');
    const tables = (await pool.query(
      `SELECT n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.oid=ANY(ARRAY['users'::regclass,'listings'::regclass,'rentals'::regclass,
         'payments'::regclass,'transaction_events'::regclass])`,
    )).rows;
    assert.equal(tables.length, 5);
    assert(tables.every((row) => row.schema === namespace.schema), 'All test tables must be isolated');
    isolated = true;
    for (const [i, id] of ids.entries()) {
      await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)',
        [id, `QA booking ${i}`, `qa-booking-${id}@dbit.co.in`]);
    }
    const controller = require('../src/modules/rentals/rentals.controller');
    const listingController = require('../src/modules/listings/listings.controller');
    const invoke = async (handler, userId, body = {}, extra = {}) => {
      const result = { status: 200, data: null };
      await handler({ user: { id: userId }, body, ...extra }, {
        status(value) { result.status = value; return this; },
        json(data) { result.data = data; return this; },
      });
      return result;
    };
    const createListing = async () => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO listings(id,owner_id,title,description,category,rent_price,deposit,delivery_available)
         VALUES($1,$2,'QA booking retry','Fixture','Electronics',25,100,TRUE)`, [id, ids[0]],
      );
      listings.push(id);
      return id;
    };
    const dateOnly = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const selection = (listingId, extra = {}) => ({ listing_id: listingId, start_date: dateOnly(30), end_date: dateOnly(32), ...extra });
    const book = (body, userId = ids[1]) => invoke(controller.bookRental, userId, body);
    const queue = () => invoke(controller.getOwnerRequests, ids[0]);
    const assertOk = (result) => assert.ok([200, 201].includes(result.status), JSON.stringify(result));
    const paid = (rental, suffix = '') => pool.query(
      `INSERT INTO payments(rental_id,payment_type,amount,status,transaction_id)
       VALUES($1,'RENTAL',$2,'PAID',$3)`, [rental.id, rental.booking_amount, `fixture-payment-${randomUUID()}${suffix}`],
    );

    await t.test('concurrent retries and reopening checkout reuse the newest draft and original quote', async () => {
      const listingId = await createListing();
      const request = selection(listingId);
      const results = await Promise.all(Array.from({ length: 8 }, () => book(request)));
      results.forEach(assertOk);
      assert.equal(results.filter((result) => result.status === 201).length, 1);
      assert.equal(results.filter((result) => result.data.reused).length, 7);
      assert.equal(new Set(results.map((result) => result.data.rental.id)).size, 1);
      const original = results[0].data;
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM rentals WHERE listing_id=$1', [listingId])).rows[0].n, 1);
      assert.equal((await pool.query("SELECT COUNT(*)::int n FROM transaction_events WHERE rental_id=$1 AND event_type='BOOKING_CREATED'", [original.rental.id])).rows[0].n, 1);
      await pool.query('UPDATE listings SET rent_price=70,deposit=300 WHERE id=$1', [listingId]);
      await pool.query("INSERT INTO payments(rental_id,amount,status,transaction_id) VALUES($1,$2,'PENDING','fixture-order')", [original.rental.id, original.rental.booking_amount]);
      const retry = await book(request);
      assert.equal(retry.status, 200);
      assert.equal(retry.data.rental.id, original.rental.id);
      assert.deepEqual(retry.data.breakdown, original.breakdown);
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM payments WHERE rental_id=$1', [original.rental.id])).rows[0].n, 1);

      // Simulate a duplicate left by a previous deployment: latest checkout wins.
      await pool.query("UPDATE rentals SET created_at=NOW()-INTERVAL '1 day' WHERE id=$1", [original.rental.id]);
      const newerId = randomUUID();
      await pool.query(
        `INSERT INTO rentals(id,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,
          rental_fee,delivery_fee,platform_fee,booking_amount,deposit_amount,status)
         SELECT $2,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,
          rental_fee,delivery_fee,platform_fee,booking_amount,deposit_amount,status FROM rentals WHERE id=$1`,
        [original.rental.id, newerId],
      );
      assert.equal((await book(request)).data.rental.id, newerId);
    });

    await t.test('different borrower, dates, delivery mode or destination never reuse someone else’s checkout', async () => {
      const listingId = await createListing();
      const requests = [
        [selection(listingId), ids[1]],
        [selection(listingId), ids[2]],
        [selection(listingId, { end_date: dateOnly(34) }), ids[1]],
        [selection(listingId, { delivery_requested: true, drop_location_id: 'qa-drop-one' }), ids[1]],
        [selection(listingId, { delivery_requested: true, drop_location_id: 'qa-drop-two' }), ids[1]],
      ];
      const results = await Promise.all(requests.map(([body, user]) => book(body, user)));
      results.forEach(assertOk);
      assert.equal(new Set(results.map((result) => result.data.rental.id)).size, requests.length);
      const normalizedPickup = await book(selection(listingId, { drop_location_id: 'ignored-for-self-pickup' }));
      assert.equal(normalizedPickup.data.rental.id, results[0].data.rental.id);
    });

    await t.test('unpaid abandoned attempts are excluded from owner requests and cannot be accepted', async () => {
      const result = await queue();
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.requests, []);
      assert.deepEqual(result.data.summary, { pending: 0, active: 0, completed: 0, total: 0 });
      const myListings = await invoke(listingController.getMyListings, ids[0]);
      assert.equal(myListings.status, 200);
      assert(myListings.data.every((listing) => listing.request_count === 0 && listing.pending_request_count === 0));
      for (const id of listings) {
        const availability = await invoke(listingController.getAvailability, ids[1], {}, { params: { id } });
        assert.equal(availability.status, 200);
        assert.deepEqual(availability.data.blocked_ranges, [], 'Abandoned drafts must not block listing dates');
      }
      const listingId = await createListing();
      const draft = (await book(selection(listingId))).data.rental;
      const response = await invoke(controller.respondToBooking, ids[0], { rental_id: draft.id, response: 'ACCEPTED' });
      assert.equal(response.status, 400);
      assert.equal((await pool.query('SELECT status FROM rentals WHERE id=$1', [draft.id])).rows[0].status, 'BOOKING_PAYMENT_PENDING');
      await pool.query("UPDATE rentals SET status='OWNER_PENDING' WHERE id=$1", [draft.id]);
      const legacyResponse = await invoke(controller.respondToBooking, ids[0], { rental_id: draft.id, response: 'ACCEPTED' });
      assert.equal(legacyResponse.status, 409, 'Legacy status alone must never authorize accepting an unpaid request');
      const legacy = (await queue()).data.requests.find((row) => row.id === draft.id);
      assert.equal(legacy.actionable, false);
      assert.equal(legacy.blocked_by, 'BOOKING_PAYMENT');
      await pool.query("UPDATE rentals SET status='BOOKING_PAYMENT_PENDING' WHERE id=$1", [draft.id]);
    });

    await t.test('recorded payments remain visible even if the stored status still needs reconciliation', async () => {
      const listingId = await createListing();
      const draft = (await book(selection(listingId))).data.rental;
      await paid(draft);
      const result = await queue();
      const row = result.data.requests.find((request) => request.id === draft.id);
      assert.ok(row);
      assert.equal(row.actionable, false);
      assert.equal(row.blocked_by, 'PAYMENT_RECONCILIATION');
      assert.equal((await book(selection(listingId))).status, 409, 'Do not create or reuse a checkout over a recorded paid rental');
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM rentals WHERE listing_id=$1', [listingId])).rows[0].n, 1);
    });

    await t.test('a paid submitted booking has Accept and is transitioned only once', async () => {
      const listingId = await createListing();
      const draft = (await book(selection(listingId))).data.rental;
      await paid(draft);
      await pool.query("UPDATE rentals SET status='RENTAL_PAYMENT_COMPLETED',payment_status='RENTAL_PAID' WHERE id=$1", [draft.id]);
      const result = await queue();
      const row = result.data.requests.find((request) => request.id === draft.id);
      assert.equal(row.actionable, true);
      assert.equal(row.phase, 'PENDING');
      assert.equal(result.data.summary.pending, 1);
      const listing = (await invoke(listingController.getMyListings, ids[0])).data.find((item) => item.id === listingId);
      assert.equal(listing.request_count, 1);
      assert.equal(listing.pending_request_count, 1);
      const availability = await invoke(listingController.getAvailability, ids[1], {}, { params: { id: listingId } });
      assert.equal(availability.data.blocked_ranges.length, 1, 'A paid booking must block its listing dates');
      const responses = await Promise.all(Array.from({ length: 2 }, () => invoke(controller.respondToBooking, ids[0], { rental_id: draft.id, response: 'ACCEPTED' })));
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
      assert.equal((await pool.query("SELECT COUNT(*)::int n FROM transaction_events WHERE rental_id=$1 AND event_type='OWNER_ACCEPTED'", [draft.id])).rows[0].n, 1);
      assert.equal((await pool.query('SELECT status FROM rentals WHERE id=$1', [draft.id])).rows[0].status, 'DEPOSIT_PENDING');
      assert.equal((await queue()).data.requests.find((request) => request.id === draft.id).actionable, false);
    });

    await t.test('payment settlement while a retry waits on the draft lock cannot create a replacement draft', async () => {
      const listingId = await createListing();
      const request = selection(listingId);
      const draft = (await book(request)).data.rental;
      const paymentClient = await pool.connect();
      let retry;
      try {
        await paymentClient.query('BEGIN');
        const pid = (await paymentClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await paymentClient.query('SELECT id FROM rentals WHERE id=$1 FOR UPDATE', [draft.id]);
        retry = book(request);
        const deadline = Date.now() + 10000;
        let waiting = false;
        while (Date.now() < deadline) {
          waiting = (await pool.query(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting', [pid],
          )).rows[0].waiting;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert(waiting, 'The checkout retry must be waiting on the locked draft');
        await paymentClient.query(
          "INSERT INTO payments(rental_id,payment_type,amount,status,transaction_id) VALUES($1,'RENTAL',$2,'PAID','fixture-concurrent-paid')",
          [draft.id, draft.booking_amount],
        );
        await paymentClient.query("UPDATE rentals SET status='RENTAL_PAYMENT_COMPLETED',payment_status='RENTAL_PAID' WHERE id=$1", [draft.id]);
        await paymentClient.query('COMMIT');
        assert.equal((await retry).status, 409);
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM rentals WHERE listing_id=$1', [listingId])).rows[0].n, 1);
      } finally {
        await paymentClient.query('ROLLBACK');
        paymentClient.release();
        if (retry) await retry;
      }
    });

    await t.test('invalid dates and malformed delivery selection do not create drafts', async () => {
      const listingId = await createListing();
      for (const body of [
        selection(listingId, { start_date: '2027-02-30' }),
        selection(listingId, { end_date: 'invalid' }),
        selection(listingId, { delivery_requested: 'false' }),
        selection(listingId, { delivery_requested: true }),
      ]) assert.equal((await book(body)).status, 400);
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM rentals WHERE listing_id=$1', [listingId])).rows[0].n, 0);
    });
  } finally {
    if (isolated) {
      await pool.query('DELETE FROM rentals WHERE listing_id=ANY($1::uuid[])', [listings]);
      await pool.query('DELETE FROM listings WHERE id=ANY($1::uuid[])', [listings]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    }
    await pool.end();
  }
});
