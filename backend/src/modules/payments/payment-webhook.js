const crypto = require('node:crypto');
const pool = require('../../config/database');

function validSignature(body, signature, secret) {
  if (!secret || !Buffer.isBuffer(body) || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function createWebhook({ db = pool, secret = () => process.env.RAZORPAY_WEBHOOK_SECRET,
  payment = require('./payment.service'), checkout = require('./checkout.service'),
  wishes = require('../wishes/wish.service').createWishService(),
  refunds = require('./refund.service').createRefundService(),
  wake = () => require('../calls/call.worker').requestTick() } = {}) {
  async function processEvent(event) {
    if (event.event.startsWith('transfer.') || event.event.startsWith('product.route.') || event.event === 'settlement.processed') {
      await require('../payouts/payout-service').createPayoutService().onWebhook(event);
      return;
    }
    if (['refund.created', 'refund.processed', 'refund.failed'].includes(event.event)) {
      const entity = event.payload?.refund?.entity;
      if (!entity?.id || !entity.payment_id) throw new Error('Missing refund entity');
      const row = (await db.query(`SELECT f.id FROM refunds f JOIN payments p ON p.id=f.payment_id
        WHERE p.transaction_id=$1 AND (f.gateway_refund_id=$2 OR f.id::text=$3) AND f.request_key IS NOT NULL`,
      [entity.payment_id, entity.id, entity.notes?.campusmesh_refund_id || ''])).rows[0];
      if (row) {
        const result = await refunds.reconcile(row.id);
        if (['UNKNOWN', 'REQUESTED'].includes(result.refund_status) || (result.refund_status === 'PENDING' && event.event !== 'refund.created')) throw new Error('Refund confirmation pending');
      }
      return;
    }
    if (!['payment.captured', 'order.paid'].includes(event.event)) return;
    const entity = event.payload?.payment?.entity;
    const orderId = entity?.order_id || event.payload?.order?.entity?.id;
    if (!/^order_[A-Za-z0-9]+$/.test(orderId || '')) throw new Error('Missing order entity');
    const row = (await db.query(`SELECT p.*,r.borrower_id FROM payments p JOIN rentals r ON r.id=p.rental_id
      WHERE p.transaction_id=$1 OR p.transaction_id=$2 ORDER BY p.created_at DESC LIMIT 1`, [orderId, entity?.id || ''])).rows[0];
    if (row) {
      if (row.status === 'PAID') return;
      if (row.payment_type === 'RENTAL') {
        const result = await payment.reconcileRentalPayment(row.rental_id, row.borrower_id);
        if (!result.paid && !result.already_paid) throw new Error('Rental capture not yet confirmed');
      } else if (row.payment_type === 'SECURITY_DEPOSIT') {
        if (!entity?.id) throw new Error('Missing deposit payment entity');
        await payment.verifyDepositPayment(row.rental_id, orderId, entity.id, null, row.borrower_id);
        try { wake(); } catch { /* The scheduled worker will retry. */ }
      }
      return;
    }
    const cart = (await db.query("SELECT user_id FROM pending_orders WHERE id=$1 AND jsonb_typeof(booking_data->'items')='array'", [orderId])).rows[0];
    if (cart) {
      const result = await checkout.reconcile(orderId, cart.user_id);
      if (!result.paid) throw new Error('Checkout capture not yet confirmed');
      return;
    }
    const wish = (await db.query(`SELECT w.id,w.requester_id FROM wish_payments p JOIN wish_requests w ON w.id=p.wish_id WHERE p.gateway_order_id=$1`, [orderId])).rows[0];
    if (wish) { await wishes.reconcile(wish.requester_id, wish.id); return; }
    // Provider may deliver before the local creation transaction commits.
    // Do not acknowledge an unbound capture and permanently lose recovery.
    throw new Error('Payment order not available for reconciliation');
  }

  return async (req, res) => {
    if (!secret()) return res.status(503).json({ error: 'Payment webhook is not configured.' });
    if (!validSignature(req.body, req.get('x-razorpay-signature'), secret())) return res.status(400).json({ error: 'Invalid payment signature.' });
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(400).json({ error: 'Invalid webhook payload.' }); }
    const hash = crypto.createHash('sha256').update(req.body).digest('hex');
    const id = req.get('x-razorpay-event-id') || hash;
    if (id.length > 255 || typeof event.event !== 'string') return res.status(400).json({ error: 'Invalid webhook event.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('campusmesh:payment-webhook')) AS acquired");
      if (!lock.rows[0].acquired) throw new Error('Another payment event is being processed');
      const seen = (await client.query('SELECT body_hash FROM payment_webhook_events WHERE event_id=$1', [id])).rows[0];
      if (seen && seen.body_hash !== hash) throw new Error('Webhook id conflict');
      if (!seen) {
        await processEvent(event);
        await client.query('INSERT INTO payment_webhook_events(event_id,body_hash,event_type) VALUES($1,$2,$3)', [id, hash, event.event]);
      }
      await client.query('COMMIT');
      return res.json({ received: true });
    } catch {
      await client.query('ROLLBACK');
      console.error('[Payment webhook] Confirmation deferred; provider retry required.');
      return res.status(503).json({ error: 'Payment confirmation pending. Retry delivery.' });
    } finally { client.release(); }
  };
}
module.exports = { createWebhook, validSignature };
