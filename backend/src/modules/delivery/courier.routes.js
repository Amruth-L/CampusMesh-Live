const router = require('express').Router();
const auth = require('../../middleware/authMiddleware');
const controller = require('./courier.controller');
router.use(auth);
router.post('/availability', controller.upsertRoute);
router.post('/routes', controller.upsertRoute);
router.put('/routes/current', controller.upsertRoute);
router.get('/routes/current', controller.currentRoute);
router.delete('/routes/current', controller.deactivateRoute);
router.get('/offers', controller.getOffers);
router.post('/offers/:id/decline', controller.declineOffer);
module.exports = router;

