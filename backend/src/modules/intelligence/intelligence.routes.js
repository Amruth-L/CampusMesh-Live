const router = require('express').Router();
const auth = require('../../middleware/authMiddleware');
const pool = require('../../config/database');
const service = require('./intelligence.service');
router.use(auth);
router.get('/overview', async (req, res) => {
  const [market, recommendations, trust, model] = await Promise.all([
    service.market(),
    service.recommendations(req.user.id),
    service.trust(req.user.id),
    service.etaModel(),
  ]);
  res.json({
    market,
    recommendations,
    trust,
    eta: {
      method: model.method,
      sampleCount: model.sampleCount,
      validationMae: model.mae,
      minimumSamples: 20,
    },
  });
});
router.get('/recommendations', async (req, res) => res.json(await service.recommendations(req.user.id)));
router.get('/rentals/:id/trust', async (req, res) => {
  if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid rental.' });
  const { rows } = await pool.query(
    'SELECT borrower_id FROM rentals WHERE id=$1 AND $2 IN (owner_id,borrower_id)',
    [req.params.id, req.user.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Rental not found.' });
  res.json(await service.trust(rows[0].borrower_id));
});
module.exports = router;
