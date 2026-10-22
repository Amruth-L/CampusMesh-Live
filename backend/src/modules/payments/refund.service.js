const { randomUUID } = require('node:crypto');
const pool = require('../../config/database');
const razorpay = require('../../config/razorpay');

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
function paise(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw fail('Enter a valid amount with at most two decimal places.', 400);
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount)) throw fail('Invalid amount.', 400);
  return amount;
}

// The SDK drops X-Refund-Idempotency. Use the documented HTTP API so a
// timeout/retry cannot create a second refund. Credentials never reach the UI.
async function submitRefund(paymentId, body, key) {
  const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret } = process.env;
  if (!id || !secret) throw fail('Refund provider is not configured.', 503);
  const response = await globalThis.fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST', signal: globalThis.AbortSignal.timeout(15000),
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/json', 'X-Refund-Idempotency': key },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw fail('Razorpay has not confirmed the refund. Retry the same request or contact support.', 503);
  return response.json();
}

async function providerRead(read) {
  let timer;
  try {
    return await Promise.race([read(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail('Refund confirmation timed out.', 503)), 15000);
    })]);
  } finally { globalThis.clearTimeout(timer); }
}

function createRefundService({ db = pool, gateway = razorpay, submit = submitRefund } = {}) {
  async function transaction(action) {
    const client = await db.connect();
    try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  function result(row) {
    return { refund_amount: Number(row.refund_amount), damage_amount: Number(row.damage_amount),
      deposit_amount: Number(row.deposit_amount), refund_status: row.refund_status, refund_kind: row.refund_kind,
      message: row.refund_status === 'PROCESSED' ? 'Razorpay processed the refund; bank credit may take additional time.'
        : row.refund_status === 'NO_REFUND' ? 'Return confirmed. The deposit was retained against the recorded damage deduction.'
        : row.refund_status === 'FAILED' ? 'The refund failed at Razorpay; contact support.'
        : 'Refund confirmation is pending. Do not submit a separate refund in the payment dashboard.' };
  }

  async function settle(client, row, remote) {
    if (!remote || !/^rfnd_/.test(remote.id || '') || remote.payment_id !== row.transaction_id ||
        remote.amount !== paise(row.refund_amount) || remote.currency !== 'INR' ||
        (row.gateway_refund_id && row.gateway_refund_id !== remote.id) ||
        !['pending', 'processed', 'failed'].includes(remote.status)) throw fail('Refund response could not be verified.', 503);
    const status = row.refund_status === 'PROCESSED' ? 'PROCESSED' : remote.status.toUpperCase();
    await client.query('UPDATE refunds SET gateway_refund_id=$1,refund_status=$2,updated_at=NOW() WHERE id=$3', [remote.id, status, row.id]);
    if (row.refund_kind === 'SECURITY_DEPOSIT') {
      await client.query("UPDATE rentals SET status='COMPLETED',deposit_status=$1,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW() WHERE id=$2",
        [status === 'PROCESSED' ? 'REFUNDED' : status === 'FAILED' ? 'REFUND_FAILED' : 'REFUND_PENDING', row.rental_id]);
    }
    return result({ ...row, refund_status: status });
  }

  async function reconcile(refundId) {
    // Serialize dispatch/retry. Intent already exists durably before this lock
    // and external call. A lost commit is retried with the identical request key.
    return transaction(async client => {
      const row = (await client.query(`SELECT f.*,p.transaction_id FROM refunds f JOIN payments p ON p.id=f.payment_id
        WHERE f.id=$1 FOR UPDATE OF f`, [refundId])).rows[0];
      if (!row || !row.request_key) throw fail('This older refund needs a manual provider review. No new refund was sent.');
      if (['PROCESSED', 'NO_REFUND', 'FAILED'].includes(row.refund_status)) return result(row);
      try {
        const remote = row.gateway_refund_id ? await providerRead(() => gateway.refunds.fetch(row.gateway_refund_id))
          : await submit(row.transaction_id, { amount: paise(row.refund_amount), speed: 'normal',
            notes: { campusmesh_refund_id: row.id } }, row.request_key);
        return await settle(client, row, remote);
      } catch {
        // Unknown outcome is not success or failure. Keep the durable key for
        // safe retry; never invent a processed refund after a provider error.
        await client.query("UPDATE refunds SET refund_status=$1,updated_at=NOW() WHERE id=$2", [row.gateway_refund_id ? 'PENDING' : 'UNKNOWN', row.id]);
        return result({ ...row, refund_status: row.gateway_refund_id ? 'PENDING' : 'UNKNOWN' });
      }
    });
  }

  async function request(rentalId, ownerId, damage = 0, description = '') {
    const deduction = paise(damage ?? 0);
    const row = await transaction(async client => {
      const rental = (await client.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [rentalId])).rows[0];
      if (!rental) throw fail('Rental not found.', 404);
      if (rental.owner_id !== ownerId) throw fail('Only the owner can confirm return and refund.', 403);
      if (!['RETURN_PENDING', 'COMPLETED'].includes(rental.status)) throw fail('Confirm physical return before requesting a refund.');
      if (rental.return_delivery_id) {
        const delivery = (await client.query('SELECT status FROM delivery_requests WHERE id=$1', [rental.return_delivery_id])).rows[0];
        if (delivery?.status !== 'COMPLETED') throw fail('The return courier has not completed handover.');
      }
      const deposit = paise(rental.deposit_amount);
      if (deduction > deposit || (deduction > 0 && !String(description).trim())) throw fail('Provide a damage explanation and a deduction no larger than the deposit.', 400);
      const existing = (await client.query("SELECT * FROM refunds WHERE rental_id=$1 AND refund_kind='SECURITY_DEPOSIT' ORDER BY created_at DESC LIMIT 1", [rentalId])).rows[0];
      if (existing) {
        if (!existing.request_key) throw fail('This older refund needs manual review. No new refund was sent.');
        if (paise(existing.damage_amount) !== deduction || (existing.damage_description || '') !== String(description || '').trim()) throw fail('A refund request already exists with different details. Contact support.');
        return existing;
      }
      const payment = (await client.query("SELECT * FROM payments WHERE rental_id=$1 AND payment_type='SECURITY_DEPOSIT' AND status='PAID'", [rentalId])).rows[0];
      if (!payment || !/^pay_/.test(payment.transaction_id) || paise(payment.amount) !== deposit) throw fail('A verified deposit payment is required.');
      const refund = deposit - deduction;
      if (refund > 0 && refund < 100) throw fail('Razorpay requires a refund of at least ₹1. Adjust the deduction or contact support.', 400);
      const inserted = (await client.query(`INSERT INTO refunds(payment_id,rental_id,deposit_amount,damage_amount,refund_amount,refund_status,damage_description,request_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [payment.id, rentalId, deposit/100, deduction/100, refund/100,
        refund ? 'REQUESTED' : 'NO_REFUND', String(description || '').trim(), randomUUID()])).rows[0];
      await client.query("UPDATE rentals SET status='COMPLETED',deposit_status=$1,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW() WHERE id=$2", [refund ? 'REFUND_PENDING' : 'RETAINED', rentalId]);
      await client.query("INSERT INTO transaction_events(rental_id,event_type,actor_user_id,metadata) VALUES($1,'RETURN_CONFIRMED',$2,$3)", [rentalId, ownerId, { refund_id: inserted.id, refund_amount: refund/100, damage_amount: deduction/100 }]);
      return inserted;
    });
    return reconcile(row.id);
  }

  async function refundRejectedBooking(rentalId, userId) {
    const row = await transaction(async client => {
      const rental = (await client.query('SELECT * FROM rentals WHERE id=$1 FOR UPDATE', [rentalId])).rows[0];
      if (!rental || ![rental.owner_id, rental.borrower_id].includes(userId)) throw fail('Rental not found.', 404);
      if (rental.status !== 'CANCELLED' || rental.owner_response !== 'REJECTED') throw fail('This booking has not been rejected by the owner.');
      const existing = (await client.query("SELECT * FROM refunds WHERE rental_id=$1 AND refund_kind='RENTAL' ORDER BY created_at DESC LIMIT 1", [rentalId])).rows[0];
      if (existing) return existing;
      const payment = (await client.query("SELECT * FROM payments WHERE rental_id=$1 AND payment_type='RENTAL' AND status='PAID'", [rentalId])).rows[0];
      if (!payment || !/^pay_/.test(payment.transaction_id) || paise(payment.amount) !== paise(rental.booking_amount)) throw fail('A verified booking payment is required.');
      return (await client.query(`INSERT INTO refunds(payment_id,rental_id,deposit_amount,refund_amount,refund_status,request_key,refund_kind)
        VALUES($1,$2,$3,$3,'REQUESTED',$4,'RENTAL') RETURNING *`, [payment.id,rentalId,payment.amount,randomUUID()])).rows[0];
    });
    return reconcile(row.id);
  }

  async function refresh(rentalId, userId) {
    const rental = (await db.query('SELECT status,owner_response FROM rentals WHERE id=$1 AND (owner_id=$2 OR borrower_id=$2)', [rentalId,userId])).rows[0];
    if (rental?.status === 'CANCELLED' && rental.owner_response === 'REJECTED') return refundRejectedBooking(rentalId,userId);
    const row = (await db.query(`SELECT f.id FROM refunds f JOIN rentals r ON r.id=f.rental_id
      WHERE r.id=$1 AND (r.owner_id=$2 OR r.borrower_id=$2) AND f.request_key IS NOT NULL`, [rentalId, userId])).rows[0];
    if (!row) throw fail('Refund not found.', 404);
    return reconcile(row.id);
  }
  return { request, reconcile, refresh, refundRejectedBooking };
}
module.exports = { createRefundService, paise };
