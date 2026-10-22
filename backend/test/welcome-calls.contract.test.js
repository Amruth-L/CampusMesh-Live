/* global fetch */
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('signup, verified first sign-in, welcome consent and exactly one provider attempt', {
  skip: process.env.WELCOME_E2E !== '1',
}, async () => {
  require('dotenv').config({ quiet: true });
  const pool = require('../src/config/database');
  const { createCallService } = require('../src/modules/calls/call.service');
  const codes = new Map();
  const mailPath = require.resolve('../src/shared/send-email');
  require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true,
    exports: async (email, _subject, code) => codes.set(email, code) };
  const app = require('../src/app');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `qa-welcome-${suffix}@dbit.co.in`;
  let userId, server, sends = 0, sms = 0;
  const settings = () => ({ live: true, enabled: true, sid: 'AC' + '1'.repeat(32),
    token: 'fixture-only', from: '+15005550006', verify: 'VA' + '3'.repeat(32), base: 'https://example.invalid' });
  // Restrict worker queries to this fixture so existing users/jobs remain untouched.
  const scopedQuery = target => (sql, values) => {
    if (sql.startsWith('SELECT * FROM call_preferences WHERE phone_verified_at')) {
      sql += ' AND user_id=$1'; values = [userId];
    } else if (sql.startsWith("SELECT * FROM automated_calls WHERE status='QUEUED'")) {
      sql = sql.replace('ORDER BY', 'AND user_id=$1 ORDER BY'); values = [userId];
    } else if (sql.startsWith("UPDATE automated_calls SET status='UNKNOWN'")) {
      sql += ' AND user_id=$1'; values = [userId];
    }
    return target.query(sql, values);
  };
  const db = { query: scopedQuery(pool), connect: async () => {
    const client = await pool.connect();
    return { query: scopedQuery(client), release: () => client.release() };
  } };
  const service = createCallService({ db, settings,
    clock: () => { const d = new Date(); d.setUTCHours(6, 0, 0, 0); return d; },
    recommend: async () => [],
    providerFactory: () => ({ calls: { create: async () => {
      sends++; return { sid: 'CA' + '2'.repeat(32) };
    } }, verify: { v2: { services: () => ({
      verifications: { create: async () => { sms++; return { status: 'pending' }; } },
      verificationChecks: { create: async ({ code }) => ({ status: code === '654321' ? 'approved' : 'pending' }) },
    }) } } }),
  });
  try {
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const request = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };
    const signup = { name: 'QA Welcome', username: `qa_${suffix}`, email, password: 'FixtureWelcome123!',
      phone_number: '+1 (500) 555-0009', welcome_enabled: true, rental_calls_enabled: true };
    assert.equal((await request('/signup', { ...signup, phone_number: '' })).status, 400);
    assert.equal((await request('/signup', { ...signup, welcome_enabled: 'true' })).status, 400);
    assert.equal((await request('/signup', { ...signup, rental_calls_enabled: 'true' })).status, 400);
    assert.equal((await request('/signup', signup)).status, 201);
    userId = (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
    let prefs = await service.preferences(userId);
    assert.equal(prefs.phone_e164, '+15005550009');
    assert.equal(prefs.welcome_enabled, true);
    assert.equal(prefs.reminders_enabled, true);
    assert.equal(prefs.booking_enabled, true);
    assert.equal(prefs.recommendations_enabled, false);
    assert.equal(prefs.phone_verified_at, null);
    assert.equal(sends + sms, 0, 'Signup must not dial or send phone SMS');
    assert.equal((await service.enqueue()).queued, 0);
    assert.equal((await request('/login', signup)).status, 403);
    assert.equal((await pool.query('SELECT first_signed_in_at FROM users WHERE id=$1', [userId])).rows[0].first_signed_in_at, null);
    assert.equal((await request('/verify-email', { email, otp: codes.get(email) })).status, 200);
    assert.equal((await request('/login', { email, password: 'wrong-password' })).status, 400);
    const logins = await Promise.all([request('/login', signup), request('/login', signup)]);
    assert(logins.every(r => r.status === 200));
    assert.equal(logins.filter(r => r.data.welcomeCallSetupNeeded).length, 1, 'Only one concurrent login is first');
    assert.equal((await service.enqueue()).queued, 0, 'Phone remains unverified');
    assert((await service.preview(userId)).previews.some(p => p.kind === 'WELCOME' && !p.eligible));
    await service.verifyPhone(userId);
    assert.equal(sms, 1);
    await assert.rejects(service.verifyPhone(userId, '111111'), /incorrect or expired/);
    await service.verifyPhone(userId, '654321');
    const queued = await Promise.all([service.enqueue(), service.enqueue()]);
    assert.equal(queued.reduce((n, r) => n + r.queued, 0), 1);
    let job = (await pool.query('SELECT * FROM automated_calls WHERE user_id=$1', [userId])).rows[0];
    assert.equal(job.kind, 'WELCOME');
    // Withdrawal before dispatch cancels the pending welcome, with no provider operation.
    await service.updatePreferences(userId, { phone_e164: prefs.phone_e164, welcome_enabled: false,
      reminders_enabled: false, recommendations_enabled: false });
    assert.equal((await service.enqueue()).queued, 0);
    await service.dispatchOne();
    assert.equal(sends, 0);
    // Re-consent can revive a cancelled job only if no attempt was ever made.
    await service.updatePreferences(userId, { phone_e164: prefs.phone_e164, welcome_enabled: true,
      reminders_enabled: false, recommendations_enabled: false });
    assert.equal((await service.enqueue()).queued, 1);
    await Promise.all([service.dispatchOne(), service.dispatchOne()]);
    assert.equal(sends, 1);
    job = (await pool.query('SELECT * FROM automated_calls WHERE user_id=$1', [userId])).rows[0];
    const xml = await service.voice(job.id, { CallSid: job.provider_sid }, 'voice');
    assert.match(xml, /Welcome to CampusMesh/);
    assert.match(xml, /Polly.Aditi/);
    assert.match(xml, /rate="90%" volume="soft"/);
    assert.doesNotMatch(xml, /Press 1/);
    await service.voice(job.id, { CallSid: job.provider_sid, Digits: '9' }, 'answer');
    assert.equal((await service.preferences(userId)).welcome_enabled, false);
    await service.updatePreferences(userId, { phone_e164: prefs.phone_e164, welcome_enabled: true,
      reminders_enabled: false, recommendations_enabled: false });
    assert.equal((await request('/login', signup)).data.welcomeCallSetupNeeded, false);
    assert.equal((await service.enqueue()).queued, 0);
    assert.equal(sends, 1, 'Later sign-ins and re-consent cannot redial an attempted welcome');
    await pool.query("UPDATE users SET first_signed_in_at=NOW()-INTERVAL '8 days' WHERE id=$1", [userId]);
    prefs = await service.preferences(userId);
    assert.equal(await service.eligible(job, prefs, db), false, 'Stale welcome is not delivered');
    assert.equal((await service.preview(userId)).previews.some(p => p.kind === 'WELCOME'), false);
    console.log('PASS signup → email verification → first login → fake SMS verification → exactly one fake welcome call; opt-out and no repeat');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.query('DELETE FROM users WHERE email=$1', [email]);
    await pool.end();
  }
});
