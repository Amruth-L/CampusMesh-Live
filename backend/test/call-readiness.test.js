const test = require('node:test');
const assert = require('node:assert/strict');
const { accountReadiness, bookingReadiness } = require('../src/modules/calls/call-readiness');
const { createCallService } = require('../src/modules/calls/call.service');

const now = new Date('2026-10-15T18:00:00Z');
const status = {
  configured: true,
  schedulerEnabled: true,
  trialMode: true,
  phoneVerificationConfigured: false,
  withinCallWindow: false,
  window: '09:00–19:00 Asia/Kolkata',
};
const preferences = {
  phone_e164: '+919000000001',
  phone_verified_at: null,
  welcome_enabled: true,
  booking_enabled: true,
  reminders_enabled: true,
};
const rental = {
  id: 'rental-1',
  payment_status: 'RENTAL_PAID',
  status: 'RENTAL_PAYMENT_COMPLETED',
  booking_confirmed_at: null,
  demo_slug: 'desk-lamp',
};
const check = (overrides = {}) =>
  bookingReadiness({
    rental,
    preferences,
    status,
    bookingStatuses: ['QR_GENERATED', 'RENTAL_ACTIVE'],
    now,
    ...overrides,
  });

test('paid sample rental explains all blockers without suggesting a call was placed', () => {
  const result = check();
  assert.equal(result.state, 'blocked');
  assert.equal(result.latestCall, null);
  assert.equal(result.phoneVerified, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ['DEMO_RENTAL', 'BOOKING_NOT_CONFIRMED', 'PHONE_UNVERIFIED', 'QUIET_HOURS'],
  );
  assert.match(result.reasons.find((r) => r.code === 'PHONE_UNVERIFIED').message, /Twilio/);
});

test('eligible fully paid real booking waits through quiet hours without claiming it is queued', () => {
  const result = check({
    rental: {
      ...rental,
      demo_slug: null,
      payment_status: 'FULLY_PAID',
      status: 'QR_GENERATED',
      booking_confirmed_at: now,
    },
    preferences: { ...preferences, phone_verified_at: now },
  });
  assert.equal(result.state, 'scheduled');
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ['QUIET_HOURS'],
  );
  assert.equal(result.latestCall, null);
});

test('failed or completed call attempt remains visible alongside current blockers', () => {
  for (const callStatus of ['FAILED', 'COMPLETED']) {
    const latestCall = { id: 'call-1', status: callStatus, started_at: now };
    const result = check({ latestCall });
    assert.equal(result.state, 'attempted');
    assert.equal(result.latestCall.status, callStatus);
    assert.ok(result.reasons.length > 0);
  }
});

test('consent, booking expiry, provider and phone remain independent requirements', () => {
  const result = check({
    rental: {
      ...rental,
      demo_slug: null,
      payment_status: 'FULLY_PAID',
      status: 'QR_GENERATED',
      booking_confirmed_at: new Date(now.getTime() - 2 * 86400000),
    },
    preferences: { ...preferences, phone_e164: null, booking_enabled: false },
    status: { ...status, configured: false, withinCallWindow: true },
  });
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ['BOOKING_WINDOW_PASSED', 'BOOKING_OPTED_OUT', 'PROVIDER_UNAVAILABLE', 'PHONE_MISSING'],
  );
});

test('account readiness does not confuse a connected provider with a verified recipient', () => {
  assert.equal(accountReadiness(status, preferences).state, 'blocked');
  const result = accountReadiness(
    { ...status, withinCallWindow: true },
    { ...preferences, phone_verified_at: now },
  );
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.reasons, []);
});

test('rental call status is scoped to its borrower and does not read or create their preferences for nonowners', async () => {
  let queries = 0;
  const db = {
    query: async (sql, params) => {
      queries += 1;
      assert.match(sql, /r\.id=\$1 AND r\.borrower_id=\$2/);
      assert.deepEqual(params, ['rental-1', 'other-user']);
      return { rows: [] };
    },
  };
  const service = createCallService({ db, clock: () => now });
  await assert.rejects(service.bookingStatus('other-user', 'rental-1'), (error) => error.status === 404);
  assert.equal(queries, 1);
});
