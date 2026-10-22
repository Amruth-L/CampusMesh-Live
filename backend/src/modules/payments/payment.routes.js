const express = require('express');
const router = express.Router();
const paymentController = require('./payment.controller');
const authMiddleware = require('../../middleware/authMiddleware');
const verifyPaymentSignature = require('../../middleware/verify-payment');

// All payment routes require JWT authentication
router.use(authMiddleware);

// Stage 1: Booking/Rental Order Creation & Verification
router.post('/create-rental-order', paymentController.createRentalOrder);
router.post('/verify-rental', verifyPaymentSignature, paymentController.verifyRental);
router.post('/reconcile-rental', paymentController.reconcileRental);
router.post('/create-xerox-order', (req, res) => res.status(503).json({ error: 'Campus Print is coming soon.' }));
router.post('/verify-xerox', verifyPaymentSignature, paymentController.verifyXerox);

// Stage 2: Refundable Security Deposit Creation & Verification
router.post('/create-deposit-order', paymentController.createDepositOrder);
router.post('/verify-deposit', verifyPaymentSignature, paymentController.verifyDeposit);

// Stage 3: Cart Checkout Creation & Verification
router.post('/reconcile-checkout', paymentController.reconcileCheckout);
router.post('/create-checkout-order', paymentController.createCheckoutOrder);
router.post('/verify-checkout', verifyPaymentSignature, paymentController.verifyCheckout);

// Admin/Owner: Refund Security Deposit
router.post('/refund-deposit', paymentController.refundDeposit);
router.post('/reconcile-refund', paymentController.reconcileRefund);

// Payment History
router.get('/history', paymentController.getPaymentHistory);

module.exports = router;

