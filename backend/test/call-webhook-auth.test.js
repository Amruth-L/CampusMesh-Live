const test = require('node:test');
const assert = require('node:assert/strict');
const { URL } = require('node:url');
const twilio = require('twilio');
const { webhookUrl, authenticateWebhook } = require('../src/modules/calls/webhook-auth');
const c = { trial: true, token: 'test-only-secret', base: 'https://example.invalid' };
const now = 1792080000000;
const id = '11111111-1111-4111-8111-111111111111';
function request(url, signature) {
  const u = new URL(url);
  return { originalUrl: u.pathname + u.search, query: Object.fromEntries(u.searchParams),
    body: { CallSid: 'CA' + '1'.repeat(32) }, get: () => signature };
}

test('trial URL authenticates only its own speech job before expiry', () => {
  const url = webhookUrl(c, id, 'voice', now);
  assert.equal(authenticateWebhook(c, request(url), now), 'trial-url');
  assert.equal(authenticateWebhook(c, request(url), now + 900000), null);
  assert.equal(authenticateWebhook(c, request(url.replace('/voice?', '/answer?')), now), null);
  assert.equal(authenticateWebhook(c, request(url.replace(id, '22222222-2222-4222-8222-222222222222')), now), null);
  assert.equal(authenticateWebhook(c, request(url.replace('/voice?', '/status?')), now), null);
  assert.equal(authenticateWebhook(c, request(url.replace('expires=', 'expires=9')), now), null);
  assert.equal(authenticateWebhook({ ...c, trial: false }, request(url), now), null);
  assert.equal(authenticateWebhook(c, request(url, 'invalid-header'), now), null);
});

test('normal provider signatures remain required for status callbacks', () => {
  const url = webhookUrl(c, id, 'status', now);
  assert.equal(url.includes('?'), false);
  const req = request(url);
  assert.equal(authenticateWebhook(c, req, now), null);
  req.get = () => twilio.getExpectedTwilioSignature(c.token, url, req.body);
  assert.equal(authenticateWebhook(c, req, now), 'twilio');
  req.body.CallStatus = 'completed';
  // An invalid signature must not fall back to a trial URL token.
  req.get = () => 'invalid';
  assert.equal(authenticateWebhook(c, req, now), null);
});

test('probe URLs are scoped and cannot authorize a rental call', () => {
  const url = webhookUrl(c, 'probe', 'voice', now);
  assert.equal(authenticateWebhook(c, request(url), now), 'trial-url');
  assert.equal(authenticateWebhook(c, request(url.replace('/probe?', `/${id}/voice?`)), now), null);
  assert.equal(authenticateWebhook(c, request(c.base + '/api/calls/webhooks/probe'), now), null);
});
