const express = require('express');
const crypto = require('crypto');
const { tick } = require('./call.worker');
function schedulerRouter({ run = tick, secret = () => process.env.CALLS_SCHEDULER_SECRET } = {}) {
  const router = express.Router();
  router.post('/tick', async (req, res) => {
    const expected = secret();
    const provided = req.get('Authorization') || '';
    if (!expected || expected.length < 32)
      return res.status(503).json({ error: 'Scheduler not configured.' });
    const hash = (value) => crypto.createHash('sha256').update(value).digest();
    if (!crypto.timingSafeEqual(hash(provided), hash('Bearer ' + expected)))
      return res.status(401).json({ error: 'Unauthorized scheduler.' });
    res.set('Cache-Control', 'no-store');
    const result = await run();
    res.json({ ok: true, ...result });
  });
  return router;
}
module.exports = { schedulerRouter };
