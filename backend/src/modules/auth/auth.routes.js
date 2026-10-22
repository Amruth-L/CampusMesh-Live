const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const profileController = require('../profile/profile.controller');
const authMiddleware = require('../../middleware/authMiddleware');

router.post('/signup', authController.signup);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-otp', authController.resendOtp);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/login', authController.login);
router.get('/me', authMiddleware, profileController.getProfile);
router.put('/mode', authMiddleware, authController.setMode);
router.put('/delivery-availability', authMiddleware, authController.setDeliveryAvailability);
router.post('/logout', authController.logout);

module.exports = router;
