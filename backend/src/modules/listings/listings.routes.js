const express = require('express');
const router = express.Router();
const listingController = require('./listings.controller');
const authMiddleware = require('../../middleware/authMiddleware');

// Public routes
router.get('/', listingController.getListings);
router.get('/recommendations', authMiddleware, listingController.getRecommendations);
router.get('/mine', authMiddleware, listingController.getMyListings);
router.get('/:id/availability', authMiddleware, listingController.getAvailability);
router.post('/:id/view', authMiddleware, listingController.recordView);
router.get('/:id', listingController.getListingById);

// Protected routes (require JWT)
router.post('/', authMiddleware, listingController.createListing);
router.put('/:id', authMiddleware, listingController.updateListing);
router.delete('/:id', authMiddleware, listingController.deleteListing);

module.exports = router;

