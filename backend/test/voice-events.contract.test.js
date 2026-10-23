/* global Response */
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAnnouncements } = require('../src/modules/voice/announcements');

test(
  'voice events follow committed rental, delivery and payment evidence for the right participants',
  {
    skip: process.env.VOICE_E2E !== '1',
  },
  async () => {
    const db = require('../src/config/database');
    assert.match((await db.query('SELECT current_schema() s')).rows[0].s, /^qa_evidence_/);
    const [owner, renter, courier, other, listing, rental, delivery] = Array.from({ length: 7 }, () =>
      randomUUID(),
    );
    const since = new Date(Date.now() - 60000).toISOString();
    const speech = [];
    const service = createAnnouncements({
      db,
      capabilities: () => ({ enabled: true, aiConfigured: true }),
      transport: async (_, options) => {
        speech.push(JSON.parse(options.body).text);
        return new Response(Buffer.from('fixture'), { headers: { 'content-type': 'audio/mpeg' } });
      },
    });
    const all = async (user) => {
      const result = [];
      let cursor;
      for (let page = 0; page < 10; page++) {
        const updates = await service.updates(user, since, cursor);
        result.push(...updates);
        if (!updates.length) break;
        const last = updates.at(-1);
        cursor = Buffer.from(JSON.stringify([last.occurredAt, last.id])).toString('base64url');
      }
      return result;
    };
    try {
      for (const id of [owner, renter, courier, other])
        await db.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,true)', [
          id,
          'Voice fixture',
          `${id}@dbit.co.in`,
        ]);
      await db.query(
        "INSERT INTO listings(id,owner_id,title,description,category) VALUES($1,$2,'Private item name','fixture','Electronics')",
        [listing, owner],
      );
      await db.query(
        `INSERT INTO rentals(id,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,rental_fee,booking_amount,payment_method)
      VALUES($1,$2,$3,$4,CURRENT_DATE,CURRENT_DATE+2,3,20,20,'DIRECT_UPI')`,
        [rental, listing, renter, owner],
      );
      await db.query(
        `INSERT INTO delivery_requests(id,rental_id,listing_id,customer_id,seller_id,courier_id,pickup_location,status)
      VALUES($1,$2,$3,$4,$5,$6,'Campus','COURIER_ASSIGNED')`,
        [delivery, rental, listing, renter, owner, courier],
      );
      const event = (type, task = null) =>
        db.query(
          'INSERT INTO transaction_events(rental_id,delivery_id,event_type) VALUES($1,$2,$3) RETURNING id',
          [rental, task, type],
        );
      await event('OWNER_ACCEPTED');
      const assigned = (await event('COURIER_ASSIGNED', delivery)).rows[0];
      assert.equal((await all(other)).length, 0);
      assert.equal(
        (await all(courier)).length,
        1,
        'Courier hears delivery events, not private lender decisions',
      );
      assert.equal((await all(renter)).length, 2);
      await service.audio(courier, { kind: 'event', eventId: `event:${assigned.id}` });
      await assert.rejects(service.audio(other, { kind: 'event', eventId: `event:${assigned.id}` }), {
        status: 404,
      });
      assert.ok(!speech[0].includes('Private item name'));

      const payment = (
        await db.query(
          `INSERT INTO direct_upi_payments(source_key,rental_id,kind,payer_id,recipient_id,amount_paise,upi_id,payee_name,status)
      VALUES($1,$2,'DEPOSIT_REFUND',$3,$4,2000,'private@upi','Private bank name','REPORTED') RETURNING id`,
          [randomUUID(), rental, owner, renter],
        )
      ).rows[0];
      await db.query("INSERT INTO direct_upi_events(payment_id,actor_id,action) VALUES($1,$2,'REPORT')", [
        payment.id,
        owner,
      ]);
      let update = (await all(renter)).find((x) => x.id.startsWith('upi:'));
      assert.match(update.text, /not confirmed yet/);
      await service.audio(renter, { kind: 'event', eventId: update.id });
      assert.match(speech.at(-1), /Check your bank/);
      assert.ok(!speech.at(-1).includes('private@upi'));
      assert.equal(
        (await all(courier)).some((x) => x.id.startsWith('upi:')),
        false,
      );
      await db.query("UPDATE direct_upi_payments SET status='CONFIRMED',confirmed_at=NOW() WHERE id=$1", [
        payment.id,
      ]);
      await db.query("INSERT INTO direct_upi_events(payment_id,actor_id,action) VALUES($1,$2,'CONFIRM')", [
        payment.id,
        renter,
      ]);
      await assert.rejects(
        service.audio(renter, { kind: 'event', eventId: update.id }),
        { status: 404 },
        'Superseded reports do not play',
      );
      update = (await all(owner)).find((x) => x.id.startsWith('upi:'));
      assert.match(update.text, /confirmed receiving the deposit refund/);

      const pickup = (await event('PICKUP_VERIFIED', delivery)).rows[0];
      await db.query("UPDATE delivery_requests SET status='IN_TRANSIT' WHERE id=$1", [delivery]);
      assert.ok((await all(renter)).some((x) => x.id === `event:${pickup.id}`));
      await db.query(
        "UPDATE delivery_requests SET status='DELIVERY_PAYMENT_PENDING',delivery_verified_at=NOW() WHERE id=$1",
        [delivery],
      );
      await assert.rejects(service.audio(renter, { kind: 'event', eventId: `event:${pickup.id}` }), {
        status: 404,
      });
      const handover = (await event('DELIVERY_VERIFIED', delivery)).rows[0];
      update = (await all(renter)).find((x) => x.id === `event:${handover.id}`);
      assert.match(update.text, /pending fee still needs recipient confirmation/);

      // Over 20 events, including identical timestamps, must all survive paging.
      for (let n = 0; n < 25; n++) await event('EXTENSION_REQUESTED');
      const paged = await all(owner);
      assert.equal(paged.filter((x) => x.text.includes('extension was requested')).length, 25);
      assert.equal(paged.length, new Set(paged.map((x) => x.id)).size);
      await assert.rejects(service.updates(owner, since, 'bad'), { status: 400 });

      await db.query(
        "UPDATE rentals SET status='RENTAL_ACTIVE',payment_status='FULLY_PAID',end_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::date+4 WHERE id=$1",
        [rental],
      );
      const reminder = (await all(renter)).find((x) => x.id.startsWith('due:'));
      assert.match(reminder.text, /four days/);
      assert.equal(
        (await all(owner)).some((x) => x.id.startsWith('due:')),
        false,
      );
      await service.audio(renter, { kind: 'event', eventId: reminder.id });
      await db.query("UPDATE rentals SET status='RETURN_PENDING' WHERE id=$1", [rental]);
      await assert.rejects(service.audio(renter, { kind: 'event', eventId: reminder.id }), { status: 404 });
      await event('RETURN_CONFIRMED');
      await db.query("UPDATE rentals SET status='COMPLETED',deposit_status='REFUNDED' WHERE id=$1", [rental]);
      assert.equal(
        (await all(renter)).some((x) => x.id.startsWith('closed:')),
        false,
        'Pending delivery fee prevents a settled announcement',
      );
      await db.query("UPDATE delivery_requests SET status='COMPLETED' WHERE id=$1", [delivery]);
      assert.ok((await all(renter)).some((x) => x.id.startsWith('closed:')));

      // Aborted business transactions must never produce voice success.
      const client = await db.connect();
      await client.query('BEGIN');
      const rolled = (
        await client.query(
          "INSERT INTO transaction_events(rental_id,event_type) VALUES($1,'OWNER_REJECTED') RETURNING id",
          [rental],
        )
      ).rows[0];
      await client.query('ROLLBACK');
      client.release();
      await assert.rejects(service.audio(owner, { kind: 'event', eventId: `event:${rolled.id}` }), {
        status: 404,
      });

      await db.query(
        `INSERT INTO courier_route_availability(courier_id,availability_mode,available_until)
      VALUES($1,'OPEN',NOW()+INTERVAL '1 hour')`,
        [courier],
      );
      await db.query("UPDATE delivery_requests SET courier_id=NULL,status='MATCHING_COURIER' WHERE id=$1", [
        delivery,
      ]);
      const offer = (
        await db.query(
          `INSERT INTO delivery_offers(delivery_id,courier_id,match_score,expires_at)
      VALUES($1,$2,80,NOW()+INTERVAL '5 minutes') RETURNING id`,
          [delivery, courier],
        )
      ).rows[0];
      const offered = (await all(courier)).find((x) => x.id.startsWith('offer:'));
      assert.ok(offered);
      assert.equal(
        (await all(other)).some((x) => x.id.startsWith('offer:')),
        false,
      );
      await db.query("UPDATE delivery_offers SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [
        offer.id,
      ]);
      await assert.rejects(service.audio(courier, { kind: 'event', eventId: offered.id }), { status: 404 });

      const wish = (
        await db.query(
          `INSERT INTO wish_requests(requester_id,title,details,drop_location_id)
      VALUES($1,'Sensitive item title','private details','admin') RETURNING id`,
          [renter],
        )
      ).rows[0];
      assert.equal(
        (await all(other)).some((x) => x.wishId === wish.id),
        false,
      );
      await db.query('UPDATE users SET wish_available=true WHERE id=$1', [courier]);
      const wishOpen = (await all(courier)).find((x) => x.wishId === wish.id);
      assert.match(wishOpen.text, /Wish Box request/);
      await db.query("UPDATE wish_requests SET status='QUOTED',courier_id=$2,updated_at=NOW() WHERE id=$1", [
        wish.id,
        courier,
      ]);
      await assert.rejects(service.audio(courier, { kind: 'event', eventId: wishOpen.id }), { status: 404 });
      const quote = (await all(renter)).find((x) => x.wishId === wish.id);
      assert.match(quote.text, /price quote is ready/);
      await service.audio(renter, { kind: 'event', eventId: quote.id });
      assert.ok(speech.every((text) => !text.includes('Sensitive item title')));
      await db.query("UPDATE wish_requests SET status='PAYMENT_PENDING',updated_at=NOW() WHERE id=$1", [
        wish.id,
      ]);
      const wishPending = (await all(renter)).find((x) => x.wishId === wish.id);
      await service.audio(renter, { kind: 'event', eventId: wishPending.id });
      assert.match(speech.at(-1), /Payment still needs to be completed/);

      await db.query('UPDATE listings SET demo_slug=$2 WHERE id=$1', [listing, randomUUID()]);
      assert.equal(
        (await all(renter)).filter((x) => x.rentalId === rental).length,
        0,
        'Sample catalogue events remain silent',
      );
    } finally {
      await db.end();
    }
  },
);
