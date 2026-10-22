const paymentService = require('./payment.service');
const { requestTick } = require('../calls/call.worker');
const pool = require('../../config/database');
const razorpay = require('../../config/razorpay');
const crypto = require('crypto');

const isSimulationMode = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  return !key_id || !key_secret || String(key_id).includes('your_') || String(key_secret).includes('your_');
};

exports.createRentalOrder = async (req, res) => {
  const { rental_id, booking_id } = req.body;
  const targetId = booking_id || rental_id; // Support both naming variants for robust compatibility
  const userId = req.user.id;

  if (!targetId) {
    return res.status(400).json({ error: 'booking_id is required.' });
  }

  try {
    const orderData = await paymentService.createRentalOrder(targetId, userId);
    res.status(orderData.already_paid ? 200 : 201).json(orderData);
  } catch (error) {
    console.error('[PaymentController] createRentalOrder error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create rental payment order.' });
  }
};

exports.verifyRental = async (req, res) => {
  const { rental_id, booking_id, gateway_order_id, gateway_payment_id, gateway_signature } = req.body;
  const targetId = booking_id || rental_id;
  const userId = req.user.id;

  if (!targetId || !gateway_order_id || !gateway_payment_id) {
    return res.status(400).json({ error: 'booking_id, gateway_order_id, and gateway_payment_id are required.' });
  }

  try {
    const verificationResult = await paymentService.verifyRentalPayment(
      targetId,
      gateway_order_id,
      gateway_payment_id,
      gateway_signature,
      userId
    );
    res.status(200).json(verificationResult);
  } catch (error) {
    console.error('[PaymentController] verifyRental error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to verify rental payment.' });
  }
};

exports.reconcileRental = async (req, res) => {
  const targetId = req.body.booking_id || req.body.rental_id;
  if (!targetId) return res.status(400).json({ error: 'booking_id is required.' });
  try {
    // The service accepts no browser-supplied order/payment IDs. It recovers only
    // captured provider payments linked to this authenticated borrower's rental.
    const result = await paymentService.reconcileRentalPayment(targetId, req.user.id);
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Could not confirm rental payment. Please retry.' });
  }
};

exports.createDepositOrder = async (req, res) => {
  const { rental_id, booking_id } = req.body;
  const targetId = booking_id || rental_id;
  const userId = req.user.id;

  if (!targetId) {
    return res.status(400).json({ error: 'booking_id is required.' });
  }

  try {
    const orderData = await paymentService.createDepositOrder(targetId, userId);
    res.status(201).json(orderData);
  } catch (error) {
    console.error('[PaymentController] createDepositOrder error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create deposit payment order.' });
  }
};

exports.verifyDeposit = async (req, res) => {
  const { rental_id, booking_id, gateway_order_id, gateway_payment_id, gateway_signature } = req.body;
  const targetId = booking_id || rental_id;
  const userId = req.user.id;

  if (!targetId || !gateway_order_id || !gateway_payment_id) {
    return res.status(400).json({ error: 'booking_id, gateway_order_id, and gateway_payment_id are required.' });
  }

  try {
    const verificationResult = await paymentService.verifyDepositPayment(
      targetId,
      gateway_order_id,
      gateway_payment_id,
      gateway_signature,
      userId
    );
    res.status(200).json(verificationResult);
    // Payment is committed before waking the queue. The worker independently
    // checks full payment, consent, phone ownership and provider readiness.
    // A calling problem must never turn a successful payment into an HTTP error.
    try { requestTick(); }
    catch { console.error('[PaymentController] Call worker wake deferred to scheduler.'); }
  } catch (error) {
    console.error('[PaymentController] verifyDeposit error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to verify deposit payment.' });
  }
};

exports.refundDeposit = async (req, res) => {
  const { rental_id, booking_id, damage_amount, damage_description } = req.body;
  const targetId = booking_id || rental_id;
  const adminId = req.user?.id;

  if (!targetId) {
    return res.status(400).json({ error: 'booking_id is required.' });
  }

  try {
    const result = await paymentService.refundDeposit(
      targetId,
      damage_amount,
      damage_description,
      adminId
    );
    res.status(200).json(result);
  } catch (error) {
    console.error('[PaymentController] refundDeposit error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to process refund.' });
  }
};

exports.getPaymentHistory = async (req, res) => {
  const userId = req.user.id;

  try {
    const history = await paymentService.getPaymentHistory(userId);
    res.status(200).json(history);
  } catch (error) {
    console.error('[PaymentController] getPaymentHistory error:', error.message);
    res.status(500).json({ error: 'Failed to fetch payment history.' });
  }
};

const checkoutService = require('./checkout.service');
exports.createCheckoutOrder = async (req, res) => {
  try { return res.json(await checkoutService.create(req.user.id, req.body.selected_item_ids)); }
  catch (error) { return res.status(error.status || 500).json({ error: error.message || 'Could not prepare checkout.' }); }
};
exports.reconcileCheckout = async (req, res) => {
  try { return res.json(await checkoutService.reconcile(req.body.gateway_order_id, req.user.id)); }
  catch (error) { return res.status(error.status || 500).json({ error: error.message || 'Could not confirm checkout.' }); }
};
exports.verifyCheckout = async (req, res) => {
  try {
    const result = await checkoutService.reconcile(req.body.gateway_order_id, req.user.id, req.body.gateway_payment_id);
    return res.status(result.paid ? 200 : 409).json(result.paid ? result : { error: 'Payment is still processing. Do not pay again.' });
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || 'Could not confirm checkout.' }); }
};

exports.createXeroxOrder = async (req, res) => {
  const body = req.body || {};
  const pages = Number(body.page_count);
  const copyCount = Number(body.copies);
  const dropLocationId = String(body.drop_location_id || "");
  const documentHash = String(body.document_hash || "");
  const filename = String(body.filename || "document.pdf").slice(0, 180);
  if (!Number.isInteger(pages) || pages < 1 || pages > 10000 || !Number.isInteger(copyCount) || copyCount < 1 || copyCount > 20 || !dropLocationId || !documentHash) {
    return res.status(400).json({ error: "Valid page count, copies, drop location, and document hash are required." });
  }
  const location = await pool.query("SELECT id FROM campus_locations WHERE id = $1", [dropLocationId]);
  if (!location.rowCount) return res.status(400).json({ error: "Choose a valid campus delivery location." });
  const amount = pages * copyCount * 3;
  let orderId;
  let simulated = false;
  try {
    if (isSimulationMode()) {
      orderId = "sim_order_" + crypto.randomBytes(8).toString("hex");
      simulated = true;
    } else {
      const order = await razorpay.orders.create({
        amount: Math.round(amount * 100),
        currency: "INR",
        receipt: "xerox_" + crypto.randomBytes(4).toString("hex"),
        notes: { user_id: req.user.id, payment_type: "XEROX" },
      });
      orderId = order.id;
    }
    const bookingData = { type: "XEROX", page_count: pages, copies: copyCount, drop_location_id: dropLocationId, document_hash: documentHash, filename, total_amount: amount, verified: false };
    await pool.query("INSERT INTO pending_orders (id, user_id, booking_data) VALUES ($1, $2, $3)", [orderId, req.user.id, JSON.stringify(bookingData)]);
    return res.status(201).json({ order_id: orderId, amount, currency: "INR", razorpay_key: process.env.RAZORPAY_KEY_ID || "SIMULATION_MODE", simulated });
  } catch (error) {
    console.error("[PaymentController] createXeroxOrder error:", error.message);
    return res.status(500).json({ error: "Could not initialize Xerox payment." });
  }
};

exports.verifyXerox = async (req, res) => {
  const { gateway_order_id, gateway_payment_id } = req.body || {};
  if (!gateway_order_id || !gateway_payment_id) return res.status(400).json({ error: "gateway_order_id and gateway_payment_id are required." });
  try {
    const pendingRes = await pool.query("SELECT * FROM pending_orders WHERE id = $1 AND user_id = $2", [gateway_order_id, req.user.id]);
    const pending = pendingRes.rows[0];
    if (!pending || pending.booking_data?.type !== "XEROX") return res.status(404).json({ error: "Xerox payment order not found." });
    if (pending.booking_data.verified) return res.json({ success: true, order_id: gateway_order_id });
    await pool.query("UPDATE pending_orders SET booking_data = booking_data || $1::jsonb WHERE id = $2 AND user_id = $3", [JSON.stringify({ verified: true, payment_id: gateway_payment_id }), gateway_order_id, req.user.id]);
    return res.json({ success: true, order_id: gateway_order_id });
  } catch (error) {
    console.error("[PaymentController] verifyXerox error:", error.message);
    return res.status(500).json({ error: "Could not verify Xerox payment." });
  }
};

exports.reconcileRefund = async (req, res) => {
  if (!req.body.rental_id) return res.status(400).json({ error: 'rental_id is required.' });
  try { res.json(await require('./refund.service').createRefundService().refresh(req.body.rental_id, req.user.id)); }
  catch (error) { res.status(error.status || 500).json({ error: error.message || 'Could not refresh refund.' }); }
};
