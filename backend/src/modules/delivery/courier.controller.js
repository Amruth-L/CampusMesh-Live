const pool = require('../../config/database');
const { routeFor } = require('../campus/campus.service');
const { matchDelivery } = require('./matching.service');
const { requireEligibleCourier } = require('./mesh-score');

const loadLocations = async (originId, destinationId) => {
  const { rows } = await pool.query('SELECT * FROM campus_locations WHERE id = ANY($1)', [[originId, destinationId]]);
  return Object.fromEntries(rows.map(location => [location.id, location]));
};

exports.upsertRoute = async (req, res) => {
  const { origin_location_id, destination_location_id, available_until, max_detour_meters = 250 } = req.body;
  const open = req.body.availability_mode === 'OPEN';
  if ((!open && (!origin_location_id || !destination_location_id)) || !available_until) return res.status(400).json({ error: 'Origin, destination, and available-until time are required.' });
  if (Number.isNaN(new Date(available_until).getTime()) || new Date(available_until) <= new Date()) return res.status(400).json({ error: 'Choose an available-until time in the future.' });
  if (!open && origin_location_id === destination_location_id) return res.status(400).json({ error: 'Choose two different locations.' });
  const locations = open ? {} : await loadLocations(origin_location_id, destination_location_id);
  const route = open ? null : routeFor(locations[origin_location_id], locations[destination_location_id]);
  if (!open && !route) return res.status(422).json({ error: 'No campus route connects those locations.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize route replacement per courier so rapid saves cannot race the
    // partial one-active-route unique index.
    const courier = await client.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [req.user.id]);
    if (!courier.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Courier account not found.' });
    }
    await requireEligibleCourier(req.user.id, client);
    await client.query("UPDATE delivery_offers SET status='EXPIRED', responded_at=NOW() WHERE courier_id=$1 AND status='PENDING'", [req.user.id]);
    await client.query('UPDATE courier_route_availability SET is_active = FALSE WHERE courier_id = $1 AND is_active', [req.user.id]);
    const { rows } = await client.query(`INSERT INTO courier_route_availability
      (courier_id, origin_location_id, destination_location_id, route_node_ids, available_until, max_detour_meters, availability_mode)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.user.id, open ? null : origin_location_id, open ? null : destination_location_id, route?.nodes || [], available_until, Math.max(50, Math.min(750, Number(max_detour_meters) || 250)), open ? 'OPEN' : 'ROUTE']);
    await client.query("UPDATE users SET delivery_available=TRUE, active_mode='DELIVERY' WHERE id=$1", [req.user.id]);
    await client.query('COMMIT');
    try {
      const openTasks = await client.query("SELECT id FROM delivery_requests WHERE status IN ('MATCHING_COURIER','RETURN_MATCHING','AVAILABLE','NO_COURIER_AVAILABLE') AND (customer_id IS NULL OR customer_id <> $1) AND (seller_id IS NULL OR seller_id <> $1)", [req.user.id]);
      for (const task of openTasks.rows) await matchDelivery(task.id, client);
    } catch (rematchError) {
      console.error('[CourierController] route rematch error:', rematchError.message);
    }
    res.status(201).json({ route: rows[0], navigation: route, delivery_available: true });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[CourierController] upsertRoute error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Your route was updated by another request. Please save again.' });
    }
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save courier route.' });
  } finally { client.release(); }
};

exports.currentRoute = async (req, res) => {
  await pool.query('UPDATE courier_route_availability SET is_active=FALSE WHERE courier_id=$1 AND is_active AND available_until <= NOW()', [req.user.id]);
  const { rows } = await pool.query(`SELECT cra.*, u.delivery_available, o.building_name origin_name, d.building_name destination_name
    FROM courier_route_availability cra JOIN users u ON u.id=cra.courier_id
    LEFT JOIN campus_locations o ON o.id=cra.origin_location_id
    LEFT JOIN campus_locations d ON d.id=cra.destination_location_id WHERE cra.courier_id=$1 AND cra.is_active AND cra.available_until > NOW() ORDER BY cra.created_at DESC LIMIT 1`, [req.user.id]);
  if (!rows[0]) {
    await pool.query('UPDATE users SET delivery_available=FALSE WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM courier_route_availability cra WHERE cra.courier_id=$1 AND cra.is_active AND cra.available_until > NOW())', [req.user.id]);
    return res.json({ route: null, delivery_available: false });
  }
  const locations = await loadLocations(rows[0].origin_location_id, rows[0].destination_location_id);
  res.json({ route: rows[0], delivery_available: Boolean(rows[0].delivery_available), navigation: rows[0].availability_mode === 'OPEN' ? null : routeFor(locations[rows[0].origin_location_id], locations[rows[0].destination_location_id]) });
};

exports.deactivateRoute = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [req.user.id]);
    await client.query('UPDATE courier_route_availability SET is_active=FALSE WHERE courier_id=$1 AND is_active', [req.user.id]);
    await client.query('UPDATE users SET delivery_available=FALSE WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM courier_route_availability cra WHERE cra.courier_id=$1 AND cra.is_active AND cra.available_until > NOW())', [req.user.id]);
    await client.query("UPDATE delivery_offers SET status='EXPIRED', responded_at=NOW() WHERE courier_id=$1 AND status='PENDING'", [req.user.id]);
    await client.query('COMMIT');
    res.json({ route: null, delivery_available: false });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[CourierController] deactivateRoute error:', error.message);
    res.status(500).json({ error: 'Could not update your availability.' });
  } finally { client.release(); }
};

exports.getOffers = async (req, res) => {
  await pool.query("UPDATE delivery_offers SET status='EXPIRED' WHERE courier_id=$1 AND status='PENDING' AND expires_at <= NOW()", [req.user.id]);
  const { rows } = await pool.query(`SELECT offer.*, offer.id as offer_id,
      dr.task_type, dr.item_description, dr.pickup_location, dr.drop_location,
      dr.pickup_location_id, dr.destination_location_id, dr.estimated_time, dr.delivery_fee,
      dr.courier_earning, dr.distance, dr.rental_id, dr.listing_id,
      l.title as listing_title, l.image_url as listing_image, l.category as listing_category,
      u_seller.name as seller_name, u_seller.hostel as seller_hostel,
      u_customer.name as customer_name, u_customer.hostel as customer_hostel
    FROM delivery_offers offer JOIN delivery_requests dr ON dr.id=offer.delivery_id
    LEFT JOIN listings l ON l.id=dr.listing_id
    LEFT JOIN users u_seller ON u_seller.id=dr.seller_id
    LEFT JOIN users u_customer ON u_customer.id=dr.customer_id
    WHERE offer.courier_id=$1 AND offer.status='PENDING' AND offer.expires_at > NOW() ORDER BY offer.match_score DESC`, [req.user.id]);
  res.json(rows);
};

exports.declineOffer = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [req.user.id]);
    await client.query('SELECT id FROM delivery_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
    const { rows } = await client.query(`UPDATE delivery_offers SET status='DECLINED', responded_at=NOW()
      WHERE delivery_id=$1 AND courier_id=$2 AND ($3::text IS NULL OR id::text=$3) AND status='PENDING' AND expires_at>NOW() RETURNING *`, [req.params.id, req.user.id, req.body?.offer_id || null]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active offer not found.' });
    }
    await client.query(`UPDATE delivery_requests SET declined_by = array_append(declined_by, $1), updated_at=NOW()
      WHERE id=$2 AND courier_id IS NULL`, [req.user.id, req.params.id]);
    await client.query('COMMIT');
    await matchDelivery(req.params.id);
    res.json(rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[CourierController] declineOffer error:', error.message);
    res.status(500).json({ error: 'Could not decline this delivery.' });
  } finally { client.release(); }
};

