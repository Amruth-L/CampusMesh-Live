const express = require('express');
const router = express.Router();
const cartController = require('./cart.controller');
const authMiddleware = require('../../middleware/authMiddleware');

// All cart routes require JWT authentication
router.use(authMiddleware);

router.get('/', cartController.getCart);
router.post('/add', cartController.addToCart);
router.put('/:id', cartController.updateCartDates);
router.delete('/:id', cartController.removeFromCart);

module.exports = router;

