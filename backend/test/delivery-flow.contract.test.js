/* global fetch */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const enabled = process.env.DELIVERY_E2E === '1';
let baseUrl = process.env.DELIVERY_API_URL || 'http://localhost:3003';

async function call(token, path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  let data = null;
  try {
    data = await response.json();
  } catch {}
  return { response, data };
}

function expectOk(result, label) {
  assert.ok(
    result.response.ok,
    `${label} failed (${result.response.status}): ${JSON.stringify(result.data)}`,
  );
  return result.data;
}

test(
  'isolated booking, paid rental details, delivery handovers and extension history',
  { skip: !enabled },
  async () => {
    require('dotenv').config({ quiet: true });
    const pool = require('../src/config/database');
    const jwt = require('jsonwebtoken');
    const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
    const listingId = crypto.randomUUID();
    let server;
    const orders = new Map();
    const events = [];
    const secret = 'fixture-gateway-secret';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
    process.env.RAZORPAY_KEY_SECRET = secret;
    const gatewayPath = require.resolve('../src/config/razorpay');
    require.cache[gatewayPath] = {
      id: gatewayPath,
      filename: gatewayPath,
      loaded: true,
      exports: {
        orders: {
          create: async (data) => {
            const order = { ...data, id: 'order_' + crypto.randomBytes(8).toString('hex') };
            orders.set(order.id, order);
            return order;
          },
          fetch: async (id) => orders.get(id),
        },
        payments: {
          fetch: async (id) => {
            const order = orders.get('order_' + id.slice(4));
            return {
              id,
              order_id: order.id,
              currency: order.currency,
              amount: order.amount,
              captured: true,
              status: 'captured',
            };
          },
        },
      },
    };
    const signatureFor = (orderId) =>
      crypto
        .createHmac('sha256', secret)
        .update(orderId + '|pay_' + orderId.slice(6))
        .digest('hex');
    const realtime = require('../src/shared/realtime');
    realtime.setIO({ to: (room) => ({ emit: (event, data) => events.push({ room, event, data }) }) });
    try {
      assert.equal(
        (
          await pool.query(
            'SELECT COUNT(*)::int n FROM courier_route_availability c JOIN users u ON u.id=c.courier_id WHERE c.is_active AND c.available_until>NOW() AND u.delivery_available',
          )
        ).rows[0].n,
        0,
        'Do not publish offers while a real courier is online',
      );
      for (const [i, id] of ids.entries())
        await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)', [
          id,
          ['QA Owner', 'QA Renter', 'QA Courier'][i],
          `qa-flow-${id}@dbit.co.in`,
        ]);
      await pool.query(
        "INSERT INTO listings(id,owner_id,title,description,category,rent_price,deposit,delivery_charge,delivery_available,pickup_location_id) VALUES($1,$2,'QA delivery calculator','Fixture','Electronics',25,100,30,TRUE,'library-ground-floor-rental-counter-02')",
        [listingId, ids[0]],
      );
      server = require('../src/app').listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;

      expectOk(await call(null, '/health'), 'health');
      const [owner, renter, courier] = ids.map((id) => ({
        user: { id },
        token: jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '10m' }),
      }));
      const ownerToken = owner.token;
      const renterToken = renter.token;
      const courierToken = courier.token;

      const listing = (await pool.query('SELECT * FROM listings WHERE id=$1', [listingId])).rows[0];
      const locations = expectOk(await call(renterToken, '/api/campus/locations'), 'campus locations');
      const destination =
        locations.find(
          (item) => item.id === 'hostel-ground-floor-204' && item.id !== listing.pickup_location_id,
        ) ||
        locations.find(
          (item) =>
            item.id === 'library-ground-floor-rental-counter-02' && item.id !== listing.pickup_location_id,
        ) ||
        locations.find((item) => item.id !== listing.pickup_location_id && item.location_type === 'ROOM');
      assert.ok(destination, 'No destination campus location available.');

      const start = new Date(Date.now() + (30 + (Date.now() % 365)) * 86400000);
      const end = new Date(start.getTime() + 86400000);
      const dateOnly = (value) => value.toISOString().slice(0, 10);
      const booking = expectOk(
        await call(renterToken, '/api/rentals/book', {
          method: 'POST',
          body: JSON.stringify({
            listing_id: listing.id,
            start_date: dateOnly(start),
            end_date: dateOnly(end),
            delivery_requested: true,
            drop_location_id: destination.id,
          }),
        }),
        'create rental',
      );
      const rentalId = booking.rental.id;

      const rentalOrder = expectOk(
        await call(renterToken, '/api/payment/create-rental-order', {
          method: 'POST',
          body: JSON.stringify({ booking_id: rentalId }),
        }),
        'create rental order',
      );
      expectOk(
        await call(renterToken, '/api/payment/verify-rental', {
          method: 'POST',
          body: JSON.stringify({
            booking_id: rentalId,
            gateway_order_id: rentalOrder.order_id,
            gateway_payment_id: 'pay_' + rentalOrder.order_id.slice(6),
            gateway_signature: signatureFor(rentalOrder.order_id),
          }),
        }),
        'verify rental payment',
      );

      const paidRental = expectOk(
        await call(renterToken, `/api/rentals/${rentalId}/status`),
        'renter details after rental payment',
      );
      assert.equal(paidRental.rental.id, rentalId);
      assert.equal(paidRental.rental.status, 'RENTAL_PAYMENT_COMPLETED');
      assert.equal(paidRental.rental.payment_status, 'RENTAL_PAID');
      assert.equal(paidRental.rental.listing_title, listing.title);
      assert.equal(paidRental.payments.length, 1);
      assert.equal(paidRental.payments[0].payment_type, 'RENTAL');
      assert.equal(paidRental.payments[0].status, 'PAID');
      assert.deepEqual(paidRental.extensions, []);
      assert.equal(paidRental.pending_extension, null);
      assert.equal(paidRental.refund, null);
      const ownerPaidRental = expectOk(
        await call(ownerToken, `/api/rentals/${rentalId}/status`),
        'owner details after rental payment',
      );
      assert.equal(ownerPaidRental.rental.status, 'RENTAL_PAYMENT_COMPLETED');
      assert.deepEqual(ownerPaidRental.payments, paidRental.payments);
      assert.equal(
        (await call(courierToken, `/api/rentals/${rentalId}/status`)).response.status,
        403,
        'An unrelated courier must not see private rental or payment details',
      );

      assert.equal(
        (await pool.query('SELECT booking_confirmed_at FROM rentals WHERE id=$1', [rentalId])).rows[0]
          .booking_confirmed_at,
        null,
        'Rental fee alone is not fully paid',
      );
      const ownerRequests = expectOk(
        await call(ownerToken, '/api/rentals/my-listings-requests'),
        'owner request queue',
      );
      const ownerRequest = ownerRequests.requests.find((request) => request.id === rentalId);
      assert.ok(ownerRequest?.actionable, 'The paid request is not actionable in the owner queue.');
      expectOk(
        await call(ownerToken, '/api/rentals/respond', {
          method: 'POST',
          body: JSON.stringify({ rental_id: rentalId, response: 'ACCEPTED' }),
        }),
        'owner accept',
      );

      const depositOrder = expectOk(
        await call(renterToken, '/api/payment/create-deposit-order', {
          method: 'POST',
          body: JSON.stringify({ booking_id: rentalId }),
        }),
        'create deposit order',
      );
      expectOk(
        await call(renterToken, '/api/payment/verify-deposit', {
          method: 'POST',
          body: JSON.stringify({
            booking_id: rentalId,
            gateway_order_id: depositOrder.order_id,
            gateway_payment_id: 'pay_' + depositOrder.order_id.slice(6),
            gateway_signature: signatureFor(depositOrder.order_id),
          }),
        }),
        'verify deposit',
      );

      const fullyPaidRental = expectOk(
        await call(renterToken, `/api/rentals/${rentalId}/status`),
        'renter details after deposit payment',
      );
      assert.equal(fullyPaidRental.rental.status, 'MATCHING_COURIER');
      assert.equal(fullyPaidRental.rental.payment_status, 'FULLY_PAID');
      assert.equal(fullyPaidRental.rental.deposit_status, 'HELD');
      assert.deepEqual(
        fullyPaidRental.payments.map(({ payment_type, status }) => ({ payment_type, status })),
        [
          { payment_type: 'RENTAL', status: 'PAID' },
          { payment_type: 'SECURITY_DEPOSIT', status: 'PAID' },
        ],
      );
      assert.deepEqual(fullyPaidRental.extensions, []);
      assert.equal(fullyPaidRental.refund, null);

      assert(
        (await pool.query('SELECT booking_confirmed_at FROM rentals WHERE id=$1', [rentalId])).rows[0]
          .booking_confirmed_at,
      );
      const routePayload = {
        origin_location_id: listing.pickup_location_id,
        destination_location_id: destination.id,
        available_until: new Date(Date.now() + 2 * 3600000).toISOString(),
        max_detour_meters: 750,
      };
      const routeSaves = await Promise.all(
        Array.from({ length: 10 }, () =>
          call(courierToken, '/api/courier/routes', {
            method: 'POST',
            body: JSON.stringify(routePayload),
          }),
        ),
      );
      assert.ok(
        routeSaves.every(({ response }) => response.status !== 500),
        'A parallel route save returned 500.',
      );
      assert.ok(
        routeSaves.some(({ response }) => response.ok),
        'No parallel route save succeeded.',
      );
      const currentRoute = expectOk(await call(courierToken, '/api/courier/routes/current'), 'current route');
      assert.ok(
        currentRoute.route && currentRoute.delivery_available,
        'Courier did not end with one active online route.',
      );

      const available = expectOk(await call(courierToken, '/api/delivery/available'), 'available deliveries');
      const offer = available.deliveries.find((delivery) => delivery.rental_id === rentalId);
      assert.ok(offer, 'Courier did not receive the rental delivery offer.');
      assert.equal(offer.customer_id, renter.user.id);
      assert.equal(offer.seller_id, owner.user.id);
      assert.equal(offer.listing_title, listing.title);
      assert.ok(
        offer.pickup_location && offer.drop_location && offer.offer_expires_at,
        'Offer is missing delivery details or expiry.',
      );

      const deliveryId = offer.delivery_id;
      assert(
        events.some(
          (e) =>
            e.room === `user:${courier.user.id}` &&
            e.event === 'delivery:offer' &&
            e.data.delivery_id === deliveryId,
        ),
        'Matched courier receives offer notification',
      );
      expectOk(
        await call(courierToken, `/api/delivery/${deliveryId}/accept`, { method: 'POST', body: '{}' }),
        'courier accept',
      );
      for (const id of ids)
        assert(
          events.some((e) => e.room === `user:${id}` && e.event === 'delivery:assigned'),
          'All participants receive assignment notification',
        );
      const active = expectOk(await call(courierToken, '/api/delivery/my-deliveries'), 'active delivery');
      assert.ok(
        active.some((delivery) => delivery.id === deliveryId && delivery.status === 'COURIER_ASSIGNED'),
      );

      expectOk(
        await call(courierToken, `/api/delivery/${deliveryId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'GOING_TO_PICKUP' }),
        }),
        'go to pickup',
      );
      expectOk(
        await call(courierToken, `/api/delivery/${deliveryId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'ARRIVED_AT_PICKUP' }),
        }),
        'arrive at pickup',
      );
      assert.equal(
        (await call(courierToken, `/api/delivery/${deliveryId}/handover/PICKUP`)).response.status,
        403,
      );
      const pickupCredential = expectOk(
        await call(ownerToken, `/api/delivery/${deliveryId}/handover/PICKUP`),
        'pickup credential',
      );
      await pool.query(`INSERT INTO handover_photos(delivery_id,stage,uploaded_by,object_key,content_hash) VALUES($1,$2,$3,$4,$5)`, [deliveryId, 'PICKUP', courier.user.id, `fixture/${deliveryId}/pickup`, 'a'.repeat(64)]);
      expectOk(
        await call(courierToken, `/api/delivery/${deliveryId}/verify-handover`, {
          method: 'POST',
          body: JSON.stringify({ stage: 'PICKUP', method: 'QR', value: pickupCredential.qr }),
        }),
        'pickup verification',
      );
      expectOk(
        await call(courierToken, `/api/delivery/${deliveryId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'ARRIVED_AT_DESTINATION' }),
        }),
        'arrive at destination',
      );
      await pool.query(`INSERT INTO handover_photos(delivery_id,stage,uploaded_by,object_key,content_hash) VALUES($1,$2,$3,$4,$5)`, [deliveryId, 'DELIVERY', courier.user.id, `fixture/${deliveryId}/delivery`, 'b'.repeat(64)]);
      const deliveryCredential = expectOk(
        await call(renterToken, `/api/delivery/${deliveryId}/handover/DELIVERY`),
        'delivery credential',
      );
      expectOk(
        await call(courierToken, `/api/delivery/${deliveryId}/verify-handover`, {
          method: 'POST',
          body: JSON.stringify({ stage: 'DELIVERY', method: 'OTP', value: deliveryCredential.otp }),
        }),
        'delivery verification',
      );

      assert(
        events.some(
          (e) =>
            e.room === `user:${renter.user.id}` &&
            e.event === 'delivery:status' &&
            e.data.status === 'COMPLETED',
        ),
      );
      const repeated = expectOk(
        await call(renterToken, '/api/payment/verify-deposit', {
          method: 'POST',
          body: JSON.stringify({
            booking_id: rentalId,
            gateway_order_id: depositOrder.order_id,
            gateway_payment_id: 'pay_' + depositOrder.order_id.slice(6),
            gateway_signature: signatureFor(depositOrder.order_id),
          }),
        }),
        'repeat payment',
      );
      assert.equal(repeated.status, 'RENTAL_ACTIVE', 'Payment replay cannot restart a delivered order');
      const history = expectOk(await call(renterToken, '/api/activity/history?limit=20'), 'renter history');
      assert.ok(
        history.records.some(
          (record) =>
            record.rental_id === rentalId && record.role === 'RENTER' && record.status === 'COMPLETED',
        ),
      );
      const finalStatus = expectOk(
        await call(renterToken, `/api/delivery/rental/${rentalId}`),
        'final rental delivery status',
      );
      assert.equal(finalStatus.status, 'COMPLETED');

      const activeRental = expectOk(
        await call(renterToken, `/api/rentals/${rentalId}/status`),
        'active rental details after handover',
      );
      assert.equal(activeRental.rental.status, 'RENTAL_ACTIVE');
      assert.equal(activeRental.rental.payment_status, 'FULLY_PAID');
      const extension = expectOk(
        await call(renterToken, `/api/rentals/${rentalId}/extend-request`, {
          method: 'POST',
          body: JSON.stringify({ additional_days: 2, reason: 'Fixture extension request' }),
        }),
        'request rental extension',
      ).extension;
      const pendingExtension = expectOk(
        await call(ownerToken, `/api/rentals/${rentalId}/status`),
        'owner details with pending extension',
      );
      assert.equal(pendingExtension.extensions.length, 1);
      assert.equal(pendingExtension.pending_extension.id, extension.id);
      assert.equal(pendingExtension.pending_extension.status, 'PENDING');
      assert.equal(pendingExtension.pending_extension.additional_days, 2);
      assert.equal(Number(pendingExtension.pending_extension.additional_fee), Number(listing.rent_price) * 2);
      assert.equal(
        (await call(renterToken, `/api/rentals/${rentalId}/extend-request`, {
          method: 'POST',
          body: JSON.stringify({ additional_days: 1 }),
        })).response.status,
        409,
        'Only one extension request can await owner approval',
      );
      assert.equal(
        (await call(renterToken, `/api/rentals/${rentalId}/extend-respond`, {
          method: 'POST',
          body: JSON.stringify({ extension_id: extension.id, decision: 'REJECTED' }),
        })).response.status,
        403,
        'The borrower cannot respond as the listing owner',
      );
      expectOk(
        await call(ownerToken, `/api/rentals/${rentalId}/extend-respond`, {
          method: 'POST',
          body: JSON.stringify({ extension_id: extension.id, decision: 'REJECTED' }),
        }),
        'owner declines extension',
      );
      const declinedExtension = expectOk(
        await call(renterToken, `/api/rentals/${rentalId}/status`),
        'renter details with declined extension history',
      );
      assert.equal(declinedExtension.pending_extension, null);
      assert.equal(declinedExtension.extensions.length, 1);
      assert.equal(declinedExtension.extensions[0].id, extension.id);
      assert.equal(declinedExtension.extensions[0].status, 'REJECTED');
      assert.ok(declinedExtension.extensions[0].responded_at);
      assert.equal(declinedExtension.rental.status, 'RENTAL_ACTIVE');
      assert.equal(declinedExtension.rental.end_date, activeRental.rental.end_date);
      assert.equal(declinedExtension.rental.rental_fee, activeRental.rental.rental_fee);
      assert.equal(declinedExtension.rental.booking_amount, activeRental.rental.booking_amount);
      assert.deepEqual(declinedExtension.payments, activeRental.payments);
      assert.equal(declinedExtension.refund, null);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      realtime.setIO(null);
      await pool.query(
        'DELETE FROM transaction_events WHERE rental_id IN (SELECT id FROM rentals WHERE listing_id=$1)',
        [listingId],
      );
      await pool.query('DELETE FROM handover_photos WHERE delivery_id IN (SELECT id FROM delivery_requests WHERE listing_id=$1)', [listingId]);
      await pool.query('DELETE FROM delivery_requests WHERE listing_id=$1', [listingId]);
      await pool.query('DELETE FROM rentals WHERE listing_id=$1', [listingId]);
      await pool.query('DELETE FROM listings WHERE id=$1', [listingId]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
      await pool.end();
    }
  },
);
