const pool = require('../../config/database');

function normalizePhone(value) {
  if (typeof value !== 'string') return null;
  const digits = value.trim().replace(/[\s()-]/g, '');
  const phone = /^\d{10}$/.test(digits) ? '+91' + digits : digits;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

async function recordFirstSignIn(userId, db = pool) {
  // An atomic update keeps concurrent successful sign-ins from both being first.
  const first = await db.query(
    'UPDATE users SET first_signed_in_at=NOW() WHERE id=$1 AND first_signed_in_at IS NULL RETURNING id',
    [userId],
  );
  if (!first.rowCount) return false;
  const { rows } = await db.query(
    'SELECT welcome_enabled,booking_enabled,reminders_enabled,phone_verified_at FROM call_preferences WHERE user_id=$1',
    [userId],
  );
  return Boolean((rows[0]?.welcome_enabled || rows[0]?.booking_enabled || rows[0]?.reminders_enabled) && !rows[0].phone_verified_at);
}

async function recordSuccessfulSignIn(userId, attemptId, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Serialize events before checking the durable replay ledger. An older
    // request replay must not replace a later successful sign-in's call intent.
    // No key changes here: NO KEY UPDATE also permits the FK KEY SHARE lock
    // taken by consent inserts while a preference save holds the preference row.
    const user = await client.query('SELECT id FROM users WHERE id=$1 AND email_verified FOR NO KEY UPDATE', [userId]);
    if (!user.rowCount) {
      await client.query('COMMIT');
      return { recorded: false, setupNeeded: false };
    }
    const { rows } = await client.query(
      'SELECT login_calls_enabled,phone_e164,phone_verified_at FROM call_preferences WHERE user_id=$1 FOR UPDATE',
      [userId],
    );
    const prefs = rows[0];
    const setupNeeded = Boolean(prefs?.login_calls_enabled && !prefs.phone_verified_at);
    if (!prefs?.login_calls_enabled || !prefs.phone_e164) {
      await client.query('COMMIT');
      return { recorded: false, setupNeeded };
    }
    const event = await client.query(
      `INSERT INTO sign_in_call_events(user_id,attempt_id,phone_e164) VALUES($1,$2,$3)
       ON CONFLICT(user_id,attempt_id) DO NOTHING RETURNING created_at`,
      [userId, attemptId, prefs.phone_e164],
    );
    if (event.rowCount) {
      // Verification may finish after this request. Keep the original number
      // and event time; the worker independently checks ownership and expiry.
      await client.query(
        'UPDATE users SET last_signed_in_at=$3,last_sign_in_id=$2,last_sign_in_phone=$4 WHERE id=$1',
        [userId, attemptId, event.rows[0].created_at, prefs.phone_e164],
      );
    }
    await client.query('COMMIT');
    return { recorded: event.rowCount > 0, setupNeeded };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { normalizePhone, recordFirstSignIn, recordSuccessfulSignIn };
