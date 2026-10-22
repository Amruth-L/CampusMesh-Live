const crypto = require('crypto');
const pool = require('../../config/database');
const { matchDelivery } = require('../delivery/matching.service');
const { storePrivatePdf, readPrivatePdf, usingSupabaseStorage } = require('./private-pdf-storage');

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const pdfInfo = buffer => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > MAX_PDF_BYTES || buffer.subarray(0, 5).toString() !== '%PDF-') return null;
  const text = buffer.toString('latin1');
  if (!text.includes('%%EOF')) return null;
  const pages = (text.match(/\/Type\s*\/Page(?!s)\b/g) || []).length;
  return pages > 0 ? { pageCount: pages, sha256: crypto.createHash('sha256').update(buffer).digest('hex') } : null;
};

exports.preview = (req, res) => {
  const info = pdfInfo(req.body);
  if (!info) return res.status(400).json({ error: 'Upload a readable PDF up to 15 MB.' });
  const copies = Math.max(1, Math.min(20, Number(req.headers['x-copies']) || 1));
  res.json({ ...info, copies, pricePerPage: 3, totalAmount: info.pageCount * copies * 3, size: req.body.length });
};

exports.createRequest = async (req, res) => {
  const info = pdfInfo(req.body);
  if (!info) return res.status(400).json({ error: 'Upload a readable PDF up to 15 MB.' });
  const copies = Math.max(1, Math.min(20, Number(req.headers['x-copies']) || 1));
  const dropLocationId = req.headers['x-drop-location'];
  const filename = decodeURIComponent(String(req.headers['x-filename'] || 'document.pdf')).slice(0, 180);
  const paymentOrderId = req.headers["x-payment-order-id"];
  const pendingRes = await pool.query("SELECT * FROM pending_orders WHERE id=$1 AND user_id=$2", [paymentOrderId, req.user.id]);
  const pending = pendingRes.rows[0];
  const payment = pending?.booking_data;
  if (!payment?.verified) return res.status(402).json({ error: "Complete Xerox payment before submitting the print request." });
  if (payment.type !== "XEROX" || Number(payment.page_count) !== info.pageCount || Number(payment.copies) !== copies || payment.drop_location_id !== dropLocationId || payment.document_hash !== info.sha256) {
    return res.status(409).json({ error: "The paid Xerox order does not match this document or delivery selection." });
  }
  const location = await pool.query('SELECT id FROM campus_locations WHERE id=$1', [dropLocationId]);
  if (!location.rowCount) return res.status(400).json({ error: 'Choose a valid campus delivery location.' });
  const provider = await pool.query("SELECT id FROM users WHERE account_type='XEROX_DESK' ORDER BY created_at LIMIT 1");
  const pickup = await pool.query("SELECT id FROM campus_locations WHERE building_id='xerox' ORDER BY id LIMIT 1");
  const storagePath = `xerox/${req.user.id}/${Date.now()}-${info.sha256.slice(0,12)}.pdf`;
  await storePrivatePdf(storagePath, req.body);
  const { rows } = await pool.query(`INSERT INTO xerox_requests
    (requester_id,provider_id,file_storage_path,file_data,original_filename,page_count,copies,total_amount,pickup_location_id,drop_location_id,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RECEIVED') RETURNING id,original_filename,page_count,copies,price_per_page,total_amount,status,created_at`,
    [req.user.id,provider.rows[0]?.id || null,storagePath,usingSupabaseStorage?null:req.body,filename,info.pageCount,copies,info.pageCount*copies*3,pickup.rows[0]?.id || null,dropLocationId]);
  await pool.query(`INSERT INTO transaction_events(xerox_request_id,event_type,actor_user_id,metadata) VALUES($1,'XEROX_RECEIVED',$2,$3)`, [rows[0].id, req.user.id, { filename, pageCount: info.pageCount, copies }]);
  await pool.query("DELETE FROM pending_orders WHERE id=$1 AND user_id=$2", [paymentOrderId, req.user.id]);
  res.status(201).json(rows[0]);
};

exports.mine = async (req, res) => {
  const { rows } = await pool.query(`SELECT xr.id,xr.original_filename,xr.page_count,xr.copies,xr.price_per_page,xr.total_amount,xr.status,xr.delivery_id,xr.created_at,
    l.building_name drop_location FROM xerox_requests xr JOIN campus_locations l ON l.id=xr.drop_location_id WHERE requester_id=$1 ORDER BY created_at DESC`, [req.user.id]); res.json(rows);
};

exports.deskQueue = async (req, res) => {
  const user = await pool.query('SELECT account_type FROM users WHERE id=$1', [req.user.id]);
  if (user.rows[0]?.account_type !== 'XEROX_DESK') return res.status(403).json({ error: 'Xerox Desk access only.' });
  const { rows } = await pool.query(`SELECT xr.id,xr.requester_id,xr.original_filename,xr.page_count,xr.copies,xr.total_amount,xr.status,xr.delivery_id,xr.created_at,u.name requester_name,
    l.building_name drop_location FROM xerox_requests xr JOIN users u ON u.id=xr.requester_id JOIN campus_locations l ON l.id=xr.drop_location_id ORDER BY xr.created_at`); res.json(rows);
};

const deskTransition = next => async (req, res) => {
  const user = await pool.query('SELECT account_type FROM users WHERE id=$1', [req.user.id]);
  if (user.rows[0]?.account_type !== 'XEROX_DESK') return res.status(403).json({ error: 'Xerox Desk access only.' });
  const expected = next === 'PRINTING' ? ['RECEIVED'] : ['PRINTING','RECEIVED'];
  const { rows } = await pool.query('UPDATE xerox_requests SET status=$1 WHERE id=$2 AND status=ANY($3) RETURNING *', [next, req.params.id, expected]);
  if (!rows[0]) return res.status(409).json({ error: 'Request is not ready for that action.' });
  if (next === 'READY_FOR_PICKUP') {
    const order = rows[0]; const locations = await pool.query('SELECT * FROM campus_locations WHERE id=ANY($1)', [[order.pickup_location_id,order.drop_location_id]]);
    const byId=Object.fromEntries(locations.rows.map(x=>[x.id,x])); const label=x=>[x.building_name,x.floor_name,x.room_name].filter(Boolean).join(' · ');
    const delivery = await pool.query(`INSERT INTO delivery_requests (xerox_request_id,customer_id,seller_id,pickup_location,drop_location,pickup_location_id,
      destination_location_id,task_type,order_type,item_description,delivery_fee,courier_earning,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'XEROX_DELIVERY','XEROX',$8,20,14,'MATCHING_COURIER') RETURNING *`,
      [order.id,order.requester_id,req.user.id,label(byId[order.pickup_location_id]),label(byId[order.drop_location_id]),order.pickup_location_id,order.drop_location_id,`${order.page_count} page Xerox · ${order.copies} copies`]);
    await pool.query('UPDATE xerox_requests SET delivery_id=$1 WHERE id=$2',[delivery.rows[0].id,order.id]); await matchDelivery(delivery.rows[0].id);
    rows[0].delivery_id=delivery.rows[0].id;
  }
  await pool.query('INSERT INTO transaction_events(xerox_request_id,event_type,actor_user_id) VALUES($1,$2,$3)', [rows[0].id,`XEROX_${next}`,req.user.id]); res.json(rows[0]);
};
exports.markPrinting = deskTransition('PRINTING');
exports.markReady = deskTransition('READY_FOR_PICKUP');

exports.document = async (req, res) => {
  const { rows } = await pool.query('SELECT requester_id,provider_id,original_filename,file_storage_path,file_data FROM xerox_requests WHERE id=$1', [req.params.id]);
  const item=rows[0]; if(!item)return res.status(404).json({error:'Xerox request not found.'});
  if (![item.requester_id,item.provider_id].includes(req.user.id)) return res.status(403).json({error:'The PDF is private to the requester and Xerox Desk.'});
  const document = item.file_data || await readPrivatePdf(item.file_storage_path);
  if (!document) return res.status(410).json({error:'The retained PDF is no longer available.'});
  res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`inline; filename="${item.original_filename.replace(/["\r\n]/g,'')}"`); res.send(document);
};

module.exports.pdfInfo = pdfInfo;

