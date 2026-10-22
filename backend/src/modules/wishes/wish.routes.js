const router = require('express').Router();
const auth = require('../../middleware/authMiddleware');
const { createWishService } = require('./wish.service');
const service = createWishService();
router.use(auth);
router.get('/', async (req, res) => res.json(await service.list(req.user.id, req.query.view === 'board')));
router.post('/', async (req, res) => res.status(201).json(await service.create(req.user.id, req.body)));
router.put('/availability', async (req, res) =>
  res.json(await service.availability(req.user.id, req.body.available)),
);
router.param('id', (req, res, next, id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? next()
    : res.status(400).json({ error: 'Invalid request ID.' }),
);
router.post('/:id/claim', async (req, res) => res.json(await service.claim(req.user.id, req.params.id)));
router.post('/:id/quote', async (req, res) =>
  res.json(await service.quote(req.user.id, req.params.id, req.body)),
);
for (const action of ['cancel', 'decline', 'withdraw'])
  router.post(`/:id/${action}`, async (req, res) =>
    res.json(await service.release(req.user.id, req.params.id, action)),
  );
router.post('/:id/order', async (req, res) =>
  res.json(await service.createOrder(req.user.id, req.params.id, req.body.quote_id)),
);
router.post('/:id/verify-payment', async (req, res) =>
  res.json(await service.verifyPayment(req.user.id, req.params.id, req.body)),
);
router.post('/:id/check-payment', async (req, res) =>
  res.json(await service.reconcile(req.user.id, req.params.id)),
);
module.exports = router;
