const test = require('node:test');
const assert = require('node:assert/strict');
const { createCallService, ready, providerScript } = require('../src/modules/calls/call.service');

const now = new Date('2026-10-16T06:00:00Z');
const approved = {
  provider: 'authkey', live: true, enabled: true,
  authkeyApiKey: 'fixture-only-key', authkeyVoiceApproved: true,
  authkeyOtpTemplateId: '1001',
};
const verifiedPreferences = {
  phone_e164: '+919000000001', phone_verified_at: now,
  welcome_enabled: true, booking_enabled: true,
  reminders_enabled: true, recommendations_enabled: false,
};
// These checks use pure configuration/readiness paths. Any DB or provider
// operation is a regression, not permission to contact a configured service.
const db = {
  query: async () => assert.fail('Configuration checks must not query a database'),
  connect: async () => assert.fail('Configuration checks must not connect to a database'),
};
const serviceFor = (settings = approved) => createCallService({
  db, settings: () => settings, clock: () => now,
  providerFactory: () => assert.fail('No Twilio operation expected'),
  authkeyFactory: () => assert.fail('No Authkey operation expected'),
  recommend: async () => assert.fail('Authkey must not request promotional recommendations'),
});

test('Authkey needs explicit voice approval, valid credentials and live mode', () => {
  assert.equal(ready(approved), true);
  for (const patch of [
    { live: false }, { authkeyVoiceApproved: false }, { authkeyVoiceApproved: undefined },
    { authkeyApiKey: '' }, { authkeyApiKey: 'short' }, { authkeyApiKey: 'bad key with spaces' },
    { authkeyApiKey: 'a'.repeat(513) },
    { authkeyVoiceTemplateId: 'not-a-number' }, { authkeyVoiceTemplateId: '1'.repeat(21) },
  ]) assert.equal(ready({ ...approved, ...patch }), false);
  assert.equal(ready({ ...approved, authkeyVoiceTemplateId: '1200' }), true);
});

test('pending Authkey activation is visible and cannot enqueue or dispatch calls', async () => {
  const service = serviceFor({ ...approved, authkeyVoiceApproved: false });
  const status = service.status();
  assert.equal(status.provider, 'authkey');
  assert.equal(status.mode, 'preview');
  assert.equal(status.configured, false);
  assert.equal(status.schedulerEnabled, false);
  assert.equal(status.phoneVerificationConfigured, false);
  assert.equal(status.activationPending, true);
  const account = service.accountStatus(verifiedPreferences);
  assert.equal(account.state, 'blocked');
  assert(account.reasons.some((reason) => reason.code === 'PROVIDER_ACTIVATION_PENDING'));
  assert.deepEqual(await service.enqueue(), { queued: 0, mode: 'preview' });
  assert.deepEqual(await service.dispatchOne(), { skipped: true });
});

test('Authkey status separates voice readiness from OTP-template readiness and Twilio features', () => {
  const status = serviceFor({ ...approved, trial: true }).status();
  assert.equal(status.mode, 'live');
  assert.equal(status.configured, true);
  assert.equal(status.schedulerEnabled, true);
  assert.equal(status.phoneVerificationConfigured, true);
  assert.equal(status.phoneVerificationChannel, 'voice');
  assert.equal(status.activationPending, false);
  assert.equal(status.trialMode, false, 'A leftover Twilio trial flag must not leak to Authkey');
  assert.equal(status.supportsInteractiveCalls, false);
  assert.equal(status.recommendationsAvailable, false);
  for (const template of [undefined, '', 'invalid', '1'.repeat(21)]) {
    const missing = serviceFor({ ...approved, authkeyOtpTemplateId: template }).status();
    assert.equal(missing.phoneVerificationConfigured, false);
    assert.equal(missing.configured, true, 'OTP setup and voice credentials are separate');
  }
  assert.equal(serviceFor({ ...approved, enabled: false }).status().schedulerEnabled, false);
});

test('unknown provider fails closed even when usable Twilio credentials remain configured', async () => {
  const settings = {
    ...approved, provider: 'authkey-typo',
    sid: `AC${'1'.repeat(32)}`, token: 'fixture-only',
    from: '+15005550006', verify: `VA${'2'.repeat(32)}`, base: 'https://example.invalid',
  };
  assert.equal(ready(settings), false);
  const service = serviceFor(settings);
  assert.equal(service.status().configured, false);
  assert.deepEqual(await service.enqueue(), { queued: 0, mode: 'preview' });
  assert.deepEqual(await service.dispatchOne(), { skipped: true });
});

test('phone readiness asks for self-service voice verification and rejects unsupported destinations', async () => {
  const service = serviceFor();
  const unverified = service.accountStatus({ ...verifiedPreferences, phone_verified_at: null });
  assert.equal(unverified.state, 'blocked');
  const reason = unverified.reasons.find((item) => item.code === 'PHONE_UNVERIFIED');
  assert.match(reason.message, /code delivered by an automated call/i);
  assert.doesNotMatch(reason.message, /Twilio|project owner|administrator/i);
  assert.equal(service.accountStatus(verifiedPreferences).state, 'ready');
  const unsupported = { ...verifiedPreferences, phone_e164: '+15005550009' };
  assert(service.accountStatus(unsupported).reasons.some((item) => item.code === 'PHONE_UNSUPPORTED'));
  assert.equal(await service.eligible({ kind: 'WELCOME' }, unsupported, db), false);
  const pending = serviceFor({ ...approved, authkeyOtpTemplateId: '' })
    .accountStatus({ ...verifiedPreferences, phone_verified_at: null });
  assert.match(pending.reasons.find((item) => item.code === 'PHONE_UNVERIFIED').message, /setup is complete/i);
});

test('Authkey cannot accept or dispatch promotional recommendation consent', async () => {
  const service = serviceFor();
  await assert.rejects(service.updatePreferences('fixture-user', {
    ...verifiedPreferences, recommendations_enabled: true,
  }), (error) => error.status === 400 && /unavailable/i.test(error.message));
  assert.equal(await service.eligible({ kind: 'RECOMMENDATION' }, verifiedPreferences, db), false);
  const onlyPromotions = service.accountStatus({
    ...verifiedPreferences, welcome_enabled: false, booking_enabled: false,
    reminders_enabled: false, recommendations_enabled: true,
  });
  assert(onlyPromotions.reasons.some((reason) => reason.code === 'CALLS_OPTED_OUT'));
  assert.equal(providerScript('RECOMMENDATION', { title: 'Promoted item' }, approved), '');
});

test('Authkey speech keeps rental identities private and promises no unsupported keypad or voice features', () => {
  const payload = {
    title: 'Sensitive medical item', name: 'Fixture Student', phone_e164: '+919000000001',
    email: 'fixture@dbit.co.in', stage: 'in 4 days', end_date: '2026-10-20',
    delivery_requested: true,
  };
  for (const kind of ['WELCOME', 'BOOKING_CONFIRMATION', 'DUE_REMINDER']) {
    const script = providerScript(kind, payload, approved);
    assert.match(script, /CampusMesh.*automated assistant/i);
    assert.match(script, /turn off calls in Reminders/i);
    assert.doesNotMatch(script, /Sensitive medical item|Fixture Student|9000000001|fixture@dbit/i);
    assert.doesNotMatch(script, /press\s+[19]|ask.*question|Polly|female|<Gather|<Say|<speak/i);
  }
  assert.match(providerScript('DUE_REMINDER', payload, approved), /due in 4 days/i);
  assert.match(providerScript('BOOKING_CONFIRMATION', payload, approved), /delivery tracking/i);
});
