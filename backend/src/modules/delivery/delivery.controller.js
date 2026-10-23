const pool = require('../../config/database');
const { emitDelivery, emitUser } = require('../../shared/realtime');
const { routeFor } = require('../campus/campus.service');
const { getMeshScore, requireEligibleCourier } = require('./mesh-score');
const { requireHandoverPhoto } = require('./handover-evidence');
const redactDelivery = (delivery) => {
  const safe = { ...delivery };
  delete safe.pickup_token;
  delete safe.delivery_token;
  return safe;
};

/**
 * CampusMesh Delivery Controller
 * Handles all courier / delivery-person operations.
 */

// ─────────────────────────────────────────────────────────────
//  GET /api/delivery/stats — Dashboard stats for current courier
// ─────────────────────────────────────────────────────────────
exports.getDeliveryStats = async (req, res) => {
  const userId = req.user.id;
  try {
    // Available requests (exclude own items, declined)
    const availableRes = await pool.query(
      `SELECT COUNT(*) as count
       FROM delivery_offers offer
       JOIN delivery_requests dr ON dr.id = offer.delivery_id
       JOIN users courier ON courier.id = offer.courier_id
       WHERE offer.courier_id = $1
         AND courier.delivery_available
         AND EXISTS (SELECT 1 FROM courier_route_availability cra WHERE cra.courier_id=$1 AND cra.is_active AND cra.available_until > NOW())
         AND NOT EXISTS (SELECT 1 FROM wish_requests w WHERE w.courier_id=$1 AND w.status IN ('CHECKING','QUOTED','PAYMENT_PENDING')) AND NOT EXISTS (SELECT 1 FROM delivery_requests active WHERE active.courier_id=$1 AND active.status NOT IN ('COMPLETED','DELIVERED','CANCELLED','FAILED'))
         AND offer.status = 'PENDING' AND offer.expires_at > NOW()
         AND dr.status IN ('MATCHING_COURIER','AVAILABLE','NO_COURIER_AVAILABLE','RETURN_MATCHING')
         AND dr.customer_id IS DISTINCT FROM $1
         AND dr.seller_id IS DISTINCT FROM $1`,
      [userId],
    );

    const activeRes = await pool.query(
      `SELECT COUNT(*) as count FROM delivery_requests 
       WHERE courier_id = $1 AND status IN ('COURIER_ASSIGNED','ACCEPTED','GOING_TO_PICKUP','ARRIVING_FOR_PICKUP','ARRIVED_AT_PICKUP','PICKUP_VERIFIED','ORDER_COLLECTED','PICKED_UP','GOING_TO_DESTINATION','IN_TRANSIT','ARRIVED_AT_DESTINATION','ARRIVED','RETURN_COURIER_ASSIGNED','RETURN_IN_TRANSIT','DELIVERY_PAYMENT_PENDING')`,
      [userId],
    );

    const completedRes = await pool.query(
      `SELECT COUNT(*) as count FROM delivery_requests WHERE courier_id = $1 AND status IN ('COMPLETED','DELIVERED')`,
      [userId],
    );

    const earningsRes = await pool.query(
      `SELECT COALESCE(SUM(courier_earning), 0) as total FROM delivery_requests WHERE courier_id = $1 AND status IN ('COMPLETED','DELIVERED')`,
      [userId],
    );

    res.json({
      meshScore: await getMeshScore(userId),
      available: parseInt(availableRes.rows[0].count),
      active: parseInt(activeRes.rows[0].count),
      completed: parseInt(completedRes.rows[0].count),
      totalEarned: parseFloat(earningsRes.rows[0].total),
    });
  } catch (error) {
    console.error('[DeliveryController] getDeliveryStats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch delivery stats.' });
  }
};

// ─────────────────────────────────────────────────────────────
//  GET /api/delivery/available — Available delivery requests
// ─────────────────────────────────────────────────────────────
exports.getAvailableDeliveries = async (req, res) => {
  const userId = req.user.id;
  try {
    const routeResult = await pool.query(
      "SELECT cra.available_until, cra.availability_mode, u.delivery_available FROM courier_route_availability cra JOIN users u ON u.id=cra.courier_id WHERE cra.courier_id=$1 AND cra.is_active AND cra.available_until > NOW() ORDER BY cra.created_at DESC LIMIT 1",
      [userId],
    );
    const route = routeResult.rows[0] || null;
    const online = Boolean(route?.delivery_available);
    if (!route) {
      await pool.query('UPDATE courier_route_availability SET is_active=FALSE WHERE courier_id=$1 AND is_active AND available_until <= NOW()', [userId]);
      await pool.query('UPDATE users SET delivery_available=FALSE WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM courier_route_availability cra WHERE cra.courier_id=$1 AND cra.is_active AND cra.available_until > NOW())', [userId]);
    }
    await pool.query(
      "UPDATE delivery_offers SET status='EXPIRED', responded_at=NOW() WHERE courier_id=$1 AND status='PENDING' AND expires_at <= NOW()",
      [userId],
    );

    const result = await pool.query(
      "SELECT offer.id AS offer_id, offer.delivery_id, offer.match_score AS offer_match_score, offer.score_breakdown AS offer_score_breakdown, offer.expires_at AS offer_expires_at, offer.offered_at AS offer_created_at, dr.*, (SELECT payment_method FROM rentals WHERE id=dr.rental_id) AS payment_method, l.title AS listing_title, l.image_url AS listing_image, l.category AS listing_category, u_seller.name AS seller_name, u_seller.hostel AS seller_hostel, u_customer.name AS customer_name, u_customer.hostel AS customer_hostel FROM delivery_offers offer JOIN delivery_requests dr ON dr.id=offer.delivery_id JOIN users courier ON courier.id=offer.courier_id LEFT JOIN listings l ON l.id=dr.listing_id LEFT JOIN users u_seller ON u_seller.id=dr.seller_id LEFT JOIN users u_customer ON u_customer.id=dr.customer_id WHERE offer.courier_id=$1 AND courier.delivery_available AND EXISTS (SELECT 1 FROM courier_route_availability cra WHERE cra.courier_id=$1 AND cra.is_active AND cra.available_until > NOW() AND (offer.route_availability_id IS NULL OR offer.route_availability_id=cra.id)) AND NOT EXISTS (SELECT 1 FROM wish_requests w WHERE w.courier_id=$1 AND w.status IN ('CHECKING','QUOTED','PAYMENT_PENDING')) AND NOT EXISTS (SELECT 1 FROM delivery_requests active WHERE active.courier_id=$1 AND active.status NOT IN ('COMPLETED','DELIVERED','CANCELLED','FAILED')) AND offer.status='PENDING' AND offer.expires_at > NOW() AND dr.status IN ('MATCHING_COURIER','AVAILABLE','NO_COURIER_AVAILABLE','RETURN_MATCHING') AND dr.customer_id IS DISTINCT FROM $1 AND dr.seller_id IS DISTINCT FROM $1 AND NOT ($1 = ANY(COALESCE(dr.declined_by, ARRAY[]::uuid[]))) ORDER BY offer.match_score DESC, dr.created_at DESC",
      [userId],
    );

    let reason = null;
    if (!route) reason = 'ROUTE_EXPIRED';
    else if (!result.rows.length) {
      const open = await pool.query(
        "SELECT COUNT(*)::int AS count FROM delivery_requests WHERE courier_id IS NULL AND status IN ('MATCHING_COURIER','AVAILABLE','NO_COURIER_AVAILABLE','RETURN_MATCHING') AND customer_id IS DISTINCT FROM $1 AND seller_id IS DISTINCT FROM $1",
        [userId],
      );
      reason = open.rows[0].count > 0 && route.availability_mode === 'ROUTE' ? 'NO_ROUTE_MATCH' : 'NO_OPEN_REQUESTS';
    }

    res.json({
      deliveries: result.rows.map(redactDelivery),
      availability: {
        online,
        routeActive: Boolean(route),
        availableUntil: route?.available_until || null,
        reason: online ? reason : route ? 'OFFLINE' : reason,
      },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[DeliveryController] getAvailableDeliveries error:', error.message);
    res.status(500).json({ error: 'Failed to fetch available deliveries.' });
  }
};

// ─────────────────────────────────────────────────────────────
//  GET /api/delivery/my-deliveries — Courier's accepted deliveries
// ─────────────────────────────────────────────────────────────
exports.getMyDeliveries = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT dr.*, (SELECT payment_method FROM rentals WHERE id=dr.rental_id) AS payment_method,
              COALESCE(l.title, dr.item_description, 'Campus Delivery') as listing_title,
              l.image_url as listing_image, l.category as listing_category,
              u_seller.name as seller_name, u_seller.hostel as seller_hostel,
              u_customer.name as customer_name, u_customer.hostel as customer_hostel
       FROM delivery_requests dr
       LEFT JOIN listings l ON dr.listing_id = l.id
       LEFT JOIN users u_seller ON dr.seller_id = u_seller.id
       LEFT JOIN users u_customer ON dr.customer_id = u_customer.id
       WHERE dr.courier_id = $1
       ORDER BY 
         CASE WHEN dr.status IN ('COMPLETED','DELIVERED') THEN 1 ELSE 0 END,
         COALESCE(dr.completed_at, dr.delivered_at, dr.updated_at) DESC`,
      [userId],
    );
    res.json(result.rows.map(redactDelivery));
  } catch (error) {
    console.error('[DeliveryController] getMyDeliveries error:', error.message);
    res.status(500).json({ error: 'Failed to fetch your deliveries.' });
  }
};

// ─────────────────────────────────────────────────────────────
//  GET /api/delivery/earnings — Courier earnings breakdown
// ─────────────────────────────────────────────────────────────
exports.getEarnings = async (req, res) => {
  const userId = req.user.id;
  try {
    // Total earnings
    const totalRes = await pool.query(
      `SELECT COALESCE(SUM(courier_earning), 0) as total, COUNT(*) as count
       FROM delivery_requests WHERE courier_id = $1 AND status IN ('COMPLETED','DELIVERED')`,
      [userId],
    );

    // Today's earnings
    const todayRes = await pool.query(
      `SELECT COALESCE(SUM(courier_earning), 0) as today_total, COUNT(*) as today_count
       FROM delivery_requests 
       WHERE courier_id = $1 AND status IN ('COMPLETED','DELIVERED') AND COALESCE(delivered_at, completed_at)::date = CURRENT_DATE`,
      [userId],
    );

    // Recent transactions
    const transactionsRes = await pool.query(
      `SELECT dr.id, dr.courier_earning, dr.delivered_at, dr.pickup_location, dr.drop_location,
              l.title as listing_title, l.image_url as listing_image
       FROM delivery_requests dr
       LEFT JOIN listings l ON dr.listing_id = l.id
       WHERE dr.courier_id = $1 AND dr.status IN ('COMPLETED','DELIVERED')
       ORDER BY COALESCE(dr.delivered_at, dr.completed_at) DESC LIMIT 20`,
      [userId],
    );

    res.json({
      totalEarned: parseFloat(totalRes.rows[0].total),
      completedCount: parseInt(totalRes.rows[0].count),
      todayEarned: parseFloat(todayRes.rows[0].today_total),
      todayCount: parseInt(todayRes.rows[0].today_count),
      transactions: transactionsRes.rows,
    });
  } catch (error) {
    console.error('[DeliveryController] getEarnings error:', error.message);
    res.status(500).json({ error: 'Failed to fetch earnings.' });
  }
};

// ─────────────────────────────────────────────────────────────
//  GET /api/delivery/:id — Single delivery details
// ─────────────────────────────────────────────────────────────
exports.getDeliveryById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT dr.*, (SELECT payment_method FROM rentals WHERE id=dr.rental_id) AS payment_method,
              l.title as listing_title, l.image_url as listing_image, l.category as listing_category,
              u_seller.name as seller_name, u_seller.hostel as seller_hostel, u_seller.phone_number as seller_phone,
              u_customer.name as customer_name, u_customer.hostel as customer_hostel,
              u_courier.name as courier_name, u_courier.phone_number as courier_phone
       FROM delivery_requests dr
       LEFT JOIN listings l ON dr.listing_id = l.id
       LEFT JOIN users u_seller ON dr.seller_id = u_seller.id
       LEFT JOIN users u_customer ON dr.customer_id = u_customer.id
       LEFT JOIN users u_courier ON dr.courier_id = u_courier.id
       WHERE dr.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery request not found.' });
    }

    const delivery = result.rows[0];
    const allowed = [delivery.customer_id, delivery.seller_id, delivery.courier_id].filter(Boolean);
    if (!allowed.includes(userId)) {
      const offer = await pool.query(
        `SELECT 1 FROM delivery_offers WHERE delivery_id=$1 AND courier_id=$2
         AND status='PENDING' AND expires_at > NOW()`,
        [id, userId],
      );
      if (!offer.rowCount) return res.status(403).json({ error: 'Not authorized to view this delivery.' });
    }

    // Handover credentials are issued through the role-bound endpoint and are never returned here.
    res.json(redactDelivery(delivery));
  } catch (error) {
    console.error('[DeliveryController] getDeliveryById error:', error.message);
    res.status(500).json({ error: 'Failed to fetch delivery details.' });
  }
};

// ─────────────────────────────────────────────────────────────
//  POST /api/delivery/:id/accept — Courier accepts a delivery
// ─────────────────────────────────────────────────────────────
exports.acceptDelivery = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const availability = await client.query("SELECT delivery_available, EXISTS (SELECT 1 FROM courier_route_availability cra WHERE cra.courier_id=$1 AND cra.is_active AND cra.available_until > NOW()) AS route_active FROM users WHERE id=$1 FOR NO KEY UPDATE", [userId]);
    if (!availability.rows[0]?.delivery_available || !availability.rows[0]?.route_active) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Go online before accepting a delivery.' });
    }
    // The user row lock serializes simultaneous accepts for the same courier.
    await requireEligibleCourier(userId, client);
    const current = await client.query(`SELECT id FROM delivery_requests WHERE courier_id=$1
      AND status NOT IN ('COMPLETED','DELIVERED','CANCELLED','FAILED') UNION ALL SELECT id FROM wish_requests WHERE courier_id=$1 AND status IN ('CHECKING','QUOTED','PAYMENT_PENDING') LIMIT 1`, [userId]);
    if (current.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Finish your current delivery before accepting another.' });
    }
    // Lock the task before its offers. Competing couriers must not each hold
    // their own offer while waiting for the same task (a deadlock).
    const task = await client.query('SELECT courier_id, status, task_type FROM delivery_requests WHERE id=$1 FOR UPDATE', [id]);
    if (!task.rows[0] || task.rows[0].courier_id || !['AVAILABLE','MATCHING_COURIER','RETURN_MATCHING','NO_COURIER_AVAILABLE'].includes(task.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This delivery is no longer available.' });
    }
    if (task.rows[0].task_type === 'RENTAL_RETURN' && !req.body?.offer_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Refresh and review the current return destination before accepting.' });
    }
    const offer = await client.query(
      `UPDATE delivery_offers SET status='ACCEPTED', responded_at=NOW()
      WHERE delivery_id=$1 AND courier_id=$2 AND ($3::text IS NULL OR id::text=$3) AND status='PENDING' AND expires_at>NOW() AND (route_availability_id IS NULL OR EXISTS(SELECT 1 FROM courier_route_availability cra WHERE cra.id=route_availability_id AND cra.is_active AND cra.available_until>NOW())) RETURNING match_score, score_breakdown`,
      [id, userId, req.body?.offer_id || null],
    );
    if (!offer.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This offer expired or the task was assigned.' });
    }
    const result = await client.query(
      `UPDATE delivery_requests 
       SET courier_id = $1, status = 'COURIER_ASSIGNED', accepted_at = NOW(), match_score=$3, updated_at = NOW()
       WHERE id = $2 AND courier_id IS NULL AND status IN ('AVAILABLE','MATCHING_COURIER','RETURN_MATCHING','NO_COURIER_AVAILABLE') AND customer_id IS DISTINCT FROM $1 AND seller_id IS DISTINCT FROM $1
       RETURNING *`,
      [userId, id, offer.rows[0]?.match_score || null],
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res
        .status(409)
        .json({
          error: 'This delivery has already been accepted by another courier or is no longer available.',
        });
    }
    const removedOffers = await client.query(
      "UPDATE delivery_offers SET status='EXPIRED', responded_at=NOW() WHERE delivery_id=$1 AND courier_id<>$2 AND status='PENDING' RETURNING courier_id, delivery_id",
      [id, userId],
    );
    const delivery = result.rows[0];
    const prediction = offer.rows[0]?.score_breakdown?.eta;
    if (prediction) await client.query('UPDATE delivery_requests SET eta_prediction=$2,route_distance_meters=$3,estimated_time=$4 WHERE id=$1',[id,prediction,offer.rows[0].score_breakdown.routeDistanceMeters,`${prediction.lower}–${prediction.upper} min after pickup`]);
    if (delivery.rental_id)
      await client.query(
        `UPDATE rentals SET status=CASE WHEN $2='RENTAL_RETURN' THEN 'RETURN_COURIER_ASSIGNED' ELSE 'COURIER_ASSIGNED' END,
      updated_at=NOW() WHERE id=$1`,
        [delivery.rental_id, delivery.task_type],
      );
    await client.query(
      `INSERT INTO transaction_events (rental_id,delivery_id,xerox_request_id,event_type,actor_user_id,metadata)
      VALUES ($1,$2,$3,'COURIER_ASSIGNED',$4,$5)`,
      [
        delivery.rental_id,
        id,
        delivery.xerox_request_id,
        userId,
        { matchScore: offer.rows[0]?.match_score || null },
      ],
    );
    await client.query('COMMIT');
    console.log(`[DeliveryController] Courier ${userId} accepted delivery ${id}`);
    const payload = {
      id, delivery_id: id, rental_id: delivery.rental_id, listing_id: delivery.listing_id,
      item_description: delivery.item_description, status: 'COURIER_ASSIGNED', courier_id: userId,
    };
    for (const removed of removedOffers.rows) emitUser(removed.courier_id, 'delivery:offer-unavailable', { delivery_id: removed.delivery_id });
    emitDelivery(id, 'delivery:assigned', payload);
    emitDelivery(id, 'delivery:status', payload);
    emitUser(userId, 'delivery:assigned', payload);
    emitUser(delivery.customer_id, 'delivery:assigned', payload);
    emitUser(delivery.seller_id, 'delivery:assigned', payload);
    if (delivery.rental_id) {
      const rentalEvent = {
        rental_id: delivery.rental_id,
        delivery_id: id,
        status: 'COURIER_ASSIGNED',
        courier_id: userId,
      };
      emitUser(delivery.customer_id, 'rental:status', rentalEvent);
      emitUser(delivery.seller_id, 'rental:status', rentalEvent);
    }
    res.json({ message: 'Delivery accepted successfully!', delivery_id: id, status: 'COURIER_ASSIGNED' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DeliveryController] acceptDelivery error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to accept delivery.' });
  } finally {
    client.release();
  }
};

const TRANSITIONS = {
  COURIER_ASSIGNED: ['GOING_TO_PICKUP'],
  ACCEPTED: ['GOING_TO_PICKUP'],
  GOING_TO_PICKUP: ['ARRIVED_AT_PICKUP'],
  IN_TRANSIT: ['ARRIVED_AT_DESTINATION'],
  RETURN_COURIER_ASSIGNED: ['GOING_TO_PICKUP'],
};
const normalizeStatus = (status) =>
  ({
    ARRIVING_FOR_PICKUP: 'GOING_TO_PICKUP',
    PICKUP_VERIFIED: 'IN_TRANSIT',
    ORDER_COLLECTED: 'IN_TRANSIT',
    PICKED_UP: 'IN_TRANSIT',
    GOING_TO_DESTINATION: 'IN_TRANSIT',
    RETURN_PICKUP_VERIFIED: 'RETURN_IN_TRANSIT',
    ARRIVED: 'ARRIVED_AT_DESTINATION',
  })[status] || status;

exports.updateStatus = async (req, res) => {
  const { id } = req.params;
  const next = String(req.body.status || '').toUpperCase();
  const client = await pool.connect();
  let delivery;
  let current;
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM delivery_requests WHERE id = $1 AND courier_id = $2 FOR UPDATE', [id, req.user.id]);
    delivery = result.rows[0];
    if (!delivery) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Delivery not found.' });
    }
    current = normalizeStatus(delivery.status);
    const wishPickup = delivery.task_type === 'WISH_DELIVERY' && current === 'ARRIVED_AT_PICKUP' && next === 'IN_TRANSIT';
    if (wishPickup) {
      await requireHandoverPhoto(client, id, 'PICKUP');
      const paid = await client.query("SELECT 1 FROM wish_payments WHERE wish_id=$1 AND status='PAID'", [delivery.wish_request_id]);
      if (!paid.rowCount) throw Object.assign(new Error('Payment must be confirmed before collection.'), { status: 409 });
    }
    if (!wishPickup && !TRANSITIONS[current]?.includes(next)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot move from ${current} to ${next}.` });
    }
    const timestamp = wishPickup ? ', picked_up_at = NOW()' :
      next === 'ARRIVED_AT_PICKUP'
        ? ', arrived_pickup_at = NOW()'
        : next === 'ARRIVED_AT_DESTINATION'
          ? ', arrived_destination_at = NOW()'
          : next === 'COMPLETED'
            ? ', completed_at = NOW()'
            : '';
    await client.query(`UPDATE delivery_requests SET status = $1, updated_at = NOW()${timestamp} WHERE id = $2`, [next, id]);
    if (delivery.rental_id) {
      await client.query(
        `INSERT INTO transaction_events (rental_id, delivery_id, xerox_request_id, event_type, actor_user_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [delivery.rental_id, id, delivery.xerox_request_id, `DELIVERY_${next}`, req.user.id, { from: current, to: next }],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[DeliveryController] updateStatus error:', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Could not update delivery status.' });
  } finally {
    client.release();
  }

  const payload = { id, delivery_id: id, rental_id: delivery.rental_id, status: next, courier_id: req.user.id };
  emitDelivery(id, 'delivery:status', payload);
  emitUser(req.user.id, 'delivery:status', payload);
  emitUser(delivery.customer_id, 'delivery:status', payload);
  emitUser(delivery.seller_id, 'delivery:status', payload);
  if (next.startsWith('ARRIVED'))
    emitDelivery(id, 'delivery:notification', {
      message:
        next === 'ARRIVED_AT_PICKUP' ? 'Pickup point reached.' : 'You have reached the delivery destination.',
    });
  res.json(payload);
};

exports.updateLocation = async (req, res) => {
  const { id } = req.params;
  const { x, y, route_node_id = null, speed = 0 } = req.body;
  if (![x, y].every(Number.isFinite)) return res.status(400).json({ error: 'Numeric x and y are required.' });
  const allowed = await pool.query(
    'SELECT id,customer_id,seller_id,status FROM delivery_requests WHERE id = $1 AND courier_id = $2',
    [id, req.user.id],
  );
  if (!allowed.rowCount)
    return res.status(403).json({ error: 'Only the assigned courier can share a location.' });
  if (!['COURIER_ASSIGNED', 'GOING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'RETURN_COURIER_ASSIGNED', 'RETURN_IN_TRANSIT'].includes(allowed.rows[0].status))
    return res.status(409).json({ error: 'Location sharing is closed for this delivery stage.' });
  const { rows } = await pool.query(
    'INSERT INTO delivery_location_updates (delivery_id, courier_id, x, y, route_node_id, speed) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [id, req.user.id, x, y, route_node_id, speed],
  );
  emitDelivery(id, 'delivery:location', rows[0]);
  emitUser(allowed.rows[0].customer_id, 'delivery:location', rows[0]);
  emitUser(allowed.rows[0].seller_id, 'delivery:location', rows[0]);
  res.json(rows[0]);
};

exports.getTracking = async (req, res) => {
  const { id } = req.params;
  const delivery = await pool.query(
    `SELECT dr.*, (SELECT payment_method FROM rentals WHERE id=dr.rental_id) AS payment_method,
            l.title AS listing_title, l.image_url AS listing_image, l.category AS listing_category,
            u_seller.name AS seller_name, u_seller.hostel AS seller_hostel,
            u_customer.name AS customer_name, u_customer.hostel AS customer_hostel,
            u_courier.name AS courier_name, u_courier.phone_number AS courier_phone
     FROM delivery_requests dr
     LEFT JOIN listings l ON l.id = dr.listing_id
     LEFT JOIN users u_seller ON u_seller.id = dr.seller_id
     LEFT JOIN users u_customer ON u_customer.id = dr.customer_id
     LEFT JOIN users u_courier ON u_courier.id = dr.courier_id
     WHERE dr.id = $1`,
    [id],
  );
  if (!delivery.rowCount) return res.status(404).json({ error: 'Delivery not found.' });
  const d = redactDelivery(delivery.rows[0]);
  if (![d.customer_id, d.seller_id, d.courier_id].includes(req.user.id))
    return res.status(403).json({ error: 'Not authorized.' });
  const location = await pool.query(
    'SELECT x, y, speed, created_at FROM delivery_location_updates WHERE delivery_id = $1 ORDER BY created_at DESC LIMIT 1',
    [id],
  );
  res.json({ delivery: d, location: location.rows[0] || null });
};

exports.getDeliveryRoute = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dr.customer_id,dr.seller_id,dr.courier_id,p.*,
    d.id d_id,d.building_id d_building_id,d.route_node_id d_route_node_id,d.x d_x,d.y d_y,d.building_name d_building_name
    FROM delivery_requests dr JOIN campus_locations p ON p.id=dr.pickup_location_id
    JOIN campus_locations d ON d.id=dr.destination_location_id WHERE dr.id=$1`,
    [req.params.id],
  );
  const item = rows[0];
  if (!item) return res.status(404).json({ error: 'Delivery route not found.' });
  if (![item.customer_id, item.seller_id, item.courier_id].includes(req.user.id))
    return res.status(403).json({ error: 'Not authorized.' });
  const destination = {
    id: item.d_id,
    building_id: item.d_building_id,
    route_node_id: item.d_route_node_id,
    x: item.d_x,
    y: item.d_y,
    building_name: item.d_building_name,
  };
  res.json(routeFor(item, destination));
};

// ─────────────────────────────────────────────────────────────
//  GET /api/delivery/rental/:rentalId — Get delivery status for a rental
//  (Used by RentDetails / OwnerDashboard to show courier info)
// ─────────────────────────────────────────────────────────────
exports.getRentalDeliveryStatus = async (req, res) => {
  const { rentalId } = req.params;
  const userId = req.user.id;

  try {
    const access = await pool.query(
      'SELECT id,status,delivery_requested,deposit_status,owner_id,borrower_id FROM rentals WHERE id=$1 AND (borrower_id=$2 OR owner_id=$2)',
      [rentalId, userId],
    );
    const rental = access.rows[0];
    if (!rental) return res.status(403).json({ error: 'You do not have access to this rental delivery.' });

    const result = await pool.query(
      "SELECT dr.*, (SELECT payment_method FROM rentals WHERE id=dr.rental_id) AS payment_method, l.title AS listing_title, l.image_url AS listing_image, l.category AS listing_category, owner.name AS owner_name, owner.hostel AS owner_hostel, renter.name AS renter_name, renter.hostel AS renter_hostel, courier.name AS courier_name, courier.phone_number AS courier_phone, courier.hostel AS courier_hostel FROM delivery_requests dr JOIN rentals r ON r.id=dr.rental_id LEFT JOIN listings l ON l.id=dr.listing_id LEFT JOIN users owner ON owner.id=r.owner_id LEFT JOIN users renter ON renter.id=r.borrower_id LEFT JOIN users courier ON courier.id=dr.courier_id WHERE dr.rental_id=$1 ORDER BY CASE WHEN dr.status IN ('MATCHING_COURIER','COURIER_ASSIGNED','GOING_TO_PICKUP','ARRIVED_AT_PICKUP','IN_TRANSIT','ARRIVED_AT_DESTINATION','RETURN_LOCATION_PENDING','RETURN_MATCHING','RETURN_COURIER_ASSIGNED','RETURN_IN_TRANSIT','DELIVERY_PAYMENT_PENDING') THEN 0 WHEN dr.id=r.outbound_delivery_id THEN 1 WHEN dr.id=r.return_delivery_id THEN 2 ELSE 3 END, dr.created_at DESC LIMIT 1",
      [rentalId],
    );

    const delivery = result.rows[0];
    if (!delivery) {
      const blockedBy = ['OWNER_PENDING', 'RENTAL_PAYMENT_COMPLETED'].includes(rental.status)
        ? 'OWNER_APPROVAL'
        : rental.status === 'DEPOSIT_PENDING'
          ? 'SECURITY_DEPOSIT'
          : 'DELIVERY_REQUEST';
      return res.json({
        has_delivery: false,
        rental_status: rental.status,
        blocked_by: blockedBy,
        next_action: blockedBy === 'OWNER_APPROVAL'
          ? 'Wait for the listing owner to accept the rental.'
          : blockedBy === 'SECURITY_DEPOSIT'
            ? 'Pay the security deposit to start courier matching.'
            : 'Delivery details are being prepared.',
        tracking: null,
      });
    }

    const handovers = await pool.query(
      'SELECT stage,status,expires_at,verified_at FROM handover_verifications WHERE delivery_id=$1 ORDER BY stage',
      [delivery.id],
    );
    const pickupStage = delivery.task_type === 'XEROX_DELIVERY'
      ? 'XEROX_PICKUP'
      : delivery.task_type === 'RENTAL_RETURN'
        ? 'RETURN_PICKUP'
        : 'PICKUP';
    const deliveryStage = delivery.task_type === 'RENTAL_RETURN' ? 'RETURN_RECEIVED' : 'DELIVERY';
    const trackingResult = await pool.query(
      'SELECT x, y, route_node_id, speed, created_at FROM delivery_location_updates WHERE delivery_id=$1 ORDER BY created_at DESC LIMIT 1',
      [delivery.id],
    );
    const pickupHandover = handovers.rows.find((item) => item.stage === pickupStage);
    const deliveryHandover = handovers.rows.find((item) => item.stage === deliveryStage);
    const nextHandshake = delivery.status === 'COMPLETED'
      ? null
      : delivery.status === 'ARRIVED_AT_PICKUP' && pickupHandover?.status !== 'USED'
        ? pickupStage
        : delivery.task_type === 'RENTAL_RETURN' && delivery.status === 'RETURN_IN_TRANSIT' && pickupHandover?.status === 'USED'
          ? deliveryStage
          : delivery.status === 'ARRIVED_AT_DESTINATION' && pickupHandover?.status === 'USED'
            ? deliveryStage
            : null;

    const blockedBy = delivery.status === 'DELIVERY_PAYMENT_PENDING'
      ? 'DELIVERY_PAYMENT'
      : delivery.status === 'WAITING_FOR_DEPOSIT'
      ? 'SECURITY_DEPOSIT'
      : delivery.status === 'NO_COURIER_AVAILABLE'
        ? 'ROUTE_MATCH'
        : null;
    const nextAction = blockedBy === 'DELIVERY_PAYMENT'
      ? 'Handover verified. The borrower must pay the delivery fee, then the courier confirms receipt to complete delivery.'
      : blockedBy === 'SECURITY_DEPOSIT'
      ? 'Pay the security deposit before a courier can accept.'
      : blockedBy === 'ROUTE_MATCH'
        ? 'Waiting for an available courier to accept.'
        : nextHandshake
          ? 'Complete the ' + nextHandshake.replaceAll('_', ' ').toLowerCase() + ' handover.'
          : delivery.status === 'MATCHING_COURIER'
            ? 'Searching for an online courier.'
            : delivery.status === 'COURIER_ASSIGNED'
              ? 'Your courier is preparing to collect the item.'
              : null;

    res.json({
      has_delivery: true,
      delivery_id: delivery.id,
      rental_id: delivery.rental_id,
      listing_id: delivery.listing_id,
      listing_title: delivery.listing_title,
      listing_image: delivery.listing_image,
      task_type: delivery.task_type,
      status: delivery.status,
      blocked_by: blockedBy,
      next_action: nextAction,
      owner: { id: rental.owner_id, name: delivery.owner_name || null, hostel: delivery.owner_hostel || null },
      renter: { id: rental.borrower_id, name: delivery.renter_name || null, hostel: delivery.renter_hostel || null },
      courier: delivery.courier_id
        ? { id: delivery.courier_id, name: delivery.courier_name || null, hostel: delivery.courier_hostel || null, phone: delivery.courier_phone || null }
        : null,
      owner_name: delivery.owner_name || null,
      renter_name: delivery.renter_name || null,
      courier_name: delivery.courier_name || null,
      courier_phone: delivery.courier_phone || null,
      pickup_location: delivery.pickup_location,
      drop_location: delivery.drop_location,
      pickup_location_id: delivery.pickup_location_id,
      destination_location_id: delivery.destination_location_id,
      delivery_fee: delivery.delivery_fee,
      estimated_time: delivery.estimated_time,
      accepted_at: delivery.accepted_at,
      picked_up_at: delivery.picked_up_at,
      delivered_at: delivery.delivered_at,
      arrived_pickup_at: delivery.arrived_pickup_at,
      arrived_destination_at: delivery.arrived_destination_at,
      pickup_verified_at: delivery.pickup_verified_at,
      delivery_verified_at: delivery.delivery_verified_at,
      updated_at: delivery.updated_at,
      handovers: handovers.rows,
      pickup_handover_status: pickupHandover?.status || null,
      delivery_handover_status: deliveryHandover?.status || null,
      next_handshake: nextHandshake,
      tracking: trackingResult.rows[0] || null,
    });
  } catch (error) {
    console.error('[DeliveryController] getRentalDeliveryStatus error:', error.message);
    res.status(500).json({ error: 'Failed to fetch delivery status.' });
  }
};
