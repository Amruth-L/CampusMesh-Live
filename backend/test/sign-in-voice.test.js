const test = require('node:test');
const assert = require('node:assert/strict');
const { createCallService, scriptFor } = require('../src/modules/calls/call.service');

const now = new Date('2026-10-16T06:00:00Z');
const originalAttempt = '10000000-0000-4000-8000-000000000001';
const newerAttempt = '10000000-0000-4000-8000-000000000002';
const phone = '+919000000001';

function fixture() {
  const state = {
    job: {
      id: '20000000-0000-4000-8000-000000000001',
      user_id: '30000000-0000-4000-8000-000000000001',
      kind: 'SIGN_IN_GREETING',
      provider: 'twilio',
      provider_sid: 'CA' + '1'.repeat(32),
      status: 'RINGING',
      started_at: new Date(now.getTime() - 10000),
      payload: { sign_in_id: originalAttempt, phone_e164: phone },
      script: scriptFor('SIGN_IN_GREETING'),
    },
    preferences: { phone_e164: phone, phone_verified_at: now, login_calls_enabled: true },
    latestAttempt: newerAttempt,
    event: { attempt_id: originalAttempt, phone_e164: phone, created_at: new Date(now.getTime() - 20000) },
    emailVerified: true,
    ledgerReads: 0,
    latestReads: 0,
  };
  const result = (row) => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const db = {
    async query(sql, params) {
      if (sql.startsWith('SELECT * FROM automated_calls')) return result(state.job);
      if (sql.startsWith('INSERT INTO call_preferences')) return result(null);
      if (sql.startsWith('SELECT * FROM call_preferences')) return result(state.preferences);
      if (sql.startsWith('SELECT id FROM users WHERE')) {
        state.latestReads++;
        assert.equal(params[0], state.job.user_id);
        return result(state.emailVerified && params[1] === state.latestAttempt ? { id: state.job.user_id } : null);
      }
      if (sql.startsWith('SELECT e.attempt_id FROM sign_in_call_events')) {
        state.ledgerReads++;
        assert.equal(params[0], state.job.user_id);
        const event = state.event;
        const time = new Date(params[2]).getTime();
        return result(state.emailVerified && event && event.attempt_id === params[1] &&
          event.phone_e164 === params[3] && event.created_at.getTime() <= time &&
          event.created_at.getTime() >= time - 86400000 ? event : null);
      }
      assert.fail('Unexpected query in the in-memory voice fixture: ' + sql);
    },
    connect: async () => assert.fail('The voice fixture must not connect to a database'),
  };
  const service = createCallService({
    db,
    settings: () => ({ provider: 'twilio', live: true, enabled: true,
      sid: 'AC' + '1'.repeat(32), token: 'fixture-only', from: '+15005550006', base: 'https://example.invalid' }),
    clock: () => now,
    providerFactory: () => assert.fail('Rendering a webhook must not place another call'),
    authkeyFactory: () => assert.fail('A Twilio webhook must never contact Authkey'),
  });
  return { state, db, service };
}

test('a newer login supersedes a queued greeting but does not silence an already ringing greeting', async () => {
  const { state, db, service } = fixture();
  assert.equal(await service.eligible({ ...state.job, status: 'QUEUED', started_at: null }, state.preferences, db), false);
  assert.equal(state.latestReads, 1, 'Queue and dispatch still require the latest successful login');
  const xml = await service.voice(state.job.id, { CallSid: state.job.provider_sid }, 'voice');
  assert.match(xml, /Welcome back to CampusMesh/);
  assert.match(xml, /Press 9 to stop automated calls/);
  assert.doesNotMatch(xml, /no longer needed/);
  assert.equal(state.ledgerReads, 1, 'An accepted call is checked against its original durable intent');
  assert.equal(state.latestReads, 1, 'The accepted callback must not require the latest login event');
});

test('an authenticated callback before provider acknowledgment uses the stricter latest-login check', async () => {
  const { state, service } = fixture();
  state.job.status = 'DISPATCHING';
  state.job.provider_sid = null;
  state.latestAttempt = originalAttempt;
  // Authentication remains the route's responsibility. This models its normal
  // signed callback with a valid CallSid arriving before calls.create returns.
  const body = { CallSid: 'CA' + '1'.repeat(32) };
  const first = await service.voice(state.job.id, body, 'voice');
  assert.match(first, /Welcome back to CampusMesh/);
  assert.equal(state.latestReads, 1);
  assert.equal(state.ledgerReads, 0, 'Missing provider acknowledgment cannot use relaxed event matching');

  state.latestAttempt = newerAttempt;
  const superseded = await service.voice(state.job.id, body, 'voice');
  assert.doesNotMatch(superseded, /Welcome back to CampusMesh/);
  assert.match(superseded, /Hangup/);
  assert.equal(state.latestReads, 2);
  assert.equal(state.ledgerReads, 0);
});

test('accepted sign-in speech still requires current consent, verified ownership and a fresh original event', async (t) => {
  for (const [name, change] of [
    ['opted out', (s) => { s.preferences.login_calls_enabled = false; }],
    ['phone unverified', (s) => { s.preferences.phone_verified_at = null; }],
    ['phone changed', (s) => { s.preferences.phone_e164 = '+919000000002'; }],
    ['event missing', (s) => { s.event = null; }],
    ['event expired', (s) => { s.event.created_at = new Date(now.getTime() - 86400001); }],
    ['future event', (s) => { s.event.created_at = new Date(now.getTime() + 1); }],
    ['event phone differs', (s) => { s.event.phone_e164 = '+919000000002'; }],
    ['email unverified', (s) => { s.emailVerified = false; }],
  ]) {
    await t.test(name, async () => {
      const { state, service } = fixture();
      change(state);
      const xml = await service.voice(state.job.id, { CallSid: state.job.provider_sid }, 'voice');
      assert.doesNotMatch(xml, /Welcome back to CampusMesh/);
      assert.match(xml, /Hangup/);
    });
  }
});

test('the accepted-call exception requires recorded provider acceptance and the matching callback SID', async (t) => {
  for (const [name, change, callbackSid] of [
    ['not started', (s) => { s.job.started_at = null; }],
    ['no provider SID', (s) => { s.job.provider_sid = null; }, 'CA' + '1'.repeat(32)],
    ['invalid provider SID', (s) => { s.job.provider_sid = 'invalid'; }, 'invalid'],
    ['dispatch pending', (s) => { s.job.status = 'DISPATCHING'; }],
    ['queued', (s) => { s.job.status = 'QUEUED'; }],
    ['completed', (s) => { s.job.status = 'COMPLETED'; }],
    ['other provider', (s) => { s.job.provider = 'authkey'; }],
    ['wrong callback SID', () => {}, 'CA' + '2'.repeat(32)],
  ]) {
    await t.test(name, async () => {
      const { state, service } = fixture();
      change(state);
      const xml = await service.voice(state.job.id, { CallSid: callbackSid || state.job.provider_sid }, 'voice');
      assert.doesNotMatch(xml, /Welcome back to CampusMesh/);
      assert.match(xml, /Hangup/);
      assert.equal(state.ledgerReads, 0, 'Unaccepted or mismatched callbacks cannot use the exception');
    });
  }
});
