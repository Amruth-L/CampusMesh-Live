const crypto = require('crypto');
const razorpay = require('../config/razorpay');
require('dotenv').config();

function createPaymentVerifier({ gateway = razorpay, secret = () => process.env.RAZORPAY_KEY_SECRET } = {}) {
  return async (req, res, next) => {
    const {
      gateway_order_id: orderId,
      gateway_payment_id: paymentId,
      gateway_signature: signature,
    } = req.body;
    const key = secret();
    if (!key || /^(your_|testsecret$)/.test(key))
      return res.status(503).json({ error: 'Payment verification is not configured.' });
    if (
      typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string' ||
      !/^order_[A-Za-z0-9]+$/.test(orderId || '') ||
      !/^pay_[A-Za-z0-9]+$/.test(paymentId || '') ||
      !/^[a-f0-9]{64}$/i.test(signature || '')
    )
      return res.status(400).json({ error: 'Valid payment verification details are required.' });
    const expected = crypto.createHmac('sha256', key).update(`${orderId}|${paymentId}`).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      return res.status(400).json({ error: 'Invalid payment signature.' });
    try {
      const [payment, order] = await Promise.all([
        gateway.payments.fetch(paymentId),
        gateway.orders.fetch(orderId),
      ]);
      if (
        payment.order_id !== orderId ||
        payment.status !== 'captured' ||
        payment.captured !== true ||
        payment.currency !== 'INR' ||
        order.currency !== 'INR' ||
        Number(payment.amount) !== Number(order.amount)
      )
        return res.status(409).json({ error: 'Payment has not been fully captured for this order.' });
      req.paymentVerified = true;
      return next();
    } catch {
      return res
        .status(503)
        .json({ error: 'Could not confirm payment with the provider. Please retry verification.' });
    }
  };
}
module.exports = createPaymentVerifier();
module.exports.createPaymentVerifier = createPaymentVerifier;
