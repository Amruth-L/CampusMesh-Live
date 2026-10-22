const { createHash } = require('node:crypto');
const pool = require('../../config/database');
const storage = require('./evidence-storage');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function currentPhotoStage(task) {
  if (task.status === 'ARRIVED_AT_PICKUP') return task.task_type === 'RENTAL_RETURN' ? 'RETURN_PICKUP'
    : task.task_type === 'XEROX_DELIVERY' ? 'XEROX_PICKUP' : 'PICKUP';
  if (task.status === 'RETURN_IN_TRANSIT' && task.task_type === 'RENTAL_RETURN') return 'RETURN_RECEIVED';
  if (task.status === 'ARRIVED_AT_DESTINATION') return 'DELIVERY';
  return null;
}
async function requireHandoverPhoto(db, deliveryId, stage) {
  const result = await db.query('SELECT 1 FROM handover_photos WHERE delivery_id=$1 AND stage=$2 LIMIT 1', [deliveryId, stage]);
  if (!result.rowCount) fail(409, 'Upload a condition photo for this handover before continuing.');
}

function createEvidenceService({ db = pool, photos = storage } = {}) {
  async function upload(deliveryId, userId, stage, image) {
    const client = await db.connect();
    let key;
    let committing = false;
    try {
      await client.query('BEGIN');
      const task = (await client.query('SELECT * FROM delivery_requests WHERE id=$1 FOR UPDATE', [deliveryId])).rows[0];
      if (!task || task.courier_id !== userId) fail(403, 'Only the assigned delivery partner can upload condition photos.');
      if (!stage || currentPhotoStage(task) !== stage) fail(409, 'Photos can only be uploaded at the current handover checkpoint.');
      const body = await photos.optimize(image);
      const hash = createHash('sha256').update(body).digest('hex');
      const existing = (await client.query('SELECT id, content_hash FROM handover_photos WHERE delivery_id=$1 AND stage=$2', [deliveryId, stage])).rows;
      const duplicate = existing.find(p => p.content_hash === hash);
      if (duplicate) { await client.query('ROLLBACK'); return { id: duplicate.id, stage, alreadySaved: true }; }
      if (existing.length >= 3) fail(409, 'Three condition photos are already saved for this handover.');
      key = await photos.put(deliveryId, stage, body);
      const { rows } = await client.query(`INSERT INTO handover_photos(delivery_id,stage,uploaded_by,object_key,content_hash)
        VALUES($1,$2,$3,$4,$5) RETURNING id,stage,created_at`, [deliveryId, stage, userId, key, hash]);
      await client.query(`INSERT INTO transaction_events(delivery_id,rental_id,event_type,actor_user_id,metadata)
        VALUES($1,$2,'CONDITION_PHOTO_UPLOADED',$3,$4)`, [deliveryId, task.rental_id, userId, { stage, photoId: rows[0].id }]);
      committing = true;
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      // A failed COMMIT response may still have committed. Never delete evidence
      // on an ambiguous commit; a retry is deduplicated by its content hash.
      if (key && !committing) await photos.remove(key).catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async function list(deliveryId, userId) {
    const task = (await db.query('SELECT customer_id,seller_id,courier_id FROM delivery_requests WHERE id=$1', [deliveryId])).rows[0];
    if (!task || ![task.customer_id, task.seller_id, task.courier_id].includes(userId)) fail(403, 'These photos belong to another delivery.');
    const { rows } = await db.query('SELECT id,stage,created_at,object_key FROM handover_photos WHERE delivery_id=$1 ORDER BY created_at', [deliveryId]);
    return Promise.all(rows.map(async ({ object_key, ...photo }) => ({ ...photo, url: await photos.url(object_key) })));
  }
  return { upload, list };
}
module.exports = { ...createEvidenceService(), createEvidenceService, currentPhotoStage, requireHandoverPhoto };
