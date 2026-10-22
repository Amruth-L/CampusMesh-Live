const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentService } = require('../src/modules/payments/payment.service');

const rentalId = '11111111-1111-4111-8111-111111111111';
const borrowerId = '22222222-2222-4222-8222-222222222222';
const copy = (value) => JSON.parse(JSON.stringify(value));

// An isolated in-memory transaction adapter models a rental row lock. No real
// database, provider, email, socket or phone is contacted by these regressions.
function fixture({ payments = [], orders = {}, providerPayments = {}, simulation = false, status = 'BOOKING_PAYMENT_PENDING', lookupTimeoutMs = 15000 } = {}) {
  let state = {
    booking: { id: rentalId, borrower_id: borrowerId, owner_id: 'owner', booking_amount: '635.00', status },
    payments: copy(payments), events: [],
  };
  let tail = Promise.resolve();
  const stats = { creates: 0, reads: 0, publishes: [], releases: 0 };
  const db = {
    connect: async () => {
      let local, unlock;
      return {
        query: async (raw, args = []) => {
          const sql = raw.replace(/\s+/g, ' ').trim();
          const rows = (values) => ({ rows: copy(values), rowCount: values.length });
          if (sql === 'BEGIN') return rows([]);
          if (sql.startsWith('SELECT * FROM rentals WHERE')) {
            if (sql.endsWith('FOR UPDATE')) {
              const previous = tail;
              tail = new Promise((resolve) => { unlock = resolve; });
              await previous;
            }
            local = copy(state);
            return rows(args[0] === local.booking.id ? [local.booking] : []);
          }
          if (sql === 'COMMIT') {
            state = local;
            unlock?.(); unlock = null;
            return rows([]);
          }
          if (sql === 'ROLLBACK') { unlock?.(); unlock = null; return rows([]); }
          if (sql.startsWith('SELECT id, transaction_id FROM payments')) {
            return rows(local.payments.filter((p) => p.status === 'PAID').slice(0, 1));
          }
          if (sql.startsWith('SELECT * FROM payments')) {
            return rows(local.payments.filter((p) => p.status === 'PENDING' && (!args[1] || p.transaction_id === args[1])));
          }
          if (sql.startsWith('INSERT INTO payments')) {
            local.payments.push({ id: `record-${local.payments.length}`, rental_id: args[0], amount: args[1], transaction_id: args[2], status: 'PENDING' });
            return rows([]);
          }
          if (sql.startsWith('UPDATE payments SET')) {
            const record = local.payments.find((p) => p.id === args[1] && p.status === 'PENDING');
            if (!record) return rows([]);
            record.transaction_id = args[0]; record.status = 'PAID';
            return rows([{ id: record.id }]);
          }
          if (sql.startsWith('UPDATE rentals SET')) {
            local.booking.status = 'RENTAL_PAYMENT_COMPLETED';
            local.booking.payment_status = 'RENTAL_PAID';
            return rows([]);
          }
          if (sql.startsWith('INSERT INTO transaction_events')) { local.events.push(args); return rows([]); }
          throw new Error(`Unexpected fixture query: ${sql}`);
        },
        release: () => { stats.releases++; unlock?.(); },
      };
    },
  };
  const gateway = {
    orders: {
      create: async (input) => {
        const id = `order_New${++stats.creates}`;
        await Promise.resolve();
        orders[id] = { ...input, id, status: 'created' };
        return copy(orders[id]);
      },
      fetch: async (id) => {
        stats.reads++;
        if (!orders[id]) throw new Error('Provider unavailable or order inaccessible');
        return copy(orders[id]);
      },
      fetchPayments: async (id) => ({ items: Object.values(providerPayments).filter((p) => p.order_id === id).map(copy) }),
    },
    payments: { fetch: async (id) => copy(providerPayments[id]) },
  };
  const service = createPaymentService({ db, gateway, simulation: () => simulation, publish: (...args) => stats.publishes.push(args), lookupTimeoutMs });
  return { service, gateway, stats, state: () => copy(state) };
}
const pending = (extra = {}) => ({ id: 'payment-record', rental_id: rentalId, amount: '635.00', transaction_id: 'order_Existing', status: 'PENDING', ...extra });
const order = (extra = {}) => ({ id: 'order_Existing', amount: 63500, currency: 'INR', status: 'created', notes: { booking_id: rentalId }, ...extra });
const captured = (extra = {}) => ({ id: 'pay_Captured', order_id: 'order_Existing', amount: 63500, currency: 'INR', status: 'captured', captured: true, ...extra });
const recovery = (extra = {}) => fixture({
  payments: [pending()], orders: { order_Existing: order({ status: 'paid' }) },
  providerPayments: { pay_Captured: captured() }, ...extra,
});

test('simultaneous checkout retries create one payable order and reuse it', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 4 }, () => f.service.createRentalOrder(rentalId, borrowerId)));
  assert.equal(f.stats.creates, 1);
  assert.equal(new Set(results.map((r) => r.order_id)).size, 1);
  assert.equal(f.state().payments.length, 1);
  assert.equal(results.filter((r) => r.reused).length, 3);
});

test('paid provider order recovers a lost callback without a new charge', async () => {
  const f = recovery();
  const result = await f.service.createRentalOrder(rentalId, borrowerId);
  assert.equal(result.already_paid, true);
  assert.equal(result.paid, true);
  assert.equal(result.status, 'RENTAL_PAYMENT_COMPLETED');
  assert.equal(result.rental_id, rentalId);
  assert.equal(f.stats.creates, 0);
  assert.equal(f.state().payments[0].transaction_id, 'pay_Captured');
  assert.equal(f.state().payments[0].status, 'PAID');
  assert.equal(f.state().events.length, 1);
  assert.equal(f.stats.publishes.length, 2);
});

test('callback and recovery racing settle once and preserve later booking state', async () => {
  const f = recovery();
  const results = await Promise.all([
    f.service.reconcileRentalPayment(rentalId, borrowerId),
    f.service.verifyRentalPayment(rentalId, 'order_Existing', 'pay_Captured', 'middleware-already-checked', borrowerId),
    f.service.reconcileRentalPayment(rentalId, borrowerId),
  ]);
  assert(results.every((r) => r.paid));
  assert.equal(f.state().events.length, 1);
  assert.equal(f.stats.publishes.length, 2);
  const later = fixture({ status: 'DEPOSIT_PENDING', payments: [pending({ status: 'PAID', transaction_id: 'pay_Captured' })] });
  assert.equal((await later.service.createRentalOrder(rentalId, borrowerId)).status, 'DEPOSIT_PENDING');
  assert.equal((await later.service.verifyRentalPayment(rentalId, 'order_Existing', 'pay_Captured', 'checked', borrowerId)).status, 'DEPOSIT_PENDING');
  assert.equal(later.stats.reads, 0);
});

test('reconciliation rejects another user before reading the provider', async () => {
  const f = recovery();
  await assert.rejects(f.service.reconcileRentalPayment(rentalId, 'someone-else'), { status: 403 });
  assert.equal(f.stats.reads, 0);
  assert.equal(f.state().payments[0].status, 'PENDING');
});

test('recovery rejects mismatched local/provider amounts, currency and booking binding', async () => {
  for (const changes of [
    { payments: [pending({ amount: '600.00' })] },
    { orders: { order_Existing: order({ amount: 60000, status: 'paid' }) } },
    { orders: { order_Existing: order({ currency: 'USD', status: 'paid' }) } },
    { orders: { order_Existing: order({ notes: { booking_id: 'another-rental' }, status: 'paid' }) } },
    { providerPayments: { pay_Captured: captured({ amount: 60000 }) } },
    { providerPayments: { pay_Captured: captured({ captured: false }) } },
  ]) {
    const f = recovery(changes);
    await assert.rejects(f.service.reconcileRentalPayment(rentalId, borrowerId), { status: 409 });
    assert.equal(f.state().events.length, 0);
    assert.equal(f.state().payments[0].status, 'PENDING');
    assert.equal(f.stats.creates, 0);
  }
});

test('authorized payment or paid order awaiting capture proof blocks another checkout', async () => {
  for (const providerPayments of [
    { pay_Captured: captured({ status: 'authorized', captured: false }) }, {},
  ]) {
    const f = recovery({ providerPayments });
    const result = await f.service.reconcileRentalPayment(rentalId, borrowerId);
    assert.equal(result.paid, false);
    assert.equal(result.pending, true);
    assert.equal(result.awaiting_capture, true);
    await assert.rejects(f.service.createRentalOrder(rentalId, borrowerId), { status: 409 });
    assert.equal(f.stats.creates, 0);
  }
});

test('provider uncertainty never produces a replacement charge', async () => {
  const f = fixture({ payments: [pending()] });
  await assert.rejects(f.service.reconcileRentalPayment(rentalId, borrowerId), { status: 503 });
  await assert.rejects(f.service.createRentalOrder(rentalId, borrowerId), { status: 503 });
  assert.equal(f.stats.creates, 0);
});

test('provider timeout releases the rental lock and fails closed', async () => {
  const f = fixture({ payments: [pending()], lookupTimeoutMs: 10 });
  f.gateway.orders.fetch = () => new Promise(() => {});
  await assert.rejects(f.service.createRentalOrder(rentalId, borrowerId), { status: 503 });
  assert.equal(f.stats.releases, 1);
  assert.equal(f.stats.creates, 0);
  f.gateway.orders.fetch = async () => order();
  assert.equal((await f.service.createRentalOrder(rentalId, borrowerId)).order_id, 'order_Existing');
  assert.equal(f.stats.creates, 0);
});

test('simulation records never recover as paid or become a real checkout order', async () => {
  const f = fixture({ payments: [pending({ transaction_id: 'sim_order_old' })] });
  assert.equal((await f.service.reconcileRentalPayment(rentalId, borrowerId)).paid, false);
  const result = await f.service.createRentalOrder(rentalId, borrowerId);
  assert.match(result.order_id, /^order_/);
  assert.equal(result.simulated, false);
  assert.equal(f.stats.creates, 1);
  const unavailable = fixture({ payments: [pending()], simulation: true });
  await assert.rejects(unavailable.service.createRentalOrder(rentalId, borrowerId), { status: 503 });
  assert.equal(unavailable.stats.creates, 0);
});

test('unpaid reconciliation is read-only and callback cannot overwrite cancelled or mismatched rentals', async () => {
  const empty = fixture();
  assert.equal((await empty.service.reconcileRentalPayment(rentalId, borrowerId)).paid, false);
  assert.equal(empty.stats.creates, 0);
  for (const options of [
    { payments: [pending()], status: 'CANCELLED' },
    { payments: [pending({ amount: '600.00' })] },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.service.verifyRentalPayment(rentalId, 'order_Existing', 'pay_Captured', 'checked', borrowerId), { status: 409 });
    assert.equal(f.state().payments[0].status, 'PENDING');
    assert.equal(f.state().events.length, 0);
  }
});

test('reconciliation refuses multiple captured orders without making another charge', async () => {
  const f = recovery({
    payments: [pending(), pending({ id: 'second-record', transaction_id: 'order_Second' })],
    orders: { order_Existing: order({ status: 'paid' }), order_Second: order({ id: 'order_Second', status: 'paid' }) },
    providerPayments: {
      pay_Captured: captured(),
      pay_Second: captured({ id: 'pay_Second', order_id: 'order_Second' }),
    },
  });
  await assert.rejects(f.service.reconcileRentalPayment(rentalId, borrowerId), { status: 409 });
  assert.equal(f.state().events.length, 0);
  assert.equal(f.stats.creates, 0);
});

test('reconciliation endpoint authenticates requests and ignores arbitrary provider IDs', async () => {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const singleton = require('../src/modules/payments/payment.service');
  const original = singleton.reconcileRentalPayment;
  const oldSecret = process.env.JWT_SECRET;
  const calls = [];
  let server;
  try {
    process.env.JWT_SECRET = 'fixture-only-payment-recovery-secret';
    singleton.reconcileRentalPayment = async (...args) => { calls.push(args); return { paid: false }; };
    const app = express();
    app.use(express.json());
    app.use('/api/payment', require('../src/modules/payments/payment.routes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const request = (token, body) => globalThis.fetch(`http://127.0.0.1:${server.address().port}/api/payment/reconcile-rental`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    assert.equal((await request(null, { booking_id: rentalId })).status, 401);
    assert.equal(calls.length, 0);
    const token = jwt.sign({ id: borrowerId }, process.env.JWT_SECRET, { expiresIn: '1m' });
    assert.equal((await request(token, {})).status, 400);
    assert.equal(calls.length, 0);
    const response = await request(token, {
      booking_id: rentalId, user_id: 'someone-else', gateway_order_id: 'order_Unlinked', gateway_payment_id: 'pay_Unlinked',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { paid: false });
    assert.deepEqual(calls, [[rentalId, borrowerId]]);
  } finally {
    singleton.reconcileRentalPayment = original;
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});
