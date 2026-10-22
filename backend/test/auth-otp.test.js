const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');
const mailPath = require.resolve('../src/shared/send-email');
let mailFailure = false;
let sentCode;
require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: async (_email, _subject, code) => {
  if (mailFailure) throw new Error('SMTP unavailable');
  sentCode = code;
} };
process.env.JWT_SECRET = 'isolated-test-secret-not-used-by-the-app';
const { hashCode, checkCode, consumeCode, sendCode } = require('../src/modules/auth/otp.service');
const email = 'otp-test@dbit.co.in';
const fresh = () => ({ code_hash: hashCode(email, 'verify', '654321'), expires_at: new Date(Date.now() + 600000), attempts: 0 });

function connection(t, record = fresh()) {
  const calls = [];
  let current = record;
  const client = { release() {}, async query(sql, params) {
    calls.push(sql);
    if (sql.startsWith('SELECT * FROM auth_codes')) return { rows: current && params[1] === 'verify' ? [current] : [] };
    if (sql.startsWith('SELECT sent_at')) return { rows: current?.sent_at ? [current] : [] };
    if (sql.startsWith('UPDATE auth_codes SET attempts')) current.attempts++;
    if (sql.startsWith('DELETE FROM auth_codes')) current = null;
    return { rows: [], rowCount: 1 };
  } };
  t.mock.method(pool, 'connect', async () => client);
  return calls;
}

test('hard-coded 123456 cannot verify or reset an unrelated code', async t => {
  connection(t);
  let changed = false;
  for (const purpose of ['verify', 'reset']) {
    const result = await consumeCode(email, purpose, '123456', async () => { changed = true; });
    assert.equal(result.status, 400);
  }
  assert.equal(changed, false);
});

test('missing, expired, invalid-expiry and exhausted codes fail closed', () => {
  const hash = hashCode(email, 'verify', '654321');
  for (const expires_at of [null, 'invalid', new Date(Date.now() - 1)]) assert.ok(checkCode({ ...fresh(), expires_at }, hash));
  assert.ok(checkCode(null, hash));
  assert.equal(checkCode({ ...fresh(), attempts: 5 }, hash).status, 429);
  assert.equal(checkCode(fresh(), hash), null);
  assert.notEqual(hashCode(email, 'verify', '654321'), hashCode(email, 'reset', '654321'));
});

test('verification code cannot reset a password; successful codes are single-use', async t => {
  connection(t);
  let changes = 0;
  assert.equal((await consumeCode(email, 'reset', '654321', async () => { changes++; })).status, 400);
  assert.equal((await consumeCode(email, 'verify', '654321', async () => { changes++; })).ok, true);
  assert.equal((await consumeCode(email, 'verify', '654321', async () => { changes++; })).status, 400);
  assert.equal(changes, 1);
});

test('five incorrect entries lock the code even if the next entry is correct', async t => {
  connection(t);
  for (let i = 0; i < 5; i++) await consumeCode(email, 'verify', '111111', async () => assert.fail('Unexpected verification'));
  assert.equal((await consumeCode(email, 'verify', '654321', async () => assert.fail('Locked code accepted'))).status, 429);
});

test('resend cooldown is enforced on the server', async t => {
  connection(t, { ...fresh(), sent_at: new Date() });
  const result = await sendCode(email, 'verify', 'Test');
  assert.equal(result.status, 429);
  assert.ok(result.retryAfter > 0 && result.retryAfter <= 60);
});

test('email failure rolls back and never reports that the code was sent', async t => {
  const calls = connection(t, null);
  mailFailure = true;
  try {
    const result = await sendCode(email, 'verify', 'Test');
    assert.equal(result.status, 503);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('COMMIT'));
  } finally { mailFailure = false; }
});

test('successful send produces a six digit code and a resend deadline', async t => {
  connection(t, null);
  const result = await sendCode(email, 'verify', 'Test');
  assert.match(sentCode, /^\d{6}$/);
  assert.equal(result.retryAfter, 60);
  assert.equal(result.expiresIn, 600);
});

test('malformed code rejected before database access', async t => {
  t.mock.method(pool, 'connect', async () => assert.fail('Malformed code reached database'));
  for (const code of ['', undefined, '12345', '1234567', 'abcdef']) assert.equal((await consumeCode(email, 'verify', code, () => {})).status, 400);
});
