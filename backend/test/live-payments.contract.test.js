const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');

test('live payment lifecycle with isolated database and fake gateway', { skip: process.env.EVIDENCE_E2E !== '1', timeout: 180000 }, async t => {
  const db = require('../src/config/database');
  const scope = (await db.query('SELECT current_schema() s,current_schemas(false) schemas')).rows[0];
  assert(scope.s.startsWith('qa_') && !scope.schemas.includes('public'));
  const [owner, borrower, stranger] = Array.from({ length: 3 }, randomUUID);
  const orders = new Map(), payments = new Map(), refunds = new Map(), requests = [];
  let creates = 0, loseRefundResponse = false, wakeCount = 0;
  const gateway = {
    orders: {
      async create(data) { const row = { ...data, id: 'order_' + randomUUID().replaceAll('-', ''), status: 'created' }; orders.set(row.id, row); creates++; return row; },
      async fetch(id) { assert(orders.has(id)); return orders.get(id); },
      async fetchPayments(id) { return { items: [...payments.values()].filter(p => p.order_id === id) }; },
    },
    payments: { async fetch(id) { assert(payments.has(id)); return payments.get(id); } },
    refunds: { async fetch(id) { return [...refunds.values()].find(r => r.id === id); } },
  };
  const submit = async (paymentId, body, key) => {
    requests.push({ paymentId, body, key });
    if (!refunds.has(key)) refunds.set(key, { id: 'rfnd_' + randomUUID().replaceAll('-', ''), payment_id: paymentId, amount: body.amount, currency: 'INR', status: 'pending' });
    if (loseRefundResponse) throw new Error('Lost response after provider accepted refund');
    return refunds.get(key);
  };
  const payment = require('../src/modules/payments/payment.service').createPaymentService({ db, gateway, simulation: () => false, publish: () => {} });
  const refundService = require('../src/modules/payments/refund.service').createRefundService({ db, gateway, submit });
  const webhook = require('../src/modules/payments/payment-webhook').createWebhook({ db, payment, refunds: refundService,
    checkout: {}, wishes: {}, secret: () => 'fixture-webhook', wake: () => { wakeCount++; } });
  async function notify(event, id = randomUUID(), wrongSignature = false) {
    const body = Buffer.from(JSON.stringify(event));
    const headers = { 'x-razorpay-event-id': id, 'x-razorpay-signature': createHmac('sha256', 'fixture-webhook').update(body).digest('hex') };
    if (wrongSignature) headers['x-razorpay-signature'] = '0'.repeat(64);
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await webhook({ body, get: key => headers[key] }, res); return res;
  }
  const fixture = async (status = 'DEPOSIT_PENDING') => {
    const listing = (await db.query("INSERT INTO listings(owner_id,title,description,category,rent_price,deposit) VALUES($1,'QA lifecycle','Fixture only','Electronics',20,100) RETURNING id", [owner])).rows[0].id;
    const rental = (await db.query(`INSERT INTO rentals(listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,booking_amount,deposit_amount,status,owner_response)
      VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+1,2,40,40,100,$4,'ACCEPTED') RETURNING id`, [listing, owner, borrower, status])).rows[0].id;
    await db.query("INSERT INTO payments(rental_id,payment_type,amount,status,transaction_id) VALUES($1,'RENTAL',40,'PAID',$2)", [rental, 'pay_' + randomUUID().replaceAll('-', '')]);
    return rental;
  };
  const capture = orderId => {
    const order = orders.get(orderId); order.status = 'paid';
    const paid = { id: 'pay_' + randomUUID().replaceAll('-', ''), order_id: orderId, amount: order.amount, currency: 'INR', status: 'captured', captured: true };
    payments.set(paid.id, paid); return paid;
  };
  let rental, paid;
  try {
    for (const user of [owner, borrower, stranger]) await db.query("INSERT INTO users(id,name,email,email_verified) VALUES($1,'QA lifecycle',$2,TRUE)", [user, user + '@dbit.co.in']);
    await t.test('deposit clicks serialize and reuse one order; non-borrowers cannot pay', async () => {
      rental = await fixture();
      await assert.rejects(payment.createDepositOrder(rental, stranger), e => e.status === 403);
      const [a, b] = await Promise.all([payment.createDepositOrder(rental, borrower), payment.createDepositOrder(rental, borrower)]);
      assert.equal(a.order_id, b.order_id); assert.equal(creates, 1);
      paid = capture(a.order_id);
    });
    await t.test('invalid signatures cannot settle; signed webhook recovers lost callback once', async () => {
      const event = { event: 'payment.captured', payload: { payment: { entity: paid } } }, id = randomUUID();
      assert.equal((await notify(event, id, true)).code, 400);
      assert.equal((await db.query('SELECT status FROM rentals WHERE id=$1', [rental])).rows[0].status, 'DEPOSIT_PENDING');
      assert.equal((await notify(event, id)).code, 200);
      assert.equal((await notify(event, id)).code, 200);
      assert.equal((await notify(event)).code, 200);
      assert.equal(wakeCount, 1);
      assert.equal((await db.query('SELECT payment_status FROM rentals WHERE id=$1', [rental])).rows[0].payment_status, 'FULLY_PAID');
      assert.equal((await payment.createDepositOrder(rental, borrower)).already_paid, true);
      assert.equal((await db.query("SELECT count(*)::int n FROM transaction_events WHERE rental_id=$1 AND event_type='DEPOSIT_PAID'", [rental])).rows[0].n, 1);
    });
    await t.test('wrong amount and cancelled booking cannot activate deposits', async () => {
      const id = await fixture(); const order = await payment.createDepositOrder(id, borrower); const p = capture(order.order_id);
      p.amount = 1; await assert.rejects(payment.verifyDepositPayment(id, order.order_id, p.id, null, borrower));
      p.amount = 10000; await db.query("UPDATE rentals SET status='CANCELLED' WHERE id=$1", [id]);
      await assert.rejects(payment.verifyDepositPayment(id, order.order_id, p.id, null, borrower));
    });
    await t.test('refund requires owner, physical return and valid deduction', async () => {
      await assert.rejects(refundService.request(rental, borrower), e => e.status === 403);
      await assert.rejects(refundService.request(rental, owner), e => e.status === 409);
      await db.query("UPDATE rentals SET status='RETURN_PENDING' WHERE id=$1", [rental]);
      await assert.rejects(refundService.request(rental, owner, -1), e => e.status === 400);
      await assert.rejects(refundService.request(rental, owner, 101, 'Damage'), e => e.status === 400);
      await assert.rejects(refundService.request(rental, owner, 10), e => e.status === 400);
      assert.equal(requests.length, 0);
    });
    await t.test('lost refund response persists UNKNOWN and retries identical request safely', async () => {
      loseRefundResponse = true;
      assert.equal((await refundService.request(rental, owner, 20, 'Scratch')).refund_status, 'UNKNOWN');
      assert.equal((await db.query('SELECT deposit_status FROM rentals WHERE id=$1', [rental])).rows[0].deposit_status, 'REFUND_PENDING');
      await assert.rejects(refundService.request(rental, owner, 30, 'Scratch'), e => e.status === 409);
      loseRefundResponse = false;
      assert.equal((await refundService.request(rental, owner, 20, 'Scratch')).refund_status, 'PENDING');
      assert.deepEqual(requests[0], requests[1]); assert.equal(refunds.size, 1);
      assert.equal((await refundService.refresh(rental, borrower)).refund_status, 'PENDING');
      await assert.rejects(refundService.refresh(rental, stranger), e => e.status === 404);
    });
    await t.test('refund webhook confirms provider status; duplicates cannot regress settlement', async () => {
      const remote = [...refunds.values()][0]; remote.status = 'processed';
      const event = { event: 'refund.processed', payload: { refund: { entity: remote } } };
      assert.equal((await notify(event)).code, 200);
      assert.equal((await db.query('SELECT deposit_status FROM rentals WHERE id=$1', [rental])).rows[0].deposit_status, 'REFUNDED');
      remote.status = 'pending';
      assert.equal((await refundService.refresh(rental, borrower)).refund_status, 'PROCESSED');
      assert.equal(requests.length, 2);
    });
    await t.test('owner rejection refunds the booking fee once and preserves cancelled status', async () => {
      const id = await fixture('CANCELLED');
      await db.query("UPDATE rentals SET owner_response='REJECTED' WHERE id=$1", [id]);
      const first = await refundService.refundRejectedBooking(id, owner);
      assert.equal(first.refund_kind, 'RENTAL'); assert.equal(first.refund_amount, 40);
      const before = requests.length;
      await refundService.refresh(id, borrower);
      assert.equal(requests.length, before);
      assert.equal((await db.query('SELECT status FROM rentals WHERE id=$1', [id])).rows[0].status, 'CANCELLED');
      await assert.rejects(refundService.refundRejectedBooking(id, stranger), e => e.status === 404);
    });
    await t.test('zero refund never sends amount zero to provider', async () => {
      const before = requests.length;
      const id = await fixture('RETURN_PENDING');
      await db.query("INSERT INTO payments(rental_id,payment_type,amount,status,transaction_id) VALUES($1,'SECURITY_DEPOSIT',100,'PAID','pay_zerorefund')", [id]);
      assert.equal((await refundService.request(id, owner, 100, 'Beyond repair')).refund_status, 'NO_REFUND');
      assert.equal(requests.length, before);
    });
  } finally { await db.end(); }
});
