const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');
const mailPath = require.resolve('../src/shared/send-email');
let failDelivery = false;
const messages = [];
require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: async (email, subject, code) => {
  if (failDelivery) throw new Error('Fixture delivery unavailable');
  messages.push({ email, subject, code });
} };
process.env.JWT_SECRET = 'isolated-auth-workflow-fixture-only';
const workerPath = require.resolve('../src/modules/calls/call.worker');
require.cache[workerPath] = { id: workerPath, filename: workerPath, loaded: true,
  exports: { requestTick: () => false } };
const auth = require('../src/modules/auth/auth.controller');
const profile = require('../src/modules/profile/profile.controller');

// Every database operation is replaced; this test cannot contact the configured database.
function database(t) {
  const state = { user: null, codes: {}, preferences: null };
  let snapshot;
  const result = row => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  const query = async (sql, p = []) => {
    if (sql === 'BEGIN') { snapshot = JSON.parse(JSON.stringify(state)); return result(); }
    if (sql === 'COMMIT') { snapshot = undefined; return result(); }
    if (sql === 'ROLLBACK') { Object.assign(state, snapshot); snapshot = undefined; return result(); }
    if (sql.startsWith('SELECT') && sql.includes('FROM users')) {
      return result(state.user && [state.user.id, state.user.email].includes(p[0]) ? state.user : null);
    }
    if (sql.startsWith('INSERT INTO users')) {
      state.user = { id: 'fixture-user', name: p[0], username: p[1], email: p[2], password: p[3], phone_number: p[4], email_verified: false };
      return result(state.user);
    }
    if (sql.startsWith('INSERT INTO call_preferences')) {
      state.preferences = { welcome_enabled: p[2], booking_enabled: p[3], reminders_enabled: p[3],
        login_calls_enabled: p[4] ?? false, phone_e164: p[1], phone_verified_at: null };
      return result();
    }
    if (sql.startsWith('INSERT INTO call_consent_events')) return result();
    if (sql.includes('FROM call_preferences')) return result(state.preferences);
    if (sql.startsWith('SELECT') && sql.includes('FROM auth_codes')) return result(state.codes[p[1]]);
    if (sql.startsWith('INSERT INTO auth_codes')) {
      state.codes[p[1]] = { code_hash: p[2], expires_at: new Date(Date.now() + 600000).toISOString(), sent_at: new Date().toISOString(), attempts: 0 };
      return result();
    }
    if (sql.startsWith('UPDATE auth_codes SET attempts')) { state.codes[p[1]].attempts++; return result(); }
    if (sql.startsWith('DELETE FROM auth_codes')) { delete state.codes[p[1]]; return result(); }
    if (sql.startsWith('UPDATE users SET email_verified')) { state.user.email_verified = true; return result(state.user); }
    if (sql.startsWith('UPDATE users SET password')) { state.user.password = p[0]; state.user.email_verified = true; return result(state.user); }
    if (sql.startsWith('UPDATE users SET first_signed_in_at')) {
      if (state.user.first_signed_in_at) return result();
      state.user.first_signed_in_at = new Date().toISOString();
      return result(state.user);
    }
    assert.fail(`Unexpected fixture query: ${sql}`);
  };
  t.mock.method(pool, 'query', query);
  t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
  return state;
}

async function request(handler, body, user) {
  const response = { statusCode: 200, headers: {}, status(status) { this.statusCode = status; return this; },
    set(key, value) { this.headers[key] = value; return this; }, json(data) { this.body = data; return this; } };
  await handler({ body, user }, response);
  return response;
}

test('failed signup delivery can resume, verify, sign in and reset with uppercase college email', async t => {
  const state = database(t);
  messages.length = 0;
  const signup = { name: 'OTP Workflow', username: 'otp_workflow', email: ' OTP.STUDENT@DBIT.CO.IN ',
    password: 'FixturePassword123!', phone_number: '+15005550009', welcome_enabled: false, rental_calls_enabled: false };
  try {
    failDelivery = true;
    let response = await request(auth.signup, signup);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.accountCreated, true);
    assert.equal(state.user.email, 'otp.student@dbit.co.in');
    assert.deepEqual(state.codes, {}, 'Failed mail must not leave a usable verification code');
    const originalPassword = state.user.password;
    failDelivery = false;

    response = await request(auth.signup, { ...signup, password: 'DifferentPassword123!' });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.requiresVerification, true);
    assert.equal(response.body.email, state.user.email);
    assert.equal(state.user.password, originalPassword, 'Recovery must not overwrite pending account credentials');
    assert.equal(messages.length, 0);
    assert.equal((await request(auth.login, signup)).statusCode, 403);

    response = await request(auth.resendOtp, { email: signup.email });
    assert.equal(response.statusCode, 200);
    assert.equal(messages[0].email, state.user.email);
    const verificationCode = messages[0].code;
    assert.equal((await request(auth.resendOtp, { email: signup.email })).statusCode, 429);
    assert.equal(messages.length, 1, 'Immediate resends must not send a second email');
    assert.equal((await request(auth.verifyEmail, { email: signup.email, otp: 'abcdef' })).statusCode, 400);
    assert.equal(state.user.email_verified, false);
    assert.equal((await request(auth.verifyEmail, { email: signup.email, otp: verificationCode })).statusCode, 200);
    assert.equal(state.user.email_verified, true);
    assert.equal((await request(auth.verifyEmail, { email: signup.email, otp: verificationCode })).statusCode, 400);
    assert.equal((await request(auth.login, signup)).statusCode, 200);
    assert.equal((await request(auth.resendOtp, { email: signup.email })).statusCode, 409);
    response = await request(auth.signup, signup);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.requiresVerification, undefined);

    response = await request(auth.forgotPassword, { email: signup.email });
    assert.equal(response.statusCode, 200);
    assert.equal(messages.length, 2);
    const resetCode = messages[1].code;
    assert.equal((await request(auth.resetPassword, { email: signup.email, otp: resetCode, newPassword: 'short' })).statusCode, 400);
    assert.ok(state.codes.reset, 'Invalid password must not consume a valid reset code');
    assert.equal((await request(auth.resetPassword, { email: signup.email, otp: resetCode, newPassword: 'NewFixturePassword123!' })).statusCode, 200);
    assert.equal((await request(auth.resetPassword, { email: signup.email, otp: resetCode, newPassword: 'OtherFixturePassword123!' })).statusCode, 400);
    assert.equal((await request(auth.login, signup)).statusCode, 400);
    assert.equal((await request(auth.login, { ...signup, password: 'NewFixturePassword123!' })).statusCode, 200);
  } finally { failDelivery = false; }
});

test('non-college emails and malformed login payloads fail before database access', async t => {
  t.mock.method(pool, 'query', () => assert.fail('Invalid input reached database'));
  t.mock.method(pool, 'connect', () => assert.fail('Invalid input reached database'));
  for (const handler of [auth.verifyEmail, auth.resendOtp, auth.forgotPassword, auth.resetPassword])
    assert.equal((await request(handler, { email: 'student@gmail.com' })).statusCode, 400);
  assert.equal((await request(auth.signup, { name: 'Student', username: 'student', email: 'student@gmail.com' })).statusCode, 400);
  for (const body of [{ email: {}, password: 'password' }, { email: 'student@dbit.co.in', password: {} }, { email: ' ', password: 'password' }])
    assert.equal((await request(auth.login, body)).statusCode, 400);
});

test('profile editing cannot transfer verified email ownership', async t => {
  const queries = [];
  t.mock.method(pool, 'query', async sql => {
    queries.push(sql);
    assert.ok(sql.startsWith('SELECT * FROM users'), 'A profile email change must never reach an UPDATE');
    return { rows: [{ id: 'fixture-user', email: 'verified@dbit.co.in', email_verified: true }] };
  });
  for (const email of ['other@dbit.co.in', 'other@gmail.com', null]) {
    const response = await request(profile.updateProfile, { email }, { id: 'fixture-user' });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /cannot be changed/);
  }
  assert.equal((await request(profile.updateProfile, { email: ' VERIFIED@DBIT.CO.IN ' }, { id: 'fixture-user' })).statusCode, 200);
  assert.equal(queries.length, 4);
});
