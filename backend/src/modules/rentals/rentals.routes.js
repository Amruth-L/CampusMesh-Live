const express = require('express');
const router = express.Router();
const rentalController = require('./rentals.controller');
const authMiddleware = require('../../middleware/authMiddleware');

// All rental routes require authentication
router.use(authMiddleware);

router.post('/book', rentalController.bookRental);
router.post('/respond', rentalController.respondToBooking);
router.get('/my-rentals', rentalController.getMyRentals);
router.get('/my-listings-requests', rentalController.getOwnerRequests);
router.get('/:id/status', rentalController.getRentalStatus);
router.post('/:id/return-request', rentalController.requestReturn);
router.put('/:id/return-destination', rentalController.confirmReturnDestination);
router.post('/:id/extend-request', rentalController.requestExtension);
router.post('/:id/extend-respond', rentalController.respondExtension);
router.post('/:id/send-reminder', rentalController.sendReminder);
router.get('/:id/history', rentalController.getHistory);
router.post('/:id/complete', rentalController.confirmReturn);

module.exports = router;

