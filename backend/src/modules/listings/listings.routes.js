const express = require('express');
const router = express.Router();
const listingController = require('./listings.controller');
const authMiddleware = require('../../middleware/authMiddleware');

router.param('id', (req,res,next,id) => require('../../shared/validation').isUuid(id) ? next() : res.status(400).json({ error: 'Invalid listing ID.' }));

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

