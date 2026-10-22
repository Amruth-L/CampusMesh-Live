const router = require('express').Router();
const { enabled, createService } = require('./service');
const service = createService();
router.get('/config', (_req, res) => res.json({ enabled: enabled() }));
router.use(require('../../middleware/authMiddleware'), (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res
      .status(e.status || 503)
      .json({ error: e.status ? e.message : 'Direct payment service is unavailable. Retry shortly.' });
  }
};
router.get(
  '/profile',
  handle((req) => service.profile(req.user.id)),
);
router.put(
  '/profile',
  handle((req) => service.profile(req.user.id, req.body)),
);
router.get(
  '/payments',
  handle((req) => service.list(req.user.id, req.query.rental_id || null)),
);
router.post(
  '/rentals/:id/prepare',
  handle((req) => service.prepare(req.params.id, req.user.id)),
);
router.post(
  '/payments/:id/:action',
  handle((req) => service.act(req.params.id, req.user.id, req.params.action, req.body)),
);
module.exports = router;
