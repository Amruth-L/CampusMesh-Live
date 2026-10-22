const crypto = require('crypto');
const pool = require('../../config/database');
const razorpay = require('../../config/razorpay');
const { routeFor } = require('../campus/campus.service');
const { emitUser } = require('../../shared/realtime');
const { requireEligibleCourier } = require('../delivery/mesh-score');

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    fail(400, `Please enter valid text (${max} characters maximum).`);
  return value.trim();
};
const amountInPaise = (value) => {
  if (!/^(?:\d{1,6})(?:\.\d{1,2})?$/.test(String(value)))
    fail(400, 'Enter a price with at most two decimal places.');
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 10000000)
    fail(400, 'The agreed amount must be between ₹1 and ₹100,000.');
  return amount;
};
function verifySignature(orderId, paymentId, signature, secret) {
  if (
    !secret ||
    typeof paymentId !== 'string' ||
    !/^pay_[a-zA-Z0-9]+$/.test(paymentId) ||
    typeof signature !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(signature)
  )
    fail(400, 'Invalid payment verification details.');
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest();
  const received = Buffer.from(signature, 'hex');
  if (!crypto.timingSafeEqual(expected, received)) fail(400, 'Payment signature could not be verified.');
}

function createWishService({
  db = pool,
  gateway = razorpay,
  config = () => ({ key: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET }),
  notify = emitUser,
} = {}) {
  const transaction = async (fn) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const changed = (wish) => {
    const event = { wish_id: wish.id, title: wish.title, status: wish.status };
    notify(wish.requester_id, 'wish:status', event);
    if (wish.courier_id) notify(wish.courier_id, 'wish:status', event);
  };
  const expire = async () => {
    await db.query(`WITH expired AS (
      UPDATE wish_requests SET status='OPEN',courier_id=NULL,current_quote_id=NULL,claim_expires_at=NULL,updated_at=NOW()
      WHERE status IN ('CHECKING','QUOTED') AND claim_expires_at<=NOW() RETURNING id
    ) UPDATE wish_quotes SET status='EXPIRED' WHERE wish_id IN (SELECT id FROM expired) AND status='PENDING'`);
  };
  const locked = async (client, id) => {
    const { rows } = await client.query('SELECT * FROM wish_requests WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) fail(404, 'Request not found.');
    return rows[0];
  };
  const courierFree = async (client, userId) => {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    await requireEligibleCourier(userId, client);
    const busy = await client.query(
      `SELECT 1 FROM delivery_requests WHERE courier_id=$1 AND status NOT IN ('COMPLETED','DELIVERED','CANCELLED','FAILED')
      UNION ALL SELECT 1 FROM wish_requests WHERE courier_id=$1 AND status IN ('CHECKING','QUOTED','PAYMENT_PENDING') LIMIT 1`,
      [userId],
    );
    if (busy.rowCount) fail(409, 'Finish or release your current request before taking another.');
  };
  const requireGateway = () => {
    const settings = config();
    if (!settings.key?.startsWith('rzp_') || !settings.secret || settings.secret.includes('your_'))
      fail(503, 'Payments are not available yet. Your quote is saved; please try again later.');
    return settings;
  };
  const list = async (userId, board = false) => {
    await expire();
    const { rows } = await db.query(
      `SELECT w.*, r.name requester_name, c.name courier_name,
      l.building_name drop_building, l.floor_name drop_floor, l.room_name drop_room, l.route_node_id drop_route_node,
      q.amount_paise, q.pickup_place, q.note quote_note, q.created_at quoted_at,
      d.status delivery_status, p.status payment_status
      FROM wish_requests w JOIN users r ON r.id=w.requester_id LEFT JOIN users c ON c.id=w.courier_id
      JOIN campus_locations l ON l.id=w.drop_location_id LEFT JOIN wish_quotes q ON q.id=w.current_quote_id
      LEFT JOIN delivery_requests d ON d.id=w.delivery_id LEFT JOIN wish_payments p ON p.quote_id=w.current_quote_id
      WHERE ${board ? "(w.status='OPEN' AND w.requester_id<>$1) OR w.courier_id=$1" : 'w.requester_id=$1'}
      ORDER BY w.created_at DESC LIMIT 100`,
      [userId],
    );
    if (board) {
      const routes = await db.query(`SELECT o.route_node_id origin_node,d.route_node_id destination_node
        FROM courier_route_availability a JOIN campus_locations o ON o.id=a.origin_location_id JOIN campus_locations d ON d.id=a.destination_location_id
        WHERE a.courier_id=$1 AND a.is_active AND a.available_until>NOW() ORDER BY a.created_at DESC LIMIT 1`, [userId]);
      const declared = routes.rows[0] && routeFor(routes.rows[0].origin_node,routes.rows[0].destination_node);
      for (const wish of rows) {
        wish.campus_route_fit = Boolean(declared?.nodes.includes(wish.drop_route_node));
        wish.route_note = wish.campus_route_fit ? 'Campus drop-off fits your route. Check the outside-shop journey before taking it.' : 'Outside pickup is not mapped. Check the shop journey and campus drop-off before taking it.';
      }
      rows.sort((a,b)=>Number(b.courier_id===userId)-Number(a.courier_id===userId)||Number(b.campus_route_fit)-Number(a.campus_route_fit));
    }
    const availability = await db.query('SELECT wish_available FROM users WHERE id=$1', [userId]);
    return { requests: rows, available: Boolean(availability.rows[0]?.wish_available) };
  };
  const create = async (userId, body) => {
    const title = text(body.title, 120, true),
      details = text(body.details, 1500, true);
    const pickup = text(body.pickup_hint || '', 250),
      drop = text(body.drop_details || '', 250);
    const location = await db.query('SELECT id FROM campus_locations WHERE id=$1', [body.drop_location_id]);
    if (!location.rowCount) fail(400, 'Choose a campus drop-off location.');
    const { rows } = await db.query(
      `INSERT INTO wish_requests(requester_id,title,details,pickup_hint,drop_location_id,drop_details)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId, title, details, pickup, body.drop_location_id, drop],
    );
    const couriers = await db.query('SELECT id FROM users WHERE wish_available AND id<>$1', [userId]);
    for (const courier of couriers.rows) notify(courier.id, 'wish:new', { wish_id: rows[0].id, title });
    return rows[0];
  };
  const claim = async (userId, id) => {
    await expire();
    const result = await transaction(async (client) => {
      await courierFree(client, userId);
      const wish = await locked(client, id);
      if (wish.requester_id === userId) fail(403, 'You cannot deliver your own request.');
      if (wish.status !== 'OPEN') fail(409, 'Another student has already taken this request.');
      return (
        await client.query(
          "UPDATE wish_requests SET status='CHECKING',courier_id=$2,claim_expires_at=NOW()+INTERVAL '30 minutes',updated_at=NOW() WHERE id=$1 RETURNING *",
          [id, userId],
        )
      ).rows[0];
    });
    changed(result);
    return result;
  };
  const quote = async (userId, id, body) => {
    const amount = amountInPaise(body.amount),
      pickup = text(body.pickup_place, 250, true),
      note = text(body.note || '', 500);
    await expire();
    const result = await transaction(async (client) => {
      const wish = await locked(client, id);
      if (wish.courier_id !== userId) fail(403, 'Only the student checking this request can send a price.');
      if (wish.status !== 'CHECKING') fail(409, 'This request is no longer waiting for a price.');
      const q = await client.query(
        'INSERT INTO wish_quotes(wish_id,courier_id,amount_paise,pickup_place,note) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [id, userId, amount, pickup, note],
      );
      return (
        await client.query(
          "UPDATE wish_requests SET status='QUOTED',current_quote_id=$2,claim_expires_at=NOW()+INTERVAL '30 minutes',updated_at=NOW() WHERE id=$1 RETURNING *",
          [id, q.rows[0].id],
        )
      ).rows[0];
    });
    changed(result);
    return result;
  };
  const release = async (userId, id, action) => {
    const result = await transaction(async (client) => {
      const wish = await locked(client, id);
      const owner = wish.requester_id === userId,
        courier = wish.courier_id === userId;
      if (!owner && !courier) fail(403, 'This request belongs to another member.');
      if (!['OPEN', 'CHECKING', 'QUOTED'].includes(wish.status))
        fail(
          409,
          'Payment has started. Check its status or retry the saved payment before changing the deal.',
        );
      if (action === 'cancel' && !owner) fail(403, 'Only the requester can cancel.');
      if (action === 'decline' && (!owner || wish.status !== 'QUOTED'))
        fail(409, 'There is no price to decline.');
      if (action === 'withdraw' && !courier) fail(403, 'Only the assigned student can release the request.');
      if (wish.current_quote_id)
        await client.query('UPDATE wish_quotes SET status=$2 WHERE id=$1', [
          wish.current_quote_id,
          owner ? 'DECLINED' : 'WITHDRAWN',
        ]);
      const next = action === 'cancel' ? 'CANCELLED' : 'OPEN';
      const updated = (
        await client.query(
          'UPDATE wish_requests SET status=$2,courier_id=NULL,current_quote_id=NULL,claim_expires_at=NULL,updated_at=NOW() WHERE id=$1 RETURNING *',
          [id, next],
        )
      ).rows[0];
      return { ...updated, previousCourier: wish.courier_id };
    });
    changed(result);
    if (result.previousCourier)
      notify(result.previousCourier, 'wish:status', { wish_id: id, status: result.status });
    return result;
  };
  const createOrder = async (userId, id, quoteId) => {
    const settings = requireGateway();
    await expire();
    return transaction(async (client) => {
      const wish = await locked(client, id);
      if (wish.requester_id !== userId) fail(403, 'Only the requester can pay.');
      if (!['QUOTED', 'PAYMENT_PENDING'].includes(wish.status) || quoteId !== wish.current_quote_id)
        fail(409, 'The quote has changed or expired. Refresh and review it again.');
      await require('../payouts/payout-accounts').createAccountService({db,gateway}).assertRecipients([wish.courier_id],client);
      const quote = (await client.query('SELECT * FROM wish_quotes WHERE id=$1', [wish.current_quote_id]))
        .rows[0];
      let payment = (await client.query('SELECT * FROM wish_payments WHERE quote_id=$1', [quote.id])).rows[0];
      if (!payment) {
        const order = await gateway.orders.create({
          amount: quote.amount_paise,
          currency: 'INR',
          receipt: `wish_${quote.id.slice(0, 30)}`,
          notes: { wish_id: id, quote_id: quote.id },
        });
        payment = (
          await client.query(
            `INSERT INTO wish_payments(wish_id,quote_id,payer_id,amount_paise,gateway_order_id,gateway_mode) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
            [id, quote.id, userId, quote.amount_paise, order.id, require('../payouts/payout-config').modeFor(settings.key) || 'legacy'],
          )
        ).rows[0];
      }
      await client.query("UPDATE wish_quotes SET status='ACCEPTED' WHERE id=$1", [quote.id]);
      await client.query(
        "UPDATE wish_requests SET status='PAYMENT_PENDING',claim_expires_at=NULL,updated_at=NOW() WHERE id=$1",
        [id],
      );
      return {
        order_id: payment.gateway_order_id,
        amount: payment.amount_paise / 100,
        razorpay_key: settings.key,
        currency: 'INR',
        test_mode: settings.key.startsWith('rzp_test_'),
      };
    });
  };
  const confirmCaptured = async (userId, id, paid) => {
    const result = await transaction(async (client) => {
      const wish = await locked(client, id);
      if (wish.requester_id !== userId) fail(403, 'Only the requester can confirm payment.');
      const payment = (
        await client.query('SELECT * FROM wish_payments WHERE quote_id=$1 FOR UPDATE', [
          wish.current_quote_id,
        ])
      ).rows[0];
      if (
        !payment ||
        paid.order_id !== payment.gateway_order_id ||
        paid.amount !== payment.amount_paise ||
        paid.currency !== 'INR' ||
        paid.status !== 'captured'
      )
        fail(
          409,
          'Payment has not been captured for this agreed amount. Check payment status again shortly.',
        );
      if (payment.status === 'PAID') return wish;
      if (wish.status !== 'PAYMENT_PENDING') fail(409, 'This request is not awaiting payment.');
      const q = (await client.query('SELECT * FROM wish_quotes WHERE id=$1', [wish.current_quote_id]))
        .rows[0];
      const location = (
        await client.query('SELECT * FROM campus_locations WHERE id=$1', [wish.drop_location_id])
      ).rows[0];
      const label = [location.building_name, location.floor_name, location.room_name, wish.drop_details]
        .filter(Boolean)
        .join(' · ');
      const delivery = await client.query(
        `INSERT INTO delivery_requests(wish_request_id,customer_id,courier_id,pickup_location,drop_location,destination_location_id,item_description,task_type,order_type,status,agreed_amount,courier_earning,accepted_at,estimated_time,distance)
        VALUES($1,$2,$3,$4,$5,$6,$7,'WISH_DELIVERY','WISH','COURIER_ASSIGNED',$8,0,NOW(),'Not estimated',0) RETURNING id`,
        [
          id,
          userId,
          wish.courier_id,
          q.pickup_place,
          label,
          wish.drop_location_id,
          wish.title,
          payment.amount_paise / 100,
        ],
      );
      await client.query(
        "UPDATE wish_payments SET status='PAID',gateway_payment_id=$2,paid_at=NOW() WHERE id=$1",
        [payment.id, paid.id],
      );
      return (
        await client.query(
          "UPDATE wish_requests SET status='IN_DELIVERY',delivery_id=$2,updated_at=NOW() WHERE id=$1 RETURNING *",
          [id, delivery.rows[0].id],
        )
      ).rows[0];
    });
    changed(result);
    notify(result.courier_id, 'delivery:assigned', { delivery_id: result.delivery_id });
    return result;
  };
  const verifyPayment = async (userId, id, body) => {
    const { secret } = requireGateway();
    const { rows } = await db.query(
      'SELECT p.* FROM wish_payments p JOIN wish_requests w ON w.current_quote_id=p.quote_id WHERE w.id=$1 AND w.requester_id=$2',
      [id, userId],
    );
    const payment = rows[0];
    if (!payment) fail(404, 'Payment order not found.');
    if (body.gateway_order_id !== payment.gateway_order_id)
      fail(400, 'Payment order does not match this request.');
    verifySignature(payment.gateway_order_id, body.gateway_payment_id, body.gateway_signature, secret);
    const paid = await gateway.payments.fetch(body.gateway_payment_id);
    return confirmCaptured(userId, id, paid);
  };
  const reconcile = async (userId, id) => {
    requireGateway();
    const { rows } = await db.query(
      'SELECT p.* FROM wish_payments p JOIN wish_requests w ON w.current_quote_id=p.quote_id WHERE w.id=$1 AND w.requester_id=$2',
      [id, userId],
    );
    if (!rows[0]) fail(404, 'No payment has started for this request.');
    const payments = await gateway.orders.fetchPayments(rows[0].gateway_order_id);
    const paid = payments.items?.find((item) => item.status === 'captured');
    if (!paid) fail(409, 'No completed payment found yet. You can safely retry the saved payment.');
    return confirmCaptured(userId, id, paid);
  };
  const availability = async (userId, available) => {
    if (typeof available !== 'boolean') fail(400, 'Availability must be true or false.');
    await db.query('UPDATE users SET wish_available=$2 WHERE id=$1', [userId, available]);
    return { available };
  };
  return { list, create, claim, quote, release, createOrder, verifyPayment, reconcile, availability, expire };
}
module.exports = { createWishService, amountInPaise, verifySignature };
