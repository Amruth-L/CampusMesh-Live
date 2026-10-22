const crypto = require('node:crypto');
const pool = require('../../config/database');
const { ensureOutboundDelivery } = require('../delivery/delivery-request.service');
const { emitUser } = require('../../shared/realtime');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const enabled = () => (process.env.DIRECT_UPI_ENABLED ?? 'true') === 'true';
const paise = (value) => {
  const n = Number(value),
    amount = Math.round(n * 100);
  if (!Number.isFinite(n) || !Number.isSafeInteger(amount) || amount < 0)
    throw fail('Invalid payment amount.');
  return amount;
};
function validateProfile(body) {
  const upi_id = String(body.upi_id || '')
    .trim()
    .toLowerCase();
  const payee_name = String(body.payee_name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!/^[a-z0-9._-]{2,128}@[a-z0-9.-]{2,64}$/.test(upi_id))
    throw fail('Enter a valid UPI ID, such as name@bank.', 400);
  if (payee_name.length < 2 || payee_name.length > 100 || /[<>\x00-\x1f]/.test(payee_name))
    throw fail('Enter the account holder name shown in your UPI app.', 400);
  if (body.confirm !== true) throw fail('Confirm that this UPI account belongs to you.', 400);
  return { upi_id, payee_name };
}
function createService({
  db = pool,
  notify = emitUser,
  match = (id) => require('../delivery/matching.service').matchDelivery(id),
  onConfirmed = () => require('../calls/call.worker').requestTick(),
} = {}) {
  async function tx(fn) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      if (e.code === '23505')
        throw fail('This transaction reference is already recorded. Check your existing payment.');
      throw e;
    } finally {
      c.release();
    }
  }
  async function announce(rental, deliveryId) {
    for (const u of [rental.owner_id, rental.borrower_id]) {
      try {
        notify(u, 'rental:status', { rental_id: rental.id });
        notify(u, 'direct-payment:updated', { rental_id: rental.id });
      } catch {
        /* State is durable. */
      }
    }
    if (deliveryId) {
      try {
        await match(deliveryId);
      } catch {
        /* Matching worker retries. */
      }
    }
  }
  async function profile(user, body) {
    if (!body)
      return (
        (await db.query('SELECT upi_id,payee_name,updated_at FROM upi_profiles WHERE user_id=$1', [user]))
          .rows[0] || null
      );
    const p = validateProfile(body);
    await db.query(
      `INSERT INTO upi_profiles(user_id,upi_id,payee_name) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET upi_id=$2,payee_name=$3,updated_at=NOW()`,
      [user, p.upi_id, p.payee_name],
    );
    return p;
  }
  async function intent(c, r, kind, payer, recipient, amount, delivery = null) {
    if (!amount) return null;
    const source = `${kind}:${delivery || r.id}`;
    const old = (await c.query('SELECT * FROM direct_upi_payments WHERE source_key=$1', [source])).rows[0];
    if (old) return old;
    const p = (await c.query('SELECT * FROM upi_profiles WHERE user_id=$1', [recipient])).rows[0];
    if (!p)
      throw fail('The recipient must save their UPI ID in Payments before this payment can be prepared.');
    return (
      await c.query(
        `INSERT INTO direct_upi_payments(source_key,rental_id,delivery_id,kind,payer_id,recipient_id,amount_paise,upi_id,payee_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_key) DO UPDATE SET source_key=EXCLUDED.source_key RETURNING *`,
        [source, r.id, delivery, kind, payer, recipient, amount, p.upi_id, p.payee_name],
      )
    ).rows[0];
  }
  async function respond(rentalId, user, response) {
    const r = await tx(async (c) => {
      const r = (await c.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [rentalId])).rows[0];
      if (!r || r.owner_id !== user) throw fail('Only the lender can respond.', 403);
      if (r.payment_method !== 'DIRECT_UPI') throw fail('This rental uses the original payment method.');
      if (!['ACCEPTED', 'REJECTED'].includes(response)) throw fail('Choose accept or reject.', 400);
      if (r.owner_response === response) return r;
      if (r.status !== 'OWNER_PENDING' || r.owner_response !== 'PENDING')
        throw fail('This request has already been answered.');
      if (response === 'ACCEPTED') {
        await intent(c, r, 'RENTAL', r.borrower_id, r.owner_id, paise(r.rental_fee));
      }
      await c.query(
        `UPDATE rentals SET owner_response=$2,owner_responded_at=NOW(),status=$3,booking_status=$4,deposit_deadline=NULL,updated_at=NOW() WHERE id=$1`,
        [
          r.id,
          response,
          response === 'ACCEPTED' ? 'BOOKING_PAYMENT_PENDING' : 'CANCELLED',
          response === 'ACCEPTED' ? 'CONFIRMED' : 'CANCELLED',
        ],
      );
      await c.query('INSERT INTO transaction_events(rental_id,event_type,actor_user_id) VALUES($1,$2,$3)', [
        r.id,
        `OWNER_${response}`,
        user,
      ]);
      return r;
    });
    await announce(r);
    return {
      message:
        response === 'ACCEPTED'
          ? 'Accepted. The renter can now pay you directly. Confirm receipt only after checking your UPI app.'
          : 'Request declined. No payment was requested.',
    };
  }
  async function prepare(rentalId, user) {
    return tx(async (c) => {
      const r = (await c.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [rentalId])).rows[0];
      if (!r || ![r.owner_id, r.borrower_id].includes(user)) throw fail('Rental not found.', 404);
      if (r.payment_method !== 'DIRECT_UPI') throw fail('This rental uses the original payment method.');
      if (r.status === 'DEPOSIT_PENDING' && r.payment_status === 'RENTAL_PAID')
        await intent(c, r, 'DEPOSIT', r.borrower_id, r.owner_id, paise(r.deposit_amount));
      if (r.status === 'COMPLETED' && r.deposit_status === 'REFUND_PENDING')
        await intent(c, r, 'DEPOSIT_REFUND', r.owner_id, r.borrower_id, paise(r.deposit_amount));
      return { ready: true };
    });
  }
  async function syncDelivery(user) {
    // A separate obligation for each completed, evidence-verified delivery leg.
    await db.query(
      `INSERT INTO direct_upi_payments(source_key,rental_id,delivery_id,kind,payer_id,recipient_id,amount_paise,upi_id,payee_name)
      SELECT (CASE WHEN d.task_type='RENTAL_RETURN' THEN 'RETURN_DELIVERY' ELSE 'DELIVERY' END)||':'||d.id,r.id,d.id,
      CASE WHEN d.task_type='RENTAL_RETURN' THEN 'RETURN_DELIVERY' ELSE 'DELIVERY' END,r.borrower_id,d.courier_id,
      ROUND(d.courier_earning*100)::bigint,p.upi_id,p.payee_name
      FROM delivery_requests d JOIN rentals r ON r.id=d.rental_id JOIN upi_profiles p ON p.user_id=d.courier_id
      WHERE r.payment_method='DIRECT_UPI' AND d.status='COMPLETED' AND d.delivery_verified_at IS NOT NULL
        AND d.task_type IN ('RENTAL_OUTBOUND','RENTAL_RETURN') AND d.courier_earning>0
        AND d.courier_id<>r.borrower_id AND d.courier_id<>r.owner_id
        AND (r.borrower_id=$1 OR r.owner_id=$1 OR d.courier_id=$1)
        AND EXISTS(SELECT 1 FROM handover_verifications h WHERE h.delivery_id=d.id AND h.status='USED'
          AND h.stage=CASE WHEN d.task_type='RENTAL_RETURN' THEN 'RETURN_RECEIVED' ELSE 'DELIVERY' END)
      ON CONFLICT(source_key) DO NOTHING`,
      [user],
    );
  }
  async function list(user, rentalId = null) {
    await syncDelivery(user);
    const rows = (
      await db.query(
        `SELECT p.*,l.title,payer.name AS payer_name,recipient.name AS recipient_name
      FROM direct_upi_payments p JOIN rentals r ON r.id=p.rental_id JOIN listings l ON l.id=r.listing_id
      JOIN users payer ON payer.id=p.payer_id JOIN users recipient ON recipient.id=p.recipient_id
      WHERE (p.payer_id=$1 OR p.recipient_id=$1) AND ($2::uuid IS NULL OR p.rental_id=$2) ORDER BY p.created_at`,
        [user, rentalId],
      )
    ).rows;
    return rows.map((p) => ({
      ...p,
      amount: Number(p.amount_paise) / 100,
      uri:
        p.status === 'PENDING' && p.payer_id === user
          ? 'upi://pay?' +
            new URLSearchParams({
              pa: p.upi_id,
              pn: p.payee_name,
              am: (Number(p.amount_paise) / 100).toFixed(2),
              cu: 'INR',
              tn: `CampusMesh ${p.kind} ${p.id.slice(0, 8)}`,
              tr: p.id.replaceAll('-', ''),
            })
          : null,
    }));
  }
  async function advance(c, r) {
    const payments = (
      await c.query("SELECT kind FROM direct_upi_payments WHERE rental_id=$1 AND status='CONFIRMED'", [r.id])
    ).rows.map((p) => p.kind);
    if (!payments.includes('RENTAL')) return null;
    if (paise(r.deposit_amount) > 0 && !payments.includes('DEPOSIT')) {
      await c.query(
        "UPDATE rentals SET payment_status='RENTAL_PAID',status='DEPOSIT_PENDING',updated_at=NOW() WHERE id=$1",
        [r.id],
      );
      await intent(c, r, 'DEPOSIT', r.borrower_id, r.owner_id, paise(r.deposit_amount));
      return null;
    }
    if (r.payment_status === 'FULLY_PAID') return null;
    const delivery = await ensureOutboundDelivery(c, r.id, 'MATCHING_COURIER');
    await c.query(
      `UPDATE rentals SET payment_status='FULLY_PAID',deposit_status=$2,status=$3,
      booking_confirmed_at=COALESCE(booking_confirmed_at,NOW()),qr_code_hash=$4,qr_generated_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [
        r.id,
        paise(r.deposit_amount) > 0 ? 'HELD' : 'NOT_REQUIRED',
        delivery ? 'MATCHING_COURIER' : 'QR_GENERATED',
        delivery ? null : crypto.randomBytes(32).toString('hex'),
      ],
    );
    return delivery?.id;
  }
  async function act(id, user, action, body = {}) {
    const result = await tx(async (c) => {
      // Always lock rental before payment, consistent with acceptance/preparation.
      const ref = (
        await c.query(
          'SELECT rental_id FROM direct_upi_payments WHERE id=$1 AND (payer_id=$2 OR recipient_id=$2)',
          [id, user],
        )
      ).rows[0];
      if (!ref) throw fail('Payment not found.', 404);
      const r = (await c.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [ref.rental_id])).rows[0];
      const p = (await c.query('SELECT * FROM direct_upi_payments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (action === 'report') {
        if (p.payer_id !== user) throw fail('Only the payer can report payment.', 403);
        if (p.status !== 'PENDING') throw fail('This payment is already reported. Do not pay again.');
        const reference = String(body.reference || '').trim();
        if (!/^\d{12}$/.test(reference))
          throw fail('Enter the 12-digit UPI transaction reference from your UPI app.', 400);
        if (body.confirm !== true)
          throw fail('Confirm that you sent the exact amount to the displayed recipient.', 400);
        await c.query(
          "UPDATE direct_upi_payments SET status='REPORTED',reference=$2,reported_at=NOW() WHERE id=$1",
          [id, reference],
        );
      } else if (action === 'confirm' || action === 'dispute') {
        if (p.recipient_id !== user) throw fail('Only the recipient can confirm receipt.', 403);
        if (action === 'confirm' && p.status === 'CONFIRMED') return { r };
        if (!['REPORTED', 'DISPUTED'].includes(p.status))
          throw fail('Wait for the payer to report their transaction.');
        if (body.confirm !== true) throw fail('Check your bank or UPI app before confirming receipt.', 400);
        await c.query(
          "UPDATE direct_upi_payments SET status=$2,confirmed_at=CASE WHEN $2='CONFIRMED' THEN NOW() ELSE NULL END WHERE id=$1",
          [id, action === 'confirm' ? 'CONFIRMED' : 'DISPUTED'],
        );
      } else throw fail('Unknown payment action.', 400);
      await c.query('INSERT INTO direct_upi_events(payment_id,actor_id,action) VALUES($1,$2,$3)', [
        id,
        user,
        action.toUpperCase(),
      ]);
      let deliveryId;
      if (action === 'confirm') {
        if (['RENTAL', 'DEPOSIT'].includes(p.kind)) deliveryId = await advance(c, r);
        if (p.kind === 'DEPOSIT_REFUND')
          await c.query("UPDATE rentals SET deposit_status='REFUNDED',updated_at=NOW() WHERE id=$1", [r.id]);
      }
      return { r, deliveryId, recipient: p.recipient_id };
    });
    await announce(result.r, result.deliveryId);
    if (action === 'confirm') {
      try {
        onConfirmed();
      } catch {}
    }
    try {
      if (result.recipient) notify(result.recipient, 'direct-payment:updated', { rental_id: result.r.id });
    } catch {}
    return { success: true };
  }
  async function complete(rentalId, user, body) {
    const r = await tx(async (c) => {
      const r = (await c.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [rentalId])).rows[0];
      if (!r || r.owner_id !== user) throw fail('Only the lender can confirm return.', 403);
      if (r.payment_method !== 'DIRECT_UPI') throw fail('This rental uses the original payment method.');
      if (r.status === 'COMPLETED') return r;
      if (r.status !== 'RETURN_PENDING') throw fail('Request and complete physical return first.');
      if (
        r.return_delivery_id &&
        !(
          await c.query("SELECT 1 FROM delivery_requests WHERE id=$1 AND status='COMPLETED'", [
            r.return_delivery_id,
          ])
        ).rowCount
      )
        throw fail('The return courier must complete handover first.');
      if (Number(body.damage_amount || 0) !== 0)
        throw fail(
          'Damage deductions need agreement with the renter. Contact support; this flow returns the full deposit.',
        );
      await c.query(
        "UPDATE rentals SET status='COMPLETED',deposit_status=$2,completed_at=NOW(),updated_at=NOW() WHERE id=$1",
        [r.id, paise(r.deposit_amount) > 0 ? 'REFUND_PENDING' : 'NOT_REQUIRED'],
      );
      await c.query(
        "INSERT INTO transaction_events(rental_id,event_type,actor_user_id) VALUES($1,'RETURN_CONFIRMED',$2)",
        [r.id, user],
      );
      return r;
    });
    await announce(r);
    return {
      message:
        'Return confirmed. Refund the deposit directly to the renter; it remains pending until the renter confirms receipt.',
    };
  }
  return { profile, respond, prepare, list, act, complete };
}
module.exports = { enabled, createService, validateProfile, paise };
