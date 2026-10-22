const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middleware/authMiddleware');
const deliveryController = require('./delivery.controller');
const handoverController = require('./handover.controller');
const courierController = require('./courier.controller');

// All delivery routes require authentication
router.use(authMiddleware);

// Dashboard & listing endpoints
router.get('/stats', deliveryController.getDeliveryStats);
router.get('/available', deliveryController.getAvailableDeliveries);
router.get('/my-deliveries', deliveryController.getMyDeliveries);
router.get('/earnings', deliveryController.getEarnings);
router.get('/offers', courierController.getOffers);

// Rental-specific delivery status (for customer/seller views)
// Must be before /:id to avoid 'rental' matching as UUID
router.get('/rental/:rentalId', deliveryController.getRentalDeliveryStatus);
router.get('/:id/tracking', deliveryController.getTracking);
router.get('/:id/route', deliveryController.getDeliveryRoute);
router.get('/:id/handover/:stage', handoverController.getHandover);
router.get('/:id/condition-photos', handoverController.listPhotos);
router.post('/:id/condition-photos', handoverController.uploadPhoto);

// Single delivery detail
router.get('/:id', deliveryController.getDeliveryById);

// Courier actions
router.post('/:id/accept', deliveryController.acceptDelivery);
router.post('/:id/decline', courierController.declineOffer);
router.post('/:id/status', deliveryController.updateStatus);
router.post('/:id/location', deliveryController.updateLocation);
router.post('/:id/verify-handover', handoverController.verifyHandover);

module.exports = router;

