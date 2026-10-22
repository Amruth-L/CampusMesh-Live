const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPaymentVerifier } = require('../src/middleware/verify-payment');
test('payments reject simulation, tampered signatures, uncaptured and mismatched amounts', async () => {
  const key = 'fixture-secret';
  const body = { gateway_order_id: 'order_Fixture', gateway_payment_id: 'pay_Fixture' };
  body.gateway_signature = crypto.createHmac('sha256', key).update('order_Fixture|pay_Fixture').digest('hex');
  let queries = 0;
  let payment = {
    order_id: 'order_Fixture',
    amount: 100,
    currency: 'INR',
    captured: true,
    status: 'captured',
  };
  const gateway = {
    payments: {
      fetch: async () => {
        queries++;
        return payment;
      },
    },
    orders: { fetch: async () => ({ amount: 100, currency: 'INR' }) },
  };
  const check = async (input = body, secret = key) => {
    let status = 200,
      accepted = false;
    await createPaymentVerifier({ gateway, secret: () => secret })(
      { body: input },
      {
        status: (n) => {
          status = n;
          return { json: () => {} };
        },
      },
      () => {
        accepted = true;
      },
    );
    return { status, accepted };
  };
  assert.equal((await check({ ...body, gateway_payment_id: 'sim_Fixture' })).status, 400);
  assert.equal((await check({ ...body, gateway_signature: '0'.repeat(64) })).status, 400);
  assert.equal(queries, 0);
  assert.equal((await check(body, '')).status, 503);
  assert.equal((await check()).accepted, true);
  for (const changes of [
    { status: 'authorized', captured: false },
    { amount: 99 },
    { order_id: 'order_Other' },
    { currency: 'USD' },
  ]) {
    const original = payment;
    payment = { ...payment, ...changes };
    assert.equal((await check()).status, 409);
    payment = original;
  }
});
