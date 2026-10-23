const express = require('express');
const auth = require('../../middleware/authMiddleware');
const { voiceService } = require('./voice.service');

function createVoiceRouter({ authenticate = auth, db, service } = {}) {
  db ||= require('../../config/database');
  service ||= voiceService;
  const router = express.Router();
  router.use(authenticate);
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { rows } = await db.query('SELECT email_verified FROM users WHERE id=$1', [req.user.id]);
      if (!rows[0]?.email_verified)
        return res
          .status(403)
          .json({ error: 'Sign in with a verified CampusMesh account to use voice assistance.' });
      next();
    } catch {
      res.status(503).json({ error: 'We could not check your account. Please retry.' });
    }
  });
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      res.status(error.status || 503).json({
        error: error.status
          ? error.message
          : 'Your question could not be answered. Please retry or use Support.',
      });
    }
  };
  router.get(
    '/capabilities',
    handle((req, res) => res.json(service.capabilities())),
  );
  router.post(
    '/sessions',
    handle((req, res) => res.status(201).json(service.start(req.user.id))),
  );
  router.delete(
    '/sessions/:id',
    handle((req, res) => {
      service.end(req.user.id, req.params.id);
      res.sendStatus(204);
    }),
  );
  return router;
}
module.exports = { createVoiceRouter };
