const test = require('node:test');
const assert = require('node:assert/strict');

function fixture(t, { paymentFails = false, wakeFails = false } = {}) {
  const paths = [
    require.resolve('../src/modules/payments/payment.service'),
    require.resolve('../src/modules/calls/call.worker'),
    require.resolve('../src/modules/payments/payment.controller'),
  ];
  const originals = paths.map((path) => require.cache[path]);
  const events = [];
  const result = { status: 'QR_GENERATED' };
  require.cache[paths[0]] = {
    id: paths[0],
    filename: paths[0],
    loaded: true,
    exports: {
      async verifyDepositPayment() {
        if (paymentFails) throw new Error('Payment not verified');
        events.push('payment-committed');
        return result;
      },
    },
  };
  require.cache[paths[1]] = {
    id: paths[1],
    filename: paths[1],
    loaded: true,
    exports: {
      requestTick() {
        events.push('worker-wake');
        if (wakeFails) throw new Error('Worker unavailable');
      },
    },
  };
  delete require.cache[paths[2]];
  t.after(() =>
    paths.forEach((path, index) => {
      if (originals[index]) require.cache[path] = originals[index];
      else delete require.cache[path];
    }),
  );
  const controller = require('../src/modules/payments/payment.controller');
  const response = {
    statusCode: 200,
    responses: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      events.push('http-response');
      this.responses.push(data);
      return this;
    },
  };
  const request = {
    user: { id: 'borrower' },
    body: {
      booking_id: 'booking',
      gateway_order_id: 'order_fixture',
      gateway_payment_id: 'pay_fixture',
    },
  };
  return { events, result, response, run: () => controller.verifyDeposit(request, response) };
}

test('confirmed deposit responds before a nonblocking call-worker wake', async (t) => {
  const f = fixture(t);
  await f.run();
  assert.deepEqual(f.events, ['payment-committed', 'http-response', 'worker-wake']);
  assert.equal(f.response.statusCode, 200);
  assert.deepEqual(f.response.responses, [f.result]);
});
test('unverified deposit never wakes the call worker', async (t) => {
  const f = fixture(t, { paymentFails: true });
  await f.run();
  assert.deepEqual(f.events, ['http-response']);
  assert.equal(f.response.statusCode, 500);
});
test('a worker error cannot change a committed payment or send a second response', async (t) => {
  const f = fixture(t, { wakeFails: true });
  await f.run();
  assert.equal(f.response.statusCode, 200);
  assert.deepEqual(f.response.responses, [f.result]);
});
