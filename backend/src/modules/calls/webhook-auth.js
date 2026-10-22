const { createHmac, timingSafeEqual } = require('node:crypto');
const twilio = require('twilio');
const TTL = 15 * 60;
const digest = (c, path, expires) => createHmac('sha256', c.token)
  .update(`campusmesh-trial-voice\n${path}\n${expires}`).digest('hex');

function webhookUrl(c, id, kind, now = Date.now()) {
  const path = id === 'probe' ? '/api/calls/webhooks/probe' : `/api/calls/webhooks/${id}/${kind}`;
  const url = c.base + path;
  if (!c.trial || kind === 'status') return url;
  const expires = Math.floor(now / 1000) + TTL;
  return `${url}?expires=${expires}&signature=${digest(c, path, expires)}`;
}

function authenticateWebhook(c, req, now = Date.now()) {
  const signature = req.get('X-Twilio-Signature');
  if (signature) return twilio.validateRequest(c.token, signature, c.base + req.originalUrl, req.body)
    ? 'twilio' : null;
  // The trial custom-TwiML fetcher omits Twilio's signature. Authenticate only
  // speech fetches with a narrowly scoped, expiring bearer URL. Status updates
  // still require the normal provider signature and matching CallSid.
  if (!c.trial || !c.token) return null;
  const path = req.originalUrl.split('?')[0];
  if (!/^\/api\/calls\/webhooks\/(?:probe|[a-f0-9-]{36}\/(?:voice|answer))$/i.test(path)) return null;
  const { expires, signature: token } = req.query;
  if (typeof expires !== 'string' || !/^\d{10}$/.test(expires) ||
      typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (remaining <= 0 || remaining > TTL) return null;
  return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(digest(c, path, expires), 'hex'))
    ? 'trial-url' : null;
}
module.exports = { webhookUrl, authenticateWebhook };
