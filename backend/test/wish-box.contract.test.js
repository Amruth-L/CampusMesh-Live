const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const { createWishService, amountInPaise, verifySignature } = require('../src/modules/wishes/wish.service');
test('Wish prices use exact paise and signatures fail closed', () => {
  assert.equal(amountInPaise('199.95'), 19995);
  for (const value of ['0', '-1', '1.001', '1e3', '100001', 'NaN']) assert.throws(() => amountInPaise(value));
  const signature = crypto.createHmac('sha256', 'testsecret').update('order_A|pay_A').digest('hex');
  verifySignature('order_A', 'pay_A', signature, 'testsecret');
  assert.throws(() => verifySignature('order_B', 'pay_A', signature, 'testsecret'));
  assert.throws(() => verifySignature('order_A', 'sim_A', signature, 'testsecret'));
  assert.throws(() => verifySignature('order_A', 'pay_A', '', ''));
});
test(
  'Wish claim, quote, verified payment and recipient handover lifecycle',
  { skip: process.env.WISH_E2E !== '1' },
  async () => {
    const pool = require('../src/config/database');
    const { issueCredential, verifyCredential } = require('../src/modules/delivery/handover.service');
    const controller = require('../src/modules/delivery/delivery.controller');
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    const [requester, courier, other, stranger] = ids;
    const wishes = [];
    let payment;
    let orders = 0;
    const service = createWishService({
      db: pool,
      notify: () => {},
      config: () => ({ key: 'rzp_test_contract', secret: 'testsecret' }),
      gateway: {
        orders: {
          create: async (data) => ({ id: `order_Contract${++orders}`, ...data }),
          fetchPayments: async () => ({ items: payment ? [payment] : [] }),
        },
        payments: { fetch: async () => payment },
      },
    });
    const status = async (user, id, next) => {
      const result = { code: 200 };
      const res = {
        status(code) {
          result.code = code;
          return this;
        },
        json(data) {
          result.data = data;
          return this;
        },
      };
      await controller.updateStatus({ user: { id: user }, params: { id }, body: { status: next } }, res);
      return result;
    };
    try {
      for (const [i, id] of ids.entries())
        await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)', [
          id,
          ['QA Wish Requester', 'QA Wish Courier', 'QA Second Courier', 'QA Stranger'][i],
          `qa-wish-${id}@dbit.co.in`,
        ]);
      const create = async () => {
        const w = await service.create(requester, {
          title: 'QA sealed stationery order',
          details: 'One sealed order, exact contents already selected.',
          drop_location_id: 'library-ground-floor-rental-counter-02',
        });
        wishes.push(w.id);
        return w;
      };
      const w = await create();
      await assert.rejects(
        () => service.claim(requester, w.id),
        (e) => e.status === 403,
      );
      const claims = await Promise.allSettled([service.claim(courier, w.id), service.claim(other, w.id)]);
      assert.equal(claims.filter((x) => x.status === 'fulfilled').length, 1);
      const winner = claims[0].status === 'fulfilled' ? courier : other;
      const second = await create();
      await assert.rejects(
        () => service.claim(winner, second.id),
        (e) => e.status === 409,
      );
      await assert.rejects(
        () => service.quote(stranger, w.id, { amount: '240', pickup_place: 'Stationery shop' }),
        (e) => e.status === 403,
      );
      await service.quote(winner, w.id, {
        amount: '240.50',
        pickup_place: 'Campus Road Stationery',
        note: 'Agreed total for the sealed order and bringing it.',
      });
      let wish = (await service.list(requester)).requests.find((x) => x.id === w.id);
      assert.equal(wish.amount_paise, 24050);
      await assert.rejects(
        () => service.createOrder(stranger, w.id, wish.current_quote_id),
        (e) => e.status === 403,
      );
      await assert.rejects(
        () => service.createOrder(requester, w.id, crypto.randomUUID()),
        (e) => e.status === 409,
      );
      const order = await service.createOrder(requester, w.id, wish.current_quote_id);
      assert.equal(order.amount, 240.5);
      assert.equal(
        (await service.createOrder(requester, w.id, wish.current_quote_id)).order_id,
        order.order_id,
      );
      assert.equal(orders, 1);
      await assert.rejects(
        () => service.release(winner, w.id, 'withdraw'),
        (e) => e.status === 409,
      );
      await assert.rejects(
        () => service.reconcile(requester, w.id),
        (e) => e.status === 409,
      );
      const body = {
        gateway_order_id: order.order_id,
        gateway_payment_id: 'pay_Contract',
        gateway_signature: crypto
          .createHmac('sha256', 'testsecret')
          .update(`${order.order_id}|pay_Contract`)
          .digest('hex'),
      };
      await assert.rejects(
        () => service.verifyPayment(requester, w.id, { ...body, gateway_signature: '0'.repeat(64) }),
        (e) => e.status === 400,
      );
      payment = {
        id: 'pay_Contract',
        order_id: order.order_id,
        amount: 1,
        currency: 'INR',
        status: 'captured',
      };
      await assert.rejects(
        () => service.verifyPayment(requester, w.id, body),
        (e) => e.status === 409,
      );
      assert.equal(
        (await pool.query('SELECT COUNT(*)::int n FROM delivery_requests WHERE wish_request_id=$1', [w.id]))
          .rows[0].n,
        0,
      );
      payment.amount = 24050;
      payment.status = 'authorized';
      await assert.rejects(
        () => service.verifyPayment(requester, w.id, body),
        (e) => e.status === 409,
      );
      payment.status = 'captured';
      const paid = await service.verifyPayment(requester, w.id, body);
      assert.equal(paid.status, 'IN_DELIVERY');
      assert.equal((await service.verifyPayment(requester, w.id, body)).delivery_id, paid.delivery_id);
      assert.equal(
        (await pool.query('SELECT COUNT(*)::int n FROM delivery_requests WHERE wish_request_id=$1', [w.id]))
          .rows[0].n,
        1,
      );
      assert.equal((await issueCredential(paid.delivery_id, 'DELIVERY', requester)).status, 409);
      assert.equal((await status(winner, paid.delivery_id, 'IN_TRANSIT')).code, 400);
      for (const stage of ['PICKUP', 'DELIVERY']) await pool.query(`INSERT INTO handover_photos(delivery_id,stage,uploaded_by,object_key,content_hash) VALUES($1,$2,$3,$4,$5)`, [paid.delivery_id, stage, winner, `fixture/${paid.delivery_id}/${stage}`, 'a'.repeat(64)]);
      for (const next of ['GOING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'])
        assert.equal((await status(winner, paid.delivery_id, next)).code, 200);
      assert.equal((await issueCredential(paid.delivery_id, 'PICKUP', requester)).status, 404);
      assert.equal((await issueCredential(paid.delivery_id, 'DELIVERY', stranger)).status, 403);
      const credential = await issueCredential(paid.delivery_id, 'DELIVERY', requester);
      assert.match(credential.otp, /^\d{6}$/);
      await assert.rejects(
        () =>
          verifyCredential(paid.delivery_id, stranger, {
            stage: 'DELIVERY',
            method: 'OTP',
            value: credential.otp,
          }),
        (e) => e.status === 403,
      );
      await verifyCredential(paid.delivery_id, winner, {
        stage: 'DELIVERY',
        method: 'OTP',
        value: credential.otp,
      });
      assert.equal((await service.list(requester)).requests.find((x) => x.id === w.id).status, 'COMPLETED');
      await assert.rejects(
        () =>
          verifyCredential(paid.delivery_id, winner, {
            stage: 'DELIVERY',
            method: 'OTP',
            value: credential.otp,
          }),
        (e) => e.status === 409,
      );
      await service.claim(winner, second.id);
      await service.quote(winner, second.id, { amount: '99', pickup_place: 'Shop' });
      await service.release(requester, second.id, 'decline');
      assert.equal((await service.list(requester)).requests.find((x) => x.id === second.id).status, 'OPEN');
      await service.claim(winner, second.id);
      await pool.query("UPDATE wish_requests SET claim_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [
        second.id,
      ]);
      await service.expire();
      assert.equal((await service.list(requester)).requests.find((x) => x.id === second.id).courier_id, null);
      await service.release(requester, second.id, 'cancel');
    } finally {
      await pool.query('DELETE FROM handover_photos WHERE uploaded_by=ANY($1::uuid[])', [ids]);
      await pool.query(
        'UPDATE wish_requests SET current_quote_id=NULL,delivery_id=NULL WHERE id=ANY($1::uuid[])',
        [wishes],
      );
      await pool.query('DELETE FROM wish_requests WHERE id=ANY($1::uuid[])', [wishes]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
      await pool.end();
    }
  },
);
