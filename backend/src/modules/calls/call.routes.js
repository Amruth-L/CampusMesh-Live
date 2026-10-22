const express = require('express');
const twilio = require('twilio');
const router = express.Router();
const pool = require('../../config/database');
const auth = require('../../middleware/authMiddleware');
const { createCallService, config, ready } = require('./call.service');
const { requestTick } = require('./call.worker');
const { saySoft } = require('./voice');
const { authenticateWebhook } = require('./webhook-auth');
const service = createCallService();
router.use('/webhooks', (req, res, next) => {
  const started = Date.now();
  res.on('finish', () =>
    console.info('[calls] webhook', {
      method: req.method,
      kind: req.path.split('/').pop(),
      status: res.statusCode,
      durationMs: Date.now() - started,
      signaturePresent: Boolean(req.get('X-Twilio-Signature')),
      callSidPresent: Boolean(req.body?.CallSid),
    }),
  );
  next();
});
router.use('/webhooks', express.urlencoded({ extended: false, limit: '20kb' }));
// A signed provider-only probe allows testing Voice without fabricating a booking.
router.post('/webhooks/probe', (req, res) => {
  const c = config();
  if ((c.provider || 'twilio') !== 'twilio' || !ready(c) || !authenticateWebhook(c, req))
    return res.status(403).json({ error: 'Invalid provider signature.' });
  const response = new twilio.twiml.VoiceResponse();
  saySoft(
    response,
    'Hello! Welcome to CampusMesh. We are happy to have you here. Your booking confirmations and return reminders will use this voice. Thank you for using CampusMesh. Goodbye!',
    c,
  );
  response.hangup();
  res.type('text/xml').send(response.toString());
});
router.post('/webhooks/:id/:kind', async (req, res) => {
  // Accepted Twilio calls may finish after switching the outbound provider or
  // pausing calls. Authenticate their callbacks and check the stored provider.
  const c = { ...config(), provider: 'twilio', live: true };
  const authentication = ready(c) && authenticateWebhook(c, req);
  if (!authentication) return res.status(403).json({ error: 'Invalid provider signature.' });
  if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).end();
  // Trial fetches may omit call parameters too. The URL is bound to this job;
  // use only its already accepted provider SID, never a caller-supplied fallback.
  if (authentication === 'trial-url' && !req.body?.CallSid) {
    const job = (await pool.query("SELECT provider_sid FROM automated_calls WHERE id=$1 AND provider='twilio'", [req.params.id]))
      .rows[0];
    req.body = { ...req.body, CallSid: job?.provider_sid };
  }
  if (!/^CA[\da-f]{32}$/i.test(req.body?.CallSid || '')) return res.status(400).end();
  if (req.params.kind === 'status') {
    const mapped = {
      initiated: 'SENT',
      queued: 'SENT',
      ringing: 'RINGING',
      'in-progress': 'ANSWERED',
      completed: 'COMPLETED',
      busy: 'FAILED',
      'no-answer': 'FAILED',
      failed: 'FAILED',
      canceled: 'CANCELLED',
    }[req.body.CallStatus];
    const seq = Number(req.body.SequenceNumber);
    if (mapped && Number.isInteger(seq))
      await pool.query(
        `UPDATE automated_calls SET status=$2,provider_sid=COALESCE(provider_sid,$3),provider_sequence=$4,finished_at=CASE WHEN $2 IN ('COMPLETED','FAILED','CANCELLED') THEN NOW() ELSE finished_at END WHERE id=$1 AND provider='twilio' AND (provider_sid IS NULL OR provider_sid=$3) AND provider_sequence<$4 AND status IN ('DISPATCHING','SENT','RINGING','ANSWERED','UNKNOWN')`,
        [req.params.id, mapped, req.body.CallSid, seq],
      );
    return res.status(204).end();
  }
  if (!['voice', 'answer'].includes(req.params.kind)) return res.status(404).end();
  res.type('text/xml').send(await service.voice(req.params.id, req.body, req.params.kind));
});
router.use(auth);
router.get('/', async (req, res) => {
  const preferences = await service.preferences(req.user.id);
  const { rows } = await pool.query(
    'SELECT id,kind,status,provider,script,outcome,last_error,created_at,started_at FROM automated_calls WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',
    [req.user.id],
  );
  res.json({
    preferences,
    status: service.status(),
    accountReadiness: service.accountStatus(preferences),
    calls: rows,
  });
});
router.get('/rentals/:id/status', async (req, res) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id))
    return res.status(400).json({ error: 'Invalid rental ID.' });
  res.json(await service.bookingStatus(req.user.id, req.params.id));
});
router.put('/preferences', async (req, res) =>
  res.json(await service.updatePreferences(req.user.id, req.body)),
);
router.post('/verify-phone', async (req, res) => {
  const result = await service.verifyPhone(req.user.id, req.body.code);
  res.json(result);
  if (result.verified) requestTick();
});
router.get('/preview', async (req, res) => res.json(await service.preview(req.user.id)));
module.exports = router;
