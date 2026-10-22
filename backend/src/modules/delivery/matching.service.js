const pool = require('../../config/database');
const { routeFor } = require('../campus/campus.service');
const { emitUser } = require('../../shared/realtime');
const { etaModel, predictEta } = require('../intelligence/intelligence.service');

const OPEN_STATUSES = ['MATCHING_COURIER', 'RETURN_MATCHING', 'AVAILABLE', 'NO_COURIER_AVAILABLE'];

const overlapMeters = (courierNodes, taskNodes, taskDistance) => {
  const courierEdges = new Set(courierNodes.slice(1).map((node, i) => [courierNodes[i], node].join(':')));
  const shared = taskNodes.slice(1).filter((node, i) => courierEdges.has([taskNodes[i], node].join(':'))).length;
  return taskNodes.length > 1 ? taskDistance * shared / (taskNodes.length - 1) : 0;
};

function scoreCandidate(route, task, reliability = 100) {
  const courierPath = routeFor(route.origin, route.destination);
  const taskPath = routeFor(task.pickup, task.destination);
  const toPickup = routeFor(route.origin, task.pickup);
  const fromDrop = routeFor(task.destination, route.destination);
  if (!courierPath || !toPickup || !fromDrop) return null;

  // Same-location delivery (e.g. xerox to same building): skip overlap scoring
  if (!taskPath || taskPath.distanceMeters === 0) {
    if (!courierPath.nodes.includes(task.pickup)) return null;
    const pickupDetour = Math.max(0, toPickup.distanceMeters + fromDrop.distanceMeters - courierPath.distanceMeters);
    if (pickupDetour > route.max_detour_meters) return null;
    const finishAt = Date.now() + (toPickup.distanceMeters + fromDrop.distanceMeters) / 78 * 60000;
    if (new Date(route.available_until).getTime() < finishAt) return null;
    const breakdown = {
      routeOverlap: 45,
      pickupDetour: Math.round(Math.max(0, 1 - pickupDetour / Math.max(route.max_detour_meters, 1)) * 25),
      dropoffDetour: 15,
      availability: 10,
      reliability: Math.round(Math.min(100, Number(reliability)) / 100 * 5),
    };
    return { score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown, courierPath, taskPath: taskPath || courierPath };
  }

  const sharedMeters = overlapMeters(courierPath.nodes, taskPath.nodes, taskPath.distanceMeters);
  const overlapRatio = taskPath.distanceMeters ? sharedMeters / taskPath.distanceMeters : 0;
  const pickupDetour = Math.max(0, toPickup.distanceMeters + taskPath.distanceMeters + fromDrop.distanceMeters - courierPath.distanceMeters);
  const dropDetour = Math.max(0, fromDrop.distanceMeters - courierPath.distanceMeters * .25);
  const finishAt = Date.now() + (toPickup.distanceMeters + taskPath.distanceMeters + fromDrop.distanceMeters) / 78 * 60000;
  if (pickupDetour > route.max_detour_meters || overlapRatio < .15 || new Date(route.available_until).getTime() < finishAt) return null;
  const breakdown = {
    routeOverlap: Math.round(overlapRatio * 45),
    pickupDetour: Math.round(Math.max(0, 1 - pickupDetour / Math.max(route.max_detour_meters, 1)) * 25),
    dropoffDetour: Math.round(Math.max(0, 1 - dropDetour / Math.max(route.max_detour_meters, 1)) * 15),
    availability: 10,
    reliability: Math.round(Math.min(100, Number(reliability)) / 100 * 5),
  };
  return { score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown, courierPath, taskPath };
}


async function matchDelivery(deliveryId, connection) {
  const client = connection || await pool.connect();
  const notifications = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM delivery_requests WHERE id=$1 FOR UPDATE', [deliveryId]);
    const result = await matchLockedDelivery(deliveryId, client, notifications);
    await client.query('COMMIT');
    for (const [user, payload] of notifications) emitUser(user, 'delivery:offer', payload);
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { if (!connection) client.release(); }
}

async function matchLockedDelivery(deliveryId, client, notifications) {
  const deliveryResult = await client.query(`SELECT dr.*, p.route_node_id pickup_node, d.route_node_id destination_node
    FROM delivery_requests dr JOIN campus_locations p ON p.id = dr.pickup_location_id
    JOIN campus_locations d ON d.id = dr.destination_location_id WHERE dr.id = $1`, [deliveryId]);
  const task = deliveryResult.rows[0];
  const safeTask = { ...task };
  delete safeTask.pickup_token;
  delete safeTask.delivery_token;
  if (!task || !OPEN_STATUSES.includes(task.status) || task.courier_id) return [];
  const model = await etaModel(client);
  const candidates = await client.query(`SELECT cra.*,
      COALESCE((SELECT 100.0*(COUNT(*) FILTER(WHERE d.status IN ('COMPLETED','DELIVERED'))+2)/(COUNT(*)+4) FROM delivery_requests d LEFT JOIN listings history_listing ON history_listing.id=d.listing_id WHERE d.courier_id=cra.courier_id AND d.status IN ('COMPLETED','DELIVERED','FAILED') AND history_listing.demo_slug IS NULL AND u.email NOT LIKE 'qa-%'),50) courier_reliability_score,
      o.route_node_id origin_node, d.route_node_id destination_node
    FROM courier_route_availability cra JOIN users u ON u.id = cra.courier_id
    LEFT JOIN campus_locations o ON o.id = cra.origin_location_id LEFT JOIN campus_locations d ON d.id = cra.destination_location_id
    WHERE cra.is_active AND cra.available_until > NOW() AND u.delivery_available
      AND NOT EXISTS (SELECT 1 FROM wish_requests w WHERE w.courier_id=cra.courier_id AND w.status IN ('CHECKING','QUOTED','PAYMENT_PENDING'))
      AND cra.courier_id NOT IN (SELECT courier_id FROM delivery_requests WHERE courier_id IS NOT NULL AND status IN (
        'COURIER_ASSIGNED','ACCEPTED','GOING_TO_PICKUP','ARRIVING_FOR_PICKUP','ARRIVED_AT_PICKUP',
        'PICKUP_VERIFIED','ORDER_COLLECTED','PICKED_UP','GOING_TO_DESTINATION','IN_TRANSIT',
        'ARRIVED_AT_DESTINATION','ARRIVED','RETURN_COURIER_ASSIGNED','RETURN_MATCHING','RETURN_PICKUP_VERIFIED','RETURN_IN_TRANSIT'
      ))
      AND ($1::uuid IS NULL OR cra.courier_id <> $1)
      AND ($2::uuid IS NULL OR cra.courier_id <> $2)
      AND NOT (cra.courier_id = ANY($3::uuid[]))
      AND NOT EXISTS (SELECT 1 FROM delivery_offers previous WHERE previous.delivery_id=$4
        AND previous.courier_id=cra.courier_id AND (previous.status IN ('DECLINED','ACCEPTED')
          OR (previous.status='EXPIRED' AND previous.route_availability_id=cra.id)))`,
    [task.customer_id, task.seller_id, task.declined_by || [], deliveryId]);
  const eligibleCandidates = [];
  for (const candidate of candidates.rows) {
    const mesh = await require('./mesh-score').getMeshScore(candidate.courier_id, client);
    if (mesh.eligible) eligibleCandidates.push({ ...candidate, courier_reliability_score: mesh.score ?? 50 });
  }
  const ranked = eligibleCandidates.map(candidate => {
    if (candidate.availability_mode === 'OPEN') {
      const taskPath = routeFor(task.pickup_node, task.destination_node);
      if (!taskPath) return null;
      const eta = predictEta(taskPath.distanceMeters, model);
      // No current position is known: only estimate the journey after pickup.
      return { ...candidate, score: 10, breakdown: {
        availabilityMode: 'OPEN', eta, routeDistanceMeters: taskPath.distanceMeters,
        explanation: 'You are online for campus requests. Review the pickup, drop-off and earning, then accept or decline.',
      } };
    }
    const scored = scoreCandidate({ ...candidate, origin: candidate.origin_node, destination: candidate.destination_node },
      { pickup: task.pickup_node, destination: task.destination_node }, candidate.courier_reliability_score);
    if (!scored) return null;
    const eta = predictEta(scored.taskPath.distanceMeters, model);
    const toPickup = routeFor(candidate.origin_node, task.pickup_node);
    if (Date.now() + (toPickup.etaMinutes + eta.upper + routeFor(task.destination_node,candidate.destination_node).etaMinutes) * 60000 > new Date(candidate.available_until).getTime()) return null;
    return { ...candidate, ...scored, breakdown: { ...scored.breakdown, eta, routeDistanceMeters: scored.taskPath.distanceMeters, detourMeters: Math.max(0,toPickup.distanceMeters+scored.taskPath.distanceMeters+routeFor(task.destination_node,candidate.destination_node).distanceMeters-scored.courierPath.distanceMeters), explanation: 'Matches your direction, detour limit and available time. You choose whether to accept.' } };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (ranked.length) {
    const movedToMatching = await client.query("UPDATE delivery_requests SET status = 'MATCHING_COURIER', updated_at=NOW() WHERE id = $1 AND status IN ('AVAILABLE', 'NO_COURIER_AVAILABLE')", [deliveryId]);
    if (movedToMatching.rowCount && task.rental_id) {
      await client.query(
        `INSERT INTO transaction_events (rental_id, delivery_id, event_type, metadata)
         VALUES ($1, $2, 'COURIER_MATCHING', $3)`,
        [task.rental_id, deliveryId, { offerCount: ranked.length }],
      );
    }
  }
  for (const candidate of ranked) {
    const { rows } = await client.query(`INSERT INTO delivery_offers (delivery_id, courier_id, match_score, score_breakdown, route_availability_id, expires_at)
      SELECT $1,$2,$3,$4,$5,NOW() + INTERVAL '5 minutes' WHERE EXISTS (SELECT 1 FROM courier_route_availability WHERE id=$5 AND is_active AND available_until>NOW()) ON CONFLICT (delivery_id, courier_id)
      DO UPDATE SET match_score=EXCLUDED.match_score, score_breakdown=EXCLUDED.score_breakdown,
        status='PENDING', route_availability_id=EXCLUDED.route_availability_id, offered_at=NOW(), expires_at=EXCLUDED.expires_at, responded_at=NULL
      WHERE delivery_offers.status IN ('EXPIRED','PENDING') AND delivery_offers.route_availability_id IS DISTINCT FROM EXCLUDED.route_availability_id
      RETURNING *`, [deliveryId, candidate.courier_id, candidate.score, candidate.breakdown, candidate.id]);
    if (rows[0]?.status === 'PENDING') notifications.push([candidate.courier_id, { ...rows[0], delivery: safeTask }]);
  }
  if (!ranked.length && task.status !== 'RETURN_MATCHING') {
    const noCourier = await client.query("UPDATE delivery_requests SET status = 'NO_COURIER_AVAILABLE', updated_at=NOW() WHERE id = $1 AND status IN ('MATCHING_COURIER','AVAILABLE')", [deliveryId]);
    if (noCourier.rowCount && task.rental_id) {
      await client.query(
        `INSERT INTO transaction_events (rental_id, delivery_id, event_type)
         VALUES ($1, $2, 'NO_COURIER_AVAILABLE')`,
        [task.rental_id, deliveryId],
      );
    }
  }
  return ranked;
}


let refreshInFlight = false;
async function refreshOpenDeliveries() {
  if (refreshInFlight) return { skipped: true };
  refreshInFlight = true;
  let client;
  try {
    await require('../wishes/wish.service').createWishService().expire();
    client = await pool.connect();
    await client.query("UPDATE delivery_offers SET status='EXPIRED', responded_at=NOW() WHERE status='PENDING' AND expires_at <= NOW()");
    await client.query("UPDATE courier_route_availability SET is_active=FALSE WHERE is_active AND available_until <= NOW()");
    await client.query("UPDATE users SET delivery_available=FALSE WHERE delivery_available AND NOT EXISTS (SELECT 1 FROM courier_route_availability cra WHERE cra.courier_id=users.id AND cra.is_active AND cra.available_until > NOW())");
    const openTasks = await client.query(
      "SELECT id FROM delivery_requests WHERE courier_id IS NULL AND status = ANY($1::text[])",
      [OPEN_STATUSES],
    );
    for (const task of openTasks.rows) await matchDelivery(task.id, client);
    return { refreshed: openTasks.rowCount };
  } finally {
    client?.release();
    refreshInFlight = false;
  }
}

module.exports = { scoreCandidate, matchDelivery, refreshOpenDeliveries };
