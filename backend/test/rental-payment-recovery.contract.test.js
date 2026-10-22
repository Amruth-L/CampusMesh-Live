const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Opt in only through a disposable PostgreSQL schema with no public fallback.
// The gateway and realtime publisher are fakes: this suite never creates a charge or calls a provider.
test('captured rental payments recover once and become actionable lender requests', {
  skip: process.env.RENTAL_PAYMENT_RECOVERY_E2E !== '1', timeout: 180000,
}, async (t) => {
  require('dotenv').config({ quiet: true });
  const pool = require('../src/config/database');
  const users = Array.from({ length: 3 }, () => randomUUID());
  const [ownerId, borrowerId, otherId] = users;
  const listings = [];
  const orders = new Map();
  const providerPayments = new Map();
  const providerReads = [];
  const emitted = [];
  let createAttempts = 0;
  let isolated = false;

  const gateway = {
    orders: {
      async create() {
        createAttempts += 1;
        throw new Error('This regression must not create a provider order.');
      },
      async fetch(id) {
        providerReads.push(['order', id]);
        assert(orders.has(id), 'Only fake fixture orders may be inspected');
        return { ...orders.get(id).order };
      },
      async fetchPayments(id) {
        providerReads.push(['order-payments', id]);
        assert(orders.has(id), 'Only fake fixture orders may be inspected');
        return { items: orders.get(id).payments.map(payment => ({ ...payment })) };
      },
    },
    payments: {
      async fetch(id) {
        providerReads.push(['payment', id]);
        assert(providerPayments.has(id), 'Only fake fixture payments may be inspected');
        return { ...providerPayments.get(id) };
      },
    },
  };

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
    assert(tables.every(row => row.schema === namespace.schema), 'All test tables must belong to the isolated schema');
    const escapedReferences = (await pool.query(
      `SELECT c.conname FROM pg_constraint c JOIN pg_class source ON source.oid=c.conrelid
       JOIN pg_namespace sn ON sn.oid=source.relnamespace JOIN pg_class target ON target.oid=c.confrelid
       JOIN pg_namespace tn ON tn.oid=target.relnamespace
       WHERE c.contype='f' AND sn.nspname=$1 AND tn.nspname<>$1`, [namespace.schema],
    )).rows;
    assert.deepEqual(escapedReferences, [], 'No test foreign key may reference another schema');
    isolated = true;

    for (const [index, id] of users.entries()) {
      await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)',
        [id, `QA payment recovery ${index}`, `qa-recovery-${id}@dbit.co.in`]);
    }
    const { createPaymentService } = require('../src/modules/payments/payment.service');
    const service = createPaymentService({ db: pool, gateway, simulation: () => false, publish: (...args) => emitted.push(args) });
    const controller = require('../src/modules/rentals/rentals.controller');
    const queue = async () => {
      const response = { status: 200, data: null };
      await controller.getOwnerRequests({ user: { id: ownerId } }, {
        status(value) { response.status = value; return this; },
        json(data) { response.data = data; return this; },
      });
      assert.equal(response.status, 200);
      return response.data;
    };
    const fixture = async (providerStatus = 'created', withOrder = true) => {
      const listingId = randomUUID();
      const rentalId = randomUUID();
      const suffix = rentalId.replaceAll('-', '');
      const orderId = `order_fixture${suffix}`;
      const paymentId = `pay_fixture${suffix}`;
      listings.push(listingId);
      await pool.query(
        `INSERT INTO listings(id,owner_id,title,description,category,rent_price,deposit,delivery_available)
         VALUES($1,$2,'QA captured payment recovery','Fixture only','Electronics',200,500,FALSE)`, [listingId, ownerId],
      );
      await pool.query(
        `INSERT INTO rentals(id,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,
          rental_fee,delivery_fee,platform_fee,booking_amount,deposit_amount,status,booking_status,payment_status)
         VALUES($1,$2,$3,$4,CURRENT_DATE+30,CURRENT_DATE+32,3,600,5,30,635,500,
          'BOOKING_PAYMENT_PENDING','PENDING','PENDING')`, [rentalId, listingId, borrowerId, ownerId],
      );
      if (withOrder) {
        await pool.query(
          `INSERT INTO payments(rental_id,payment_type,amount,status,transaction_id)
           VALUES($1,'RENTAL',635,'PENDING',$2)`, [rentalId, orderId],
        );
        const payment = { id: paymentId, order_id: orderId, amount: 63500, currency: 'INR',
          status: providerStatus, captured: providerStatus === 'captured' };
        orders.set(orderId, {
          order: { id: orderId, amount: 63500, currency: 'INR', status: providerStatus === 'captured' ? 'paid' : providerStatus === 'created' ? 'created' : 'attempted', notes: { booking_id: rentalId } },
          payments: providerStatus === 'created' ? [] : [payment],
        });
        providerPayments.set(paymentId, payment);
      }
      return { rentalId, orderId, paymentId };
    };
    const settlement = async (rentalId) => {
      const rental = (await pool.query('SELECT status,payment_status FROM rentals WHERE id=$1', [rentalId])).rows[0];
      const paymentCounts = (await pool.query(
        "SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='PAID')::int AS paid FROM payments WHERE rental_id=$1 AND payment_type='RENTAL'", [rentalId],
      )).rows[0];
      const eventCount = (await pool.query(
        "SELECT COUNT(*)::int AS count FROM transaction_events WHERE rental_id=$1 AND event_type='RENTAL_PAYMENT_COMPLETED'", [rentalId],
      )).rows[0].count;
      return { ...rental, ...paymentCounts, eventCount };
    };

    const captured = await fixture('captured');

    await t.test('unverified drafts are hidden and another user cannot recover their payments', async () => {
      assert.deepEqual((await queue()).summary, { pending: 0, active: 0, completed: 0, total: 0 });
      assert.deepEqual((await queue()).requests, []);
      const reads = providerReads.length;
      await assert.rejects(service.reconcileRentalPayment(captured.rentalId, otherId), error => error.status === 403);
      await assert.rejects(service.createRentalOrder(captured.rentalId, ownerId), error => error.status === 403);
      assert.equal(providerReads.length, reads, 'Authorization must be checked before provider lookup');
      assert.equal((await settlement(captured.rentalId)).paid, 0);
    });

    await t.test('captured gateway payment recovers the missed callback and exposes exactly one Accept request', async () => {
      const result = await service.reconcileRentalPayment(captured.rentalId, borrowerId);
      assert.equal(result.paid, true);
      assert.equal(result.already_paid, true);
      assert.equal(result.rental_id, captured.rentalId);
      assert.deepEqual(await settlement(captured.rentalId), {
        status: 'RENTAL_PAYMENT_COMPLETED', payment_status: 'RENTAL_PAID', total: 1, paid: 1, eventCount: 1,
      });
      const requests = await queue();
      assert.equal(requests.summary.pending, 1);
      assert.equal(requests.requests.length, 1);
      assert.equal(requests.requests[0].id, captured.rentalId);
      assert.equal(requests.requests[0].actionable, true);
      assert.equal(requests.requests[0].phase, 'PENDING');
      assert.equal(emitted.length, 2, 'Only the owner and borrower receive the one committed event');
      assert.equal(createAttempts, 0);
    });

    await t.test('repeat reconciliation and checkout reopening never duplicate settlement or create orders', async () => {
      const reads = providerReads.length;
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => service.reconcileRentalPayment(captured.rentalId, borrowerId)),
        service.createRentalOrder(captured.rentalId, borrowerId),
      ]);
      assert(results.every(result => result.paid && result.already_paid));
      assert.equal(providerReads.length, reads, 'A recorded paid rental needs no provider lookup');
      assert.equal((await settlement(captured.rentalId)).eventCount, 1);
      assert.equal((await settlement(captured.rentalId)).total, 1);
      assert.equal(emitted.length, 2);
      assert.equal(createAttempts, 0);
    });

    await t.test('an unpaid abandoned checkout stays hidden and reuses its existing order', async () => {
      const unpaid = await fixture();
      assert.equal((await service.reconcileRentalPayment(unpaid.rentalId, borrowerId)).paid, false);
      const reused = await service.createRentalOrder(unpaid.rentalId, borrowerId);
      assert.equal(reused.reused, true);
      assert.equal(reused.order_id, unpaid.orderId);
      assert.equal(createAttempts, 0);
      assert.equal((await settlement(unpaid.rentalId)).eventCount, 0);
      assert.equal((await settlement(unpaid.rentalId)).total, 1);
      assert(!(await queue()).requests.some(row => row.id === unpaid.rentalId));
      const noOrder = await fixture('created', false);
      assert.equal((await service.reconcileRentalPayment(noOrder.rentalId, borrowerId)).paid, false);
      assert.equal((await settlement(noOrder.rentalId)).total, 0);
    });

    await t.test('authorization without capture cannot become paid or reopen the gateway', async () => {
      const authorized = await fixture('authorized');
      const result = await service.reconcileRentalPayment(authorized.rentalId, borrowerId);
      assert.equal(result.paid, false);
      assert.equal(result.pending, true);
      assert.equal(result.awaiting_capture, true);
      await assert.rejects(service.createRentalOrder(authorized.rentalId, borrowerId), error => error.status === 409);
      assert.equal((await settlement(authorized.rentalId)).paid, 0);
      assert.equal((await settlement(authorized.rentalId)).eventCount, 0);
      assert.equal(createAttempts, 0);
    });

    await t.test('concurrent verified callback and reconciliation serialize into one settlement', async () => {
      const raced = await fixture('captured');
      const beforeEvents = emitted.length;
      // Callback middleware verifies provider signature/capture separately. This tests its
      // post-verification service transition competing with server-side recovery.
      const results = await Promise.all(Array.from({ length: 10 }, (_, index) => index % 2
        ? service.verifyRentalPayment(raced.rentalId, raced.orderId, raced.paymentId, 'middleware-verified-fixture', borrowerId)
        : service.reconcileRentalPayment(raced.rentalId, borrowerId)));
      assert(results.every(result => result.paid && result.already_paid));
      assert.deepEqual(await settlement(raced.rentalId), {
        status: 'RENTAL_PAYMENT_COMPLETED', payment_status: 'RENTAL_PAID', total: 1, paid: 1, eventCount: 1,
      });
      assert.equal(emitted.length - beforeEvents, 2);
      assert.equal((await queue()).requests.filter(row => row.id === raced.rentalId && row.actionable).length, 1);
      assert.equal(createAttempts, 0);
    });
  } finally {
    if (isolated) {
      await pool.query('DELETE FROM rentals WHERE listing_id=ANY($1::uuid[])', [listings]);
      await pool.query('DELETE FROM listings WHERE id=ANY($1::uuid[])', [listings]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
    }
    await pool.end();
  }
});
