const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test(
  'open availability, return destinations and marketplace demand',
  { skip: process.env.OPEN_DELIVERY_E2E !== '1', timeout: 180000 },
  async (t) => {
    const pool = require('../src/config/database');
    const namespace = (
      await pool.query('SELECT current_schema() AS schema,current_schemas(false) AS schemas')
    ).rows[0];
    assert(namespace.schema.startsWith('qa_') && !namespace.schemas.includes('public'));
    const courierController = require('../src/modules/delivery/courier.controller');
    const deliveryController = require('../src/modules/delivery/delivery.controller');
    const listingsController = require('../src/modules/listings/listings.controller');
    const rentalsController = require('../src/modules/rentals/rentals.controller');
    const { requestReturn, confirmReturnDestination } = require('../src/modules/rentals/return.service');
    const { matchDelivery } = require('../src/modules/delivery/matching.service');
    const users = Array.from({ length: 6 }, () => randomUUID());
    const [owner, borrower, courier, other] = users;
    const listing = randomUUID(),
      rental = randomUUID();
    const invoke = async (handler, user, body = {}, params = {}) => {
      let code = 200,
        data;
      await handler(
        { user: { id: user }, body, params },
        {
          status(value) {
            code = value;
            return this;
          },
          json(value) {
            data = value;
            return this;
          },
        },
      );
      return { code, data };
    };
    try {
      for (const id of users)
        await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)', [
          id,
          'Delivery fixture',
          `${id}@dbit.co.in`,
        ]);
      await pool.query(
        "INSERT INTO listings(id,owner_id,title,description,category,rent_price,pickup_location_id) VALUES($1,$2,'Fixture item','Test','Books',100,'library-ground-floor-rental-counter-02')",
        [listing, owner],
      );
      await pool.query(
        `INSERT INTO rentals(id,listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,booking_amount,delivery_requested,drop_location_id,status)
      VALUES($1,$2,$3,$4,CURRENT_DATE,CURRENT_DATE+3,4,400,420,TRUE,'hostel-ground-floor-204','RENTAL_ACTIVE')`,
        [rental, listing, owner, borrower],
      );
      await t.test('four couriers go online without a route, while invalid expiry is rejected', async () => {
        for (const id of users.slice(2)) {
          const result = await invoke(courierController.upsertRoute, id, {
            availability_mode: 'OPEN',
            available_until: new Date(Date.now() + 7200000).toISOString(),
          });
          assert.equal(result.code, 201);
          assert.equal(result.data.route.origin_location_id, null);
          const current = await invoke(courierController.currentRoute, id);
          assert.equal(current.data.delivery_available, true);
          assert.equal(current.data.navigation, null);
        }
        assert.equal(
          (
            await invoke(courierController.upsertRoute, owner, {
              availability_mode: 'OPEN',
              available_until: 'bad',
            })
          ).code,
          400,
        );
      });
      let task;
      await t.test(
        'duplicate requests reuse one task and wait for the owner before broadcasting',
        async () => {
          const results = await Promise.all([
            requestReturn(rental, borrower, 'COURIER'),
            requestReturn(rental, borrower, 'COURIER'),
          ]);
          assert.equal(results[0].id, results[1].id);
          task = results[0].id;
          assert.equal(results[0].status, 'RETURN_LOCATION_PENDING');
          await matchDelivery(task);
          assert.equal((await pool.query('SELECT COUNT(*)::int n FROM delivery_offers')).rows[0].n, 0);
          const inbox = await invoke(rentalsController.getOwnerRequests, owner);
          assert.equal(inbox.data.requests[0].return_actionable, true);
          assert.equal(inbox.data.summary.pending, 1);
        },
      );
      await t.test('only the owner can choose a valid destination', async () => {
        await assert.rejects(confirmReturnDestination(rental, borrower, 'admin'), (e) => e.status === 403);
        await assert.rejects(
          confirmReturnDestination(rental, owner, 'invalid-location'),
          (e) => e.status === 422,
        );
        await confirmReturnDestination(rental, owner, 'admin');
        const offers = (await pool.query('SELECT * FROM delivery_offers WHERE delivery_id=$1', [task])).rows;
        assert.equal(offers.length, 4, 'All eligible open couriers, not just top three, receive the request');
        for (const offer of offers) assert.equal(offer.score_breakdown.availabilityMode, 'OPEN');
      });
      let newOffer;
      await t.test('changing destination replaces offers and rejects a stale acceptance', async () => {
        const old = (
          await pool.query('SELECT id FROM delivery_offers WHERE delivery_id=$1 AND courier_id=$2', [
            task,
            courier,
          ])
        ).rows[0].id;
        await confirmReturnDestination(rental, owner, 'a-block-ground-floor-101');
        newOffer = (
          await pool.query('SELECT id FROM delivery_offers WHERE delivery_id=$1 AND courier_id=$2', [
            task,
            courier,
          ])
        ).rows[0].id;
        assert.notEqual(old, newOffer);
        assert.equal(
          (await invoke(deliveryController.acceptDelivery, courier, { offer_id: old }, { id: task })).code,
          409,
        );
        assert.equal((await invoke(deliveryController.acceptDelivery, courier, {}, { id: task })).code, 409);
        const available = await invoke(deliveryController.getAvailableDeliveries, courier);
        assert.equal(available.data.deliveries[0].destination_location_id, 'a-block-ground-floor-101');
        assert.equal(available.data.deliveries[0].pickup_location_id, 'hostel-ground-floor-204');
      });
      await t.test(
        'decline persists and only one courier can accept; destination locks after acceptance',
        async () => {
          const skipped = await invoke(courierController.declineOffer, other, {}, { id: task });
          assert.equal(skipped.code, 200);
          await matchDelivery(task);
          await confirmReturnDestination(rental, owner, 'a-block-ground-floor-101');
          assert.equal(
            (await invoke(deliveryController.getAvailableDeliveries, other)).data.deliveries.length,
            0,
          );
          const competitor = users[4],
            competitorOffer = (
              await pool.query('SELECT id FROM delivery_offers WHERE delivery_id=$1 AND courier_id=$2', [
                task,
                competitor,
              ])
            ).rows[0].id;
          const results = await Promise.all([
            invoke(deliveryController.acceptDelivery, courier, { offer_id: newOffer }, { id: task }),
            invoke(
              deliveryController.acceptDelivery,
              competitor,
              { offer_id: competitorOffer },
              { id: task },
            ),
          ]);
          assert.deepEqual(results.map((x) => x.code).sort(), [200, 409]);
          await assert.rejects(confirmReturnDestination(rental, owner, 'admin'), (e) => e.status === 409);
          assert.equal((await requestReturn(rental, borrower, 'COURIER')).id, task);
        },
      );
      await t.test(
        'marketplace demand counts paid bookings and distinct non-owner viewers only',
        async () => {
          for (const user of [borrower, borrower, owner])
            await pool.query(
              "INSERT INTO listing_interactions(listing_id,user_id,interaction_type) VALUES($1,$2,'VIEW')",
              [listing, user],
            );
          let result = await invoke(listingsController.getListings, borrower);
          assert.equal(result.data[0].viewers_7d, 1);
          assert.equal(result.data[0].paid_rentals_30d, 0);
          await pool.query(
            "INSERT INTO payments(rental_id,payment_type,amount,status) VALUES($1,'RENTAL',420,'PAID')",
            [rental],
          );
          result = await invoke(listingsController.getListings, borrower);
          assert.equal(result.data[0].paid_rentals_30d, 1);
          await pool.query("UPDATE rentals SET status='CANCELLED' WHERE id=$1", [rental]);
          result = await invoke(listingsController.getListings, borrower);
          assert.equal(result.data[0].paid_rentals_30d, 0);
        },
      );
      await t.test('offline courier cannot receive or accept new offers', async () => {
        await invoke(courierController.deactivateRoute, users[5]);
        const result = await invoke(deliveryController.getAvailableDeliveries, users[5]);
        assert.equal(result.data.availability.online, false);
        assert.equal(result.data.deliveries.length, 0);
        assert.equal((await invoke(deliveryController.acceptDelivery, users[5], {}, { id: task })).code, 403);
      });
    } finally {
      await pool.end();
    }
  },
);
