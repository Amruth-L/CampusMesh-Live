const crypto = require('crypto');
const pool = require('../../config/database');
const { emitDelivery, emitUser } = require('../../shared/realtime');
const { requireHandoverPhoto } = require('./handover-evidence');

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = () => crypto.randomBytes(24).toString('base64url');
const randomOtp = () => String(crypto.randomInt(100000, 1000000));

function shownTo(delivery, stage) {
  if (stage === 'PICKUP' || stage === 'RETURN_PICKUP' || stage === 'XEROX_PICKUP') return delivery.seller_id;
  if (stage === 'DELIVERY' || stage === 'RETURN_RECEIVED') return delivery.customer_id;
  return null;
}

function validStages(delivery) {
  if (delivery.task_type === 'WISH_DELIVERY') return ['DELIVERY'];
  if (delivery.task_type === 'RENTAL_RETURN') return ['RETURN_PICKUP', 'RETURN_RECEIVED'];
  if (delivery.task_type === 'XEROX_DELIVERY') return ['XEROX_PICKUP', 'DELIVERY'];
  return ['PICKUP', 'DELIVERY'];
}

async function issueCredential(deliveryId, stage, userId) {
  const result = await pool.query('SELECT * FROM delivery_requests WHERE id=$1', [deliveryId]);
  const delivery = result.rows[0];
  if (!delivery || !validStages(delivery).includes(stage)) return { error: 'Invalid delivery or handover stage.', status: 404 };
  if (shownTo(delivery, stage) !== userId) return { error: 'This handover belongs to another participant.', status: 403 };
  if (!delivery.courier_id) return { error: 'A courier must be assigned first.', status: 409 };

  const pickupStage = ['PICKUP', 'RETURN_PICKUP', 'XEROX_PICKUP'].includes(stage);
  const expectedStatuses = pickupStage
    ? ['ARRIVED_AT_PICKUP']
    : stage === 'RETURN_RECEIVED'
      ? ['RETURN_IN_TRANSIT']
      : ['ARRIVED_AT_DESTINATION'];
  if (!expectedStatuses.includes(delivery.status)) {
    return {
      error: pickupStage
        ? 'Mark the delivery as arrived at pickup before showing the pickup credential.'
        : 'The courier must arrive at the destination before the delivery credential is shown.',
      status: 409,
    };
  }

  if (!pickupStage && delivery.task_type === 'WISH_DELIVERY' && !delivery.picked_up_at) throw Object.assign(new Error('Confirm item collection first.'), { status: 409 });
  if (!pickupStage && delivery.task_type !== 'WISH_DELIVERY') {
    const previousStage = stage === 'RETURN_RECEIVED'
      ? 'RETURN_PICKUP'
      : stage === 'DELIVERY' && delivery.task_type === 'XEROX_DELIVERY'
        ? 'XEROX_PICKUP'
        : 'PICKUP';
    const previous = await pool.query(
      'SELECT status FROM handover_verifications WHERE delivery_id=$1 AND stage=$2',
      [deliveryId, previousStage],
    );
    if (previous.rows[0]?.status !== 'USED') {
      return { error: 'The pickup handover must be verified first.', status: 409 };
    }
  }

  const token = randomToken();
  const otp = randomOtp();
  const { rows } = await pool.query(`INSERT INTO handover_verifications
    (delivery_id, stage, credential_hash, otp_hash, shown_to_user_id, expires_at)
    VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '30 minutes')
    ON CONFLICT (delivery_id, stage) DO UPDATE SET credential_hash=EXCLUDED.credential_hash,
      otp_hash=EXCLUDED.otp_hash, shown_to_user_id=EXCLUDED.shown_to_user_id,
      expires_at=EXCLUDED.expires_at, status='ACTIVE', verified_by_user_id=NULL, verified_at=NULL
    RETURNING expires_at`, [deliveryId, stage, hash(token), hash(otp), userId]);
  return { deliveryId, stage, otp, qr: { version: 1, taskId: deliveryId, stage, token }, expiresAt: rows[0].expires_at };
}

async function verifyCredential(deliveryId, courierId, { stage, method, value }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deliveryResult = await client.query('SELECT * FROM delivery_requests WHERE id=$1 FOR UPDATE', [deliveryId]);
    const delivery = deliveryResult.rows[0];
    if (!delivery || delivery.courier_id !== courierId) throw Object.assign(new Error('Only the assigned courier can verify this handover.'), { status: 403 });
    if (!validStages(delivery).includes(stage)) throw Object.assign(new Error('Incorrect handover stage.'), { status: 400 });
    const pickupStage = ['PICKUP','RETURN_PICKUP','XEROX_PICKUP'].includes(stage);
    const allowedStatuses = pickupStage
      ? ['ARRIVED_AT_PICKUP']
      : stage === 'RETURN_RECEIVED'
        ? ['RETURN_IN_TRANSIT']
        : ['ARRIVED_AT_DESTINATION'];
    if (!allowedStatuses.includes(delivery.status)) throw Object.assign(new Error(`The delivery is not ready for ${stage.replaceAll('_', ' ').toLowerCase()} verification.`), { status: 409 });
    if (!pickupStage && delivery.task_type === 'WISH_DELIVERY' && !delivery.picked_up_at) throw Object.assign(new Error('Confirm item collection first.'), { status: 409 });
  if (!pickupStage && delivery.task_type !== 'WISH_DELIVERY') {
      const previousStage = stage === 'RETURN_RECEIVED'
        ? 'RETURN_PICKUP'
        : stage === 'DELIVERY' && delivery.task_type === 'XEROX_DELIVERY'
          ? 'XEROX_PICKUP'
          : 'PICKUP';
      const previous = await client.query('SELECT status FROM handover_verifications WHERE delivery_id=$1 AND stage=$2', [deliveryId, previousStage]);
      if (previous.rows[0]?.status !== 'USED') throw Object.assign(new Error('The pickup handover must be verified first.'), { status: 409 });
    }
    await requireHandoverPhoto(client, deliveryId, stage);
    const credential = await client.query(`SELECT * FROM handover_verifications WHERE delivery_id=$1 AND stage=$2 FOR UPDATE`, [deliveryId, stage]);
    const record = credential.rows[0];
    if (!record || record.status !== 'ACTIVE' || new Date(record.expires_at) <= new Date()) throw Object.assign(new Error('This credential is missing, expired, or already used.'), { status: 410 });
    let supplied;
    if (method === 'OTP') {
      supplied = hash(String(value).trim());
    } else {
      const qr = typeof value === 'object' && value !== null ? value : null;
      if (qr?.version !== 1 || qr.taskId !== deliveryId || qr.stage !== stage || typeof qr.token !== 'string') {
        throw Object.assign(new Error('This QR code belongs to a different delivery or handover stage.'), { status: 400 });
      }
      supplied = hash(qr.token);
    }
    const expected = method === 'OTP' ? record.otp_hash : record.credential_hash;
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw Object.assign(new Error('The handover credential is not valid.'), { status: 400 });
    await client.query("UPDATE handover_verifications SET status='USED', verified_by_user_id=$1, verified_at=NOW() WHERE id=$2", [courierId, record.id]);
    const isFinal = stage === 'DELIVERY' || stage === 'RETURN_RECEIVED';
    const nextStatus = stage === 'RETURN_PICKUP' ? 'RETURN_IN_TRANSIT' : stage === 'RETURN_RECEIVED' ? 'COMPLETED' : (stage === 'PICKUP' || stage === 'XEROX_PICKUP') ? 'IN_TRANSIT' : 'COMPLETED';
    await client.query(`UPDATE delivery_requests SET status=$1,
      pickup_verified_at=CASE WHEN $2=FALSE THEN NOW() ELSE pickup_verified_at END,
      delivery_verified_at=CASE WHEN $2=TRUE THEN NOW() ELSE delivery_verified_at END,
      delivered_at=CASE WHEN $2=TRUE THEN NOW() ELSE delivered_at END,
      completed_at=CASE WHEN $2=TRUE THEN NOW() ELSE completed_at END, updated_at=NOW() WHERE id=$3`, [nextStatus, isFinal, deliveryId]);
    if (delivery.rental_id) {
      if (stage === 'DELIVERY') await client.query("UPDATE rentals SET status='RENTAL_ACTIVE', updated_at=NOW() WHERE id=$1", [delivery.rental_id]);
      if (stage === 'RETURN_PICKUP') await client.query("UPDATE rentals SET status='RETURN_IN_TRANSIT', updated_at=NOW() WHERE id=$1", [delivery.rental_id]);
      if (stage === 'RETURN_RECEIVED') await client.query("UPDATE rentals SET status='COMPLETED', completed_at=NOW(), updated_at=NOW() WHERE id=$1", [delivery.rental_id]);
    }
    if (delivery.wish_request_id && stage === 'DELIVERY') await client.query("UPDATE wish_requests SET status='COMPLETED', updated_at=NOW() WHERE id=$1", [delivery.wish_request_id]);
    if (delivery.xerox_request_id && stage === 'DELIVERY') await client.query("UPDATE xerox_requests SET status='COMPLETED', completed_at=NOW() WHERE id=$1", [delivery.xerox_request_id]);
    await client.query(`INSERT INTO transaction_events (rental_id, delivery_id, xerox_request_id, event_type, actor_user_id, metadata)
      VALUES ($1,$2,$3,$4,$5,$6)`, [delivery.rental_id, deliveryId, delivery.xerox_request_id, `${stage}_VERIFIED`, courierId, { method }]);
    await client.query('COMMIT');
    const payload = { id: deliveryId, delivery_id: deliveryId, status: nextStatus, stage, courier_id: courierId };
    emitDelivery(deliveryId, 'delivery:status', payload);
    if (isFinal) emitDelivery(deliveryId, 'delivery:completed', payload);
    emitUser(courierId, 'delivery:status', payload);
    emitUser(delivery.customer_id, 'delivery:status', payload); emitUser(delivery.seller_id, 'delivery:status', payload);
    return payload;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

module.exports = { issueCredential, verifyCredential };

