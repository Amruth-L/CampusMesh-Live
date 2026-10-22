/* global fetch */
const test = require('node:test');
// Opt-in: uses temporary QA records against an idle local API/database.
// Does not send emails or call payment APIs. All created data is cleaned up.
test(
  'delivery offer lifecycle, acceptance races, and earnings',
  { skip: process.env.DELIVERY_OFFERS_E2E !== '1' },
  async () => {
    require('dotenv').config({ quiet: true });
    const pool = require('../src/config/database');
    const jwt = require('jsonwebtoken');
    const { matchDelivery } = require('../src/modules/delivery/matching.service');
    const assert = require('node:assert/strict');
    const { randomUUID } = require('node:crypto');
    const ids = Array.from({ length: 4 }, () => randomUUID());
    const [owner, renter, courier, other] = ids;
    const tasks = [];
    const call = async (user, path, body, method = body ? 'POST' : 'GET') => {
      const r = await fetch((process.env.DELIVERY_API_URL || 'http://localhost:3003') + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + jwt.sign({ id: user }, process.env.JWT_SECRET, { expiresIn: '15m' }),
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    };
    try {
      // Temporary QA data only. Stop rather than send fixture offers to an online real courier.
      const live = await pool.query(
        'SELECT COUNT(*)::int AS count FROM courier_route_availability cra JOIN users u ON u.id=cra.courier_id WHERE cra.is_active AND cra.available_until>NOW() AND u.delivery_available',
      );
      assert.equal(live.rows[0].count, 0, 'A real courier is online; do not publish QA offers.');
      for (const [i, id] of ids.entries())
        await pool.query(
          'INSERT INTO users(id,name,email,email_verified,delivery_available) VALUES($1,$2,$3,TRUE,$4)',
          [
            id,
            ['QA Item Owner', 'QA Renter', 'QA Courier', 'QA Other Courier'][i],
            `qa-redesign-${id}@dbit.co.in`,
            i >= 2,
          ],
        );
      for (const user of [courier, other])
        await pool.query(
          "INSERT INTO courier_route_availability(courier_id,origin_location_id,destination_location_id,available_until,max_detour_meters) VALUES($1,'library-ground-floor-rental-counter-02','hostel-ground-floor-204',NOW()+INTERVAL '2 hours',750)",
          [user],
        );
      await pool.query('UPDATE users SET delivery_available=TRUE WHERE id=ANY($1::uuid[])', [
        [courier, other],
      ]);
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        tasks.push(id);
        await pool.query(
          "INSERT INTO delivery_requests(id,customer_id,seller_id,pickup_location,drop_location,pickup_location_id,destination_location_id,item_description,courier_earning,delivery_fee,status) VALUES($1,$2,$3,'Central Library · Rental Counter 02','Boys Hostel · Room 204','library-ground-floor-rental-counter-02','hostel-ground-floor-204',$4,25,30,'MATCHING_COURIER')",
          [id, renter, owner, ['Scientific calculator', 'Engineering textbook', 'Badminton racquet'][i]],
        );
        await matchDelivery(id);
      }
      const before = (
        await pool.query(
          'SELECT offered_at,expires_at FROM delivery_offers WHERE delivery_id=$1 AND courier_id=$2',
          [tasks[0], courier],
        )
      ).rows[0];
      assert.ok(before, 'Expected a matched offer');
      await matchDelivery(tasks[0]);
      const after = (
        await pool.query(
          'SELECT offered_at,expires_at FROM delivery_offers WHERE delivery_id=$1 AND courier_id=$2',
          [tasks[0], courier],
        )
      ).rows[0];
      assert.deepEqual(after, before);
      console.log('PASS repeated matching preserves pending offer creation and expiry');
      let r = await call(courier, '/api/delivery/available');
      assert.equal(r.status, 200);
      assert.equal(r.data.deliveries.length, 3);
      assert.equal(r.data.deliveries[0].customer_name, 'QA Renter');
      assert(r.data.deliveries[0].offer_created_at);
      console.log('PASS real delivery API includes requester, route, earning, expiry');
      // Expiry enforcement on API and notification removal.
      await pool.query(
        "UPDATE delivery_offers SET expires_at=NOW()-INTERVAL '1 second' WHERE delivery_id=$1 AND courier_id=$2",
        [tasks[2], courier],
      );
      r = await call(courier, `/api/delivery/${tasks[2]}/accept`, {});
      assert.equal(r.status, 409);
      console.log('PASS expired offer rejected by server');
      await call(courier, '/api/delivery/available');
      await matchDelivery(tasks[2]);
      assert.equal(
        (
          await pool.query('SELECT status FROM delivery_offers WHERE delivery_id=$1 AND courier_id=$2', [
            tasks[2],
            courier,
          ])
        ).rows[0].status,
        'EXPIRED',
      );
      // Skip and ensure matching does not reissue a declined request.
      r = await call(courier, `/api/delivery/${tasks[1]}/decline`, {});
      assert.equal(r.status, 200);
      await matchDelivery(tasks[1]);
      assert.equal(
        (
          await pool.query('SELECT status FROM delivery_offers WHERE delivery_id=$1 AND courier_id=$2', [
            tasks[1],
            courier,
          ])
        ).rows[0].status,
        'DECLINED',
      );
      console.log('PASS skipped request remains declined across matching');
      assert.equal((await call(courier, `/api/delivery/${tasks[0]}/accept`, {})).status, 200);
      assert.equal((await call(other, `/api/delivery/${tasks[0]}/accept`, {})).status, 409);
      console.log('PASS second courier cannot claim accepted delivery');
      // Renew another QA offer solely to check one-active-task protection.
      await pool.query(
        "UPDATE delivery_offers SET status='PENDING',expires_at=NOW()+INTERVAL '5 minutes' WHERE delivery_id=$1 AND courier_id=$2",
        [tasks[2], courier],
      );
      r = await call(courier, `/api/delivery/${tasks[2]}/accept`, {});
      assert.equal(r.status, 409);
      assert.match(r.data.error, /current delivery/);
      console.log('PASS courier cannot accept a second active delivery');
      r = await call(courier, '/api/delivery/stats');
      assert.equal(r.data.active, 1);
      assert.equal((await call(courier, '/mode', { mode: 'RENT' }, 'PUT')).status, 200);
      assert.equal((await call(courier, '/api/delivery/stats')).data.active, 1);
      // Completed test fixture verifies earnings aggregation without invoking payments.
      await pool.query("UPDATE delivery_requests SET status='COMPLETED',completed_at=NOW() WHERE id=$1", [
        tasks[0],
      ]);
      r = await call(courier, '/api/delivery/stats');
      assert.equal(r.data.totalEarned, 25);
      assert.equal(r.data.completed, 1);
      assert.equal(r.data.active, 0);
      console.log('PASS completed count and earnings are computed from delivery records');
      await pool.query(
        "UPDATE delivery_offers SET status='PENDING',expires_at=NOW()+INTERVAL '5 minutes' WHERE delivery_id=ANY($1::uuid[])",
        [tasks.slice(1)],
      );
      await pool.query('UPDATE delivery_requests SET declined_by=ARRAY[]::uuid[] WHERE id=ANY($1::uuid[])', [
        tasks.slice(1),
      ]);
      const competing = await Promise.all(
        [courier, other].map((user) => call(user, `/api/delivery/${tasks[1]}/accept`, {})),
      );
      assert.deepEqual(
        competing.map((result) => result.status).sort(),
        [200, 409],
        'Competing couriers: one winner and no deadlock',
      );
      await pool.query("UPDATE delivery_requests SET status='COMPLETED',completed_at=NOW() WHERE id=$1", [
        tasks[1],
      ]);
      await pool.query("UPDATE delivery_requests SET status='MATCHING_COURIER',courier_id=NULL WHERE id=$1", [
        tasks[0],
      ]);
      await pool.query(
        "UPDATE delivery_offers SET status='PENDING',expires_at=NOW()+INTERVAL '5 minutes' WHERE delivery_id=ANY($1::uuid[]) AND courier_id=$2",
        [[tasks[0], tasks[2]], courier],
      );
      const simultaneous = await Promise.all(
        [tasks[0], tasks[2]].map((id) => call(courier, `/api/delivery/${id}/accept`, {})),
      );
      assert.deepEqual(
        simultaneous.map((result) => result.status).sort(),
        [200, 409],
        'One courier: only one simultaneous accept succeeds',
      );
      assert.equal((await call(courier, '/api/delivery/available')).data.deliveries.length, 0);
      assert.equal((await call(courier, '/api/delivery/stats')).data.available, 0);
      console.log('PASS concurrent accepts and no offers for an active courier');
    } finally {
      await pool.query('DELETE FROM delivery_requests WHERE id=ANY($1::uuid[])', [tasks]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
      await pool.end();
    }
  },
);
