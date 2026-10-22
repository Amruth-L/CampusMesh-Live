const crypto = require('crypto');
const pool = require('../../config/database');
const sendEmail = require('../../shared/send-email');

const hashCode = (email, purpose, code) => crypto.createHmac('sha256', process.env.JWT_SECRET)
  .update(`${email}:${purpose}:${code}`).digest('hex');
const failure = (error, status = 400, extra = {}) => ({ error, status, ...extra });

function checkCode(record, expectedHash, now = Date.now()) {
  if (!record || !Number.isFinite(new Date(record.expires_at).getTime()) || new Date(record.expires_at).getTime() <= now)
    return failure('This code has expired. Request a new code.');
  if (record.attempts >= 5) return failure('Too many incorrect attempts. Request a new code.', 429);
  const actual = Buffer.from(record.code_hash);
  const expected = Buffer.from(expectedHash);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
    return failure('That code is incorrect. Please try again.');
  return null;
}

async function sendCode(email, purpose, name) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the account to serialize concurrent resends, including the first one.
    await client.query('SELECT id FROM users WHERE email=$1 FOR UPDATE', [email]);
    const { rows } = await client.query('SELECT sent_at FROM auth_codes WHERE email=$1 AND purpose=$2', [email, purpose]);
    const retryAfter = rows[0] ? Math.ceil((new Date(rows[0].sent_at).getTime() + 60000 - Date.now()) / 1000) : 0;
    if (retryAfter > 0) {
      await client.query('COMMIT');
      return failure(`Please wait ${retryAfter} seconds before requesting another code.`, 429, { retryAfter });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    await client.query(`INSERT INTO auth_codes(email,purpose,code_hash,expires_at,sent_at,attempts)
      VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes',NOW(),0)
      ON CONFLICT(email,purpose) DO UPDATE SET code_hash=EXCLUDED.code_hash,
      expires_at=EXCLUDED.expires_at,sent_at=EXCLUDED.sent_at,attempts=0`, [email, purpose, hashCode(email, purpose, code)]);
    try {
      await sendEmail(email, purpose === 'reset' ? 'Your CampusMesh Password Reset Code' : 'Your CampusMesh Verification Code', code, name);
    } catch {
      await client.query('ROLLBACK');
      return failure('We couldn’t send your email. Please try again shortly.', 503);
    }
    await client.query('COMMIT');
    return { retryAfter: 60, expiresIn: 600 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function consumeCode(email, purpose, code, onVerified) {
  if (!/^\d{6}$/.test(String(code))) return failure('Enter the 6-digit code from your email.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE email=$1 FOR UPDATE', [email]);
    const { rows } = await client.query('SELECT * FROM auth_codes WHERE email=$1 AND purpose=$2 FOR UPDATE', [email, purpose]);
    const error = checkCode(rows[0], hashCode(email, purpose, String(code)));
    if (error) {
      if (rows[0]) await client.query('UPDATE auth_codes SET attempts=LEAST(attempts+1,5) WHERE email=$1 AND purpose=$2', [email, purpose]);
      await client.query('COMMIT');
      return error;
    }
    await onVerified(client);
    await client.query('DELETE FROM auth_codes WHERE email=$1 AND purpose=$2', [email, purpose]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { sendCode, consumeCode, checkCode, hashCode };
