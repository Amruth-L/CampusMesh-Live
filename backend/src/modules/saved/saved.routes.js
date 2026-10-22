const express = require('express');
const router = express.Router();
const wishlistController = require('./saved.controller');
const authMiddleware = require('../../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/', wishlistController.getWishlist);
router.post('/toggle', wishlistController.toggleWishlist);
router.delete('/:itemId', wishlistController.removeFromWishlist);

module.exports = router;

