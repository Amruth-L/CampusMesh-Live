const pool = require('../../config/database');

const ROLES = new Set(['RENTER', 'OWNER', 'COURIER']);
const isoCursor = (value) => {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded?.updatedAt || !decoded?.id) return null;
    return decoded;
  } catch {
    return null;
  }
};
const makeCursor = (row) => Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id })).toString('base64url');
const cleanMetadata = (value) => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|transaction|payment.?id|gateway)/i.test(key)));
};
const roleFor = (row, userId) => {
  if (row.borrower_id === userId) return 'RENTER';
  if (row.owner_id === userId) return 'OWNER';
  return 'COURIER';
};
const roleStatus = (row) => row.delivery_status === 'COMPLETED' || row.delivery_status === 'DELIVERED' ? 'COMPLETED' : row.status;

exports.getHistory = async (req, res) => {
  const userId = req.user.id;
  const role = String(req.query.role || '').toUpperCase();
  const status = String(req.query.status || '').toUpperCase();
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20', 10) || 20, 1), 50);
  const cursor = req.query.cursor ? isoCursor(req.query.cursor) : null;
  if (role && role !== 'ALL' && !ROLES.has(role)) return res.status(400).json({ error: 'Invalid history role.' });

  const params = [userId];
  const where = [
    `(r.borrower_id=$1 OR r.owner_id=$1 OR EXISTS (
      SELECT 1 FROM delivery_requests courier_delivery
      WHERE courier_delivery.rental_id=r.id AND courier_delivery.courier_id=$1
    ))`,
  ];
  if (role === 'RENTER') where.push('r.borrower_id=$1');
  if (role === 'OWNER') where.push('r.owner_id=$1');
  if (role === 'COURIER') where.push(`EXISTS (
    SELECT 1 FROM delivery_requests courier_role_delivery
    WHERE courier_role_delivery.rental_id=r.id AND courier_role_delivery.courier_id=$1
  )`);
  if (status === 'COMPLETED') where.push(`(r.status IN ('COMPLETED','DEPOSIT_REFUNDED') OR d.status IN ('COMPLETED','DELIVERED'))`);
  if (status && status !== 'ALL' && status !== 'COMPLETED') {
    params.push(status);
    where.push(`(r.status=$${params.length} OR d.status=$${params.length})`);
  }
  if (cursor) {
    params.push(cursor.updatedAt, cursor.id);
    where.push(`(COALESCE(r.updated_at,r.created_at),r.id) < ($${params.length - 1},$${params.length})`);
  }
  params.push(limit + 1);

  try {
    const result = await pool.query(
      `SELECT r.id, r.listing_id, r.borrower_id, r.owner_id, r.status, r.booking_status,
        r.payment_status, r.deposit_status, r.rental_fee, r.delivery_fee, r.platform_fee,
        r.booking_amount, r.deposit_amount, r.created_at, r.updated_at, r.completed_at,
        l.title AS listing_title, l.image_url AS listing_image, l.category AS listing_category,
        owner.name AS owner_name, renter.name AS renter_name,
        d.id AS delivery_id, d.status AS delivery_status, d.task_type,
        d.pickup_location, d.drop_location, d.courier_id, courier.name AS courier_name,
        d.courier_earning, d.accepted_at, d.completed_at AS delivery_completed_at,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.rental_id=r.id AND p.status='PAID'),0) AS renter_paid,
        COALESCE((SELECT SUM(ref.refund_amount) FROM refunds ref WHERE ref.rental_id=r.id AND ref.refund_status IN ('PROCESSED','COMPLETED')),0) AS refund_amount
       FROM rentals r
       JOIN listings l ON l.id=r.listing_id
       JOIN users owner ON owner.id=r.owner_id
       JOIN users renter ON renter.id=r.borrower_id
       LEFT JOIN LATERAL (
         SELECT d.* FROM delivery_requests d
         WHERE d.rental_id=r.id AND (d.task_type='RENTAL_OUTBOUND' OR d.courier_id=$1)
         ORDER BY CASE WHEN d.courier_id=$1 THEN 0 WHEN d.task_type='RENTAL_OUTBOUND' THEN 1 ELSE 2 END,
           d.updated_at DESC, d.created_at DESC
         LIMIT 1
       ) d ON TRUE
       LEFT JOIN users courier ON courier.id=d.courier_id
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(r.updated_at,r.created_at) DESC, r.id DESC
       LIMIT $${params.length}`,
      params,
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const rentalIds = rows.map((row) => row.id);
    const eventsResult = rentalIds.length ? await pool.query(
      `SELECT e.rental_id, e.delivery_id, e.event_type, e.metadata, e.created_at,
        actor.id AS actor_id, actor.name AS actor_name
       FROM transaction_events e
       LEFT JOIN users actor ON actor.id=e.actor_user_id
       WHERE e.rental_id = ANY($1::uuid[])
       ORDER BY e.created_at ASC`,
      [rentalIds],
    ) : { rows: [] };
    const eventsByRental = new Map();
    for (const event of eventsResult.rows) {
      if (!eventsByRental.has(event.rental_id)) eventsByRental.set(event.rental_id, []);
      eventsByRental.get(event.rental_id).push({
        id: `${event.rental_id}:${event.created_at}:${event.event_type}`,
        type: event.event_type,
        label: String(event.event_type || '').toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()),
        at: event.created_at,
        actor: event.actor_id ? { id: event.actor_id, name: event.actor_name } : null,
        metadata: cleanMetadata(event.metadata),
      });
    }

    const records = rows.map((row) => {
      const currentRole = roleFor(row, userId);
      const currentStatus = roleStatus(row);
      const ownerEarning = currentRole === 'OWNER' ? Number(row.rental_fee || 0) : 0;
      const courierPayout = currentRole === 'COURIER' ? Number(row.courier_earning || 0) : 0;
      return {
        id: `${row.id}:${currentRole}`,
        rental_id: row.id,
        role: currentRole,
        status: currentStatus,
        item: { id: row.listing_id, title: row.listing_title, image: row.listing_image, category: row.listing_category },
        participants: {
          owner: { id: row.owner_id, name: row.owner_name },
          renter: { id: row.borrower_id, name: row.renter_name },
          courier: row.courier_id ? { id: row.courier_id, name: row.courier_name } : null,
        },
        locations: row.delivery_id ? { pickup: row.pickup_location, destination: row.drop_location } : {
          pickup: row.pickup_location || null,
          destination: row.drop_location || null,
        },
        amounts: {
          rentalFee: Number(row.rental_fee || 0),
          deliveryFee: Number(row.delivery_fee || 0),
          bookingAmount: Number(row.booking_amount || 0),
          depositAmount: Number(row.deposit_amount || 0),
          renterPaid: Number(row.renter_paid || 0),
          ownerEarning,
          courierPayout,
          refundAmount: Number(row.refund_amount || 0),
        },
        created_at: row.created_at,
        completed_at: row.delivery_completed_at || row.completed_at || null,
        delivery: row.delivery_id ? {
          id: row.delivery_id,
          status: row.delivery_status,
          task_type: row.task_type,
          accepted_at: row.accepted_at,
        } : null,
        events: eventsByRental.get(row.id) || [],
      };
    });
    res.json({
      records,
      nextCursor: hasMore && rows.length ? makeCursor(rows[rows.length - 1]) : null,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ActivityController] getHistory error:', error.message);
    res.status(500).json({ error: 'Failed to fetch activity history.' });
  }
};
