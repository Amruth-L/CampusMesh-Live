const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('../src/modules/auth/onboarding.service');
const { createCallService, scriptFor } = require('../src/modules/calls/call.service');

test('signup phone normalization accepts Indian numbers and explicit country codes', () => {
  assert.equal(normalizePhone('98765 43210'), '+919876543210');
  assert.equal(normalizePhone(' +1 (500) 555-0009 '), '+15005550009');
  for (const value of [undefined, null, 12345, '', '123', 'call me', '+0123456789'])
    assert.equal(normalizePhone(value), null);
});

test('welcome speech is generic and preview mode never queues or dispatches a call', async () => {
  const service = createCallService({
    settings: () => ({ live: false, enabled: true }),
    db: { query: () => assert.fail('Preview touched the call queue') },
    providerFactory: () => assert.fail('Preview reached a calling provider'),
  });
  assert.match(scriptFor('WELCOME'), /Welcome to CampusMesh/);
  assert.match(scriptFor('WELCOME'), /happy to have you here/);
  assert.deepEqual(await service.enqueue(), { queued: 0, mode: 'preview' });
  assert.deepEqual(await service.dispatchOne(), { skipped: true });
});
