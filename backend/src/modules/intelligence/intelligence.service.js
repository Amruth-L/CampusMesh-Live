const pool = require('../../config/database');
const { routeFor } = require('../campus/campus.service');
const { forecastDemand, trustEstimate, trainEta, predictEta } = require('./models');
const categories = ['Books', 'Electronics', 'Stationery', 'Lab Equipment', 'Sports', 'Hostel Essentials'];
let etaCache;
async function etaModel(db = pool) {
  if (db === pool && etaCache && etaCache.until > Date.now()) return etaCache.value;
  const { rows } =
    await db.query(`SELECT d.route_distance_meters, p.route_node_id pickup_node, t.route_node_id destination_node,
    EXTRACT(EPOCH FROM (COALESCE(d.completed_at,d.delivered_at)-d.pickup_verified_at))/60 AS minutes
    FROM delivery_requests d JOIN listings l ON l.id=d.listing_id
    JOIN campus_locations p ON p.id=d.pickup_location_id JOIN campus_locations t ON t.id=d.destination_location_id
    JOIN users u ON u.id=d.courier_id
    WHERE d.status IN ('COMPLETED','DELIVERED') AND d.pickup_verified_at IS NOT NULL AND l.demo_slug IS NULL
      AND u.email NOT LIKE 'qa-%' AND d.task_type<>'WISH_DELIVERY'
    ORDER BY COALESCE(d.completed_at,d.delivered_at) DESC LIMIT 500`);
  const value = trainEta(
    rows.reverse().map((r) => ({
      meters:
        r.route_distance_meters === null
          ? routeFor(r.pickup_node, r.destination_node)?.distanceMeters
          : Number(r.route_distance_meters),
      minutes: Number(r.minutes),
    })),
  );
  if (db === pool) etaCache = { value, until: Date.now() + 300000 };
  return value;
}
async function recommendations(userId, { db = pool, includeDemo = true } = {}) {
  const { rows } = await db.query(
    `WITH views AS (
    SELECT i.listing_id,COUNT(DISTINCT i.user_id) FILTER(WHERE i.created_at>NOW()-INTERVAL '7 days')::int recent,
    COUNT(DISTINCT i.user_id) FILTER(WHERE i.created_at<=NOW()-INTERVAL '7 days')::int previous
    FROM listing_interactions i JOIN listings l ON l.id=i.listing_id JOIN users u ON u.id=i.user_id
    WHERE i.interaction_type='VIEW' AND i.created_at>NOW()-INTERVAL '14 days' AND i.user_id<>l.owner_id AND u.email NOT LIKE 'qa-%' GROUP BY i.listing_id
  ), saved AS (SELECT w.item_id,COUNT(DISTINCT w.user_id)::int n FROM wishlist w JOIN users u ON u.id=w.user_id JOIN listings l ON l.id=w.item_id WHERE w.created_at>NOW()-INTERVAL '14 days' AND w.user_id<>l.owner_id AND u.email NOT LIKE 'qa-%' GROUP BY w.item_id),
  paid AS (SELECT r.listing_id,COUNT(*)::int n FROM rentals r JOIN users u ON u.id=r.borrower_id WHERE r.payment_status IN ('RENTAL_PAID','FULLY_PAID') AND r.status NOT IN ('CANCELLED','REJECTED') AND r.created_at>NOW()-INTERVAL '30 days' AND u.email NOT LIKE 'qa-%' GROUP BY r.listing_id),
  affinity AS (SELECT l.category,COUNT(DISTINCT i.listing_id)::int n FROM listing_interactions i JOIN listings l ON l.id=i.listing_id WHERE i.user_id=$1 AND i.created_at>NOW()-INTERVAL '30 days' GROUP BY l.category)
  SELECT l.*,COALESCE(v.recent,0) recent_views,COALESCE(v.previous,0) previous_views,COALESCE(s.n,0) saves,COALESCE(p.n,0) paid_rentals,COALESCE(a.n,0) affinity
  FROM listings l LEFT JOIN views v ON v.listing_id=l.id LEFT JOIN saved s ON s.item_id=l.id LEFT JOIN paid p ON p.listing_id=l.id LEFT JOIN affinity a ON a.category=l.category
  WHERE l.is_active AND l.rent_price>0 AND l.owner_id<>$1 AND ($2::boolean OR l.demo_slug IS NULL)
  AND NOT EXISTS(SELECT 1 FROM rentals r WHERE r.listing_id=l.id AND r.status NOT IN ('COMPLETED','DEPOSIT_REFUNDED','CANCELLED','REJECTED') AND r.start_date<=CURRENT_DATE AND r.end_date>=CURRENT_DATE)
  ORDER BY l.created_at DESC LIMIT 300`,
    [userId, includeDemo],
  );
  const scored = rows
    .map((l) => {
      const evidence = l.demo_slug ? 0 : l.recent_views + 3 * l.saves + 10 * l.paid_rentals;
      const momentum = l.demo_slug ? 0 : Math.max(0, l.recent_views - l.previous_views);
      const score = evidence + Math.min(momentum, 15) + Math.min(l.affinity, 5) * 2;
      const reason = l.demo_slug
        ? 'Explore this demo item'
        : l.paid_rentals >= 3
          ? `${l.paid_rentals} paid rentals in the last 30 days`
          : l.recent_views >= 5
            ? `${l.recent_views} members viewed it this week`
            : l.affinity > 0
              ? `Based on your interest in ${l.category}`
              : 'New item to explore';
      return { ...l, score, evidence, reason };
    })
    .sort((a, b) => b.score - a.score);
  // Cap each category to keep one busy category from crowding out discovery.
  const counts = {};
  return scored
    .filter((l) => {
      counts[l.category] = (counts[l.category] || 0) + 1;
      return counts[l.category] <= 2;
    })
    .slice(0, 8);
}
async function market(db = pool) {
  const { rows } =
    await db.query(`SELECT l.category, (r.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date::text AS activity_day,COUNT(*)::int n
    FROM rentals r JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.borrower_id
    WHERE r.created_at>NOW()-INTERVAL '28 days' AND r.payment_status IN ('RENTAL_PAID','FULLY_PAID') AND r.status NOT IN ('CANCELLED','REJECTED') AND l.demo_slug IS NULL AND u.email NOT LIKE 'qa-%'
    GROUP BY l.category,activity_day`);
  const current = (await db.query("SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS activity_day"))
    .rows[0].activity_day;
  const days = Array.from({ length: 28 }, (_, i) =>
    new Date(Date.parse(current + 'T00:00:00Z') - (27 - i) * 86400000).toISOString().slice(0, 10),
  );
  return {
    generatedAt: new Date().toISOString(),
    categories: categories.map((category) => {
      const daily = days.map(
        (day) => rows.find((r) => r.category === category && r.activity_day === day)?.n || 0,
      );
      return { category, daily, days, ...forecastDemand(daily) };
    }),
    scope:
      'Paid CampusMesh rentals, excluding demo and test activity. External market hype is not available.',
  };
}
async function trust(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int completed,COUNT(*) FILTER(WHERE (r.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date<=r.end_date)::int on_time
    FROM rentals r JOIN listings l ON l.id=r.listing_id WHERE r.borrower_id=$1 AND r.completed_at IS NOT NULL
    AND r.status IN ('COMPLETED','DEPOSIT_REFUNDED') AND r.payment_status='FULLY_PAID' AND l.demo_slug IS NULL`,
    [userId],
  );
  return trustEstimate(rows[0].completed, rows[0].on_time);
}
module.exports = { market, trust, recommendations, etaModel, predictEta };
