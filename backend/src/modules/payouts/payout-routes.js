const express = require('express');
const auth = require('../../middleware/authMiddleware');
const service = require('./payout-service').createPayoutService();
const router = express.Router();
router.use(auth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
const handle = (action) => async (req, res) => {
  try {
    res.json(await action(req));
  } catch (error) {
    res
      .status(error.status || 503)
      .json({
        error: error.status ? error.message : 'Payout service is temporarily unavailable. Please retry.',
      });
  }
};
router.get(
  '/',
  handle((req) => service.summary(req.user.id)),
);
router.post(
  '/setup',
  handle((req) => service.accounts.request(req.user.id)),
);
router.post(
  '/account/onboard',
  handle((req) => service.accounts.onboard(req.user.id, req.body)),
);
router.post(
  '/account/refresh',
  handle((req) => service.accounts.refresh(req.user.id)),
);
router.put(
  '/account/bank',
  handle((req) => service.accounts.updateBank(req.user.id, req.body)),
);
router.post(
  '/:id/refresh',
  handle((req) => service.reconcile(req.params.id, req.user.id)),
);
module.exports = router;
