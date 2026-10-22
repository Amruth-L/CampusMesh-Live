const { randomUUID } = require('node:crypto');
const { supportsPhone } = require('./authkey.client');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// A challenge is bound to the authenticated account, saved phone and request ID.
// Neither the OTP nor the provider challenge reference is sent to the browser.
async function verifyAuthkeyPhone({ db, provider, clock = () => new Date() }, userId, code) {
  const checking = code !== undefined;
  if (checking && !/^\d{4,8}$/.test(String(code))) fail(400, 'Enter the verification code from the call.');
  const client = await db.connect();
  let phone, challenge, requestId;
  try {
    await client.query('BEGIN');
    const prefs = (await client.query(
      `SELECT p.* FROM call_preferences p JOIN users u ON u.id=p.user_id
       WHERE p.user_id=$1 AND u.email_verified FOR UPDATE OF p`, [userId],
    )).rows[0];
    if (!prefs) fail(403, 'Sign in with your verified CampusMesh account first.');
    phone = prefs.phone_e164;
    if (!supportsPhone(phone)) fail(400, 'Use an Indian mobile number: +91 followed by 10 digits.');
    if (prefs.phone_verified_at) {
      await client.query('COMMIT');
      return { verified: true };
    }
    // Serialize sends to the same phone, including requests from different accounts.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`campusmesh-phone:${phone}`]);
    const attempts = (await client.query(
      `SELECT COUNT(*) FILTER (WHERE user_id=$1)::int AS user_attempts,
        COUNT(*) FILTER (WHERE phone_e164=$2 AND purpose='send')::int AS phone_sends,
        MAX(created_at) FILTER (WHERE purpose='send' AND (user_id=$1 OR phone_e164=$2)) AS last_send
       FROM phone_verification_attempts WHERE created_at>$3::timestamptz-INTERVAL '1 hour'
       AND (user_id=$1 OR phone_e164=$2)`, [userId, phone, clock()],
    )).rows[0];
    if (attempts.user_attempts >= 8) fail(429, 'Too many verification attempts. Try again in an hour.');
    if (!checking) {
      if (attempts.phone_sends >= 3) fail(429, 'Too many verification calls to this number. Try again in an hour.');
      const wait = Math.ceil((new Date(attempts.last_send).getTime() + 60000 - clock().getTime()) / 1000);
      if (attempts.last_send && wait > 0) fail(429, `Please wait ${wait} seconds before requesting another verification call.`);
      requestId = randomUUID();
      await client.query(
        `INSERT INTO call_phone_verifications(user_id,phone_e164,request_id,expires_at,created_at)
         VALUES($1,$2,$3,$4::timestamptz+INTERVAL '5 minutes',$4)
         ON CONFLICT(user_id) DO UPDATE SET phone_e164=EXCLUDED.phone_e164,request_id=EXCLUDED.request_id,
           provider_reference=NULL,expires_at=EXCLUDED.expires_at,created_at=EXCLUDED.created_at`,
        [userId, phone, requestId, clock()],
      );
    } else {
      challenge = (await client.query('SELECT * FROM call_phone_verifications WHERE user_id=$1', [userId])).rows[0];
      if (!challenge || challenge.phone_e164 !== phone || !challenge.provider_reference ||
          new Date(challenge.expires_at).getTime() <= clock().getTime())
        fail(400, 'Request a new verification call. The previous code is unavailable or expired.');
    }
    await client.query('INSERT INTO phone_verification_attempts(user_id,phone_e164,purpose,created_at) VALUES($1,$2,$3,$4)',
      [userId, phone, checking ? 'check' : 'send', clock()]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  if (!checking) {
    // Never automatically retry: a timeout may still have placed the call.
    const result = await provider.sendVerification(phone);
    const saved = await db.query(
      `UPDATE call_phone_verifications v SET provider_reference=$4
       WHERE v.user_id=$1 AND v.phone_e164=$2 AND v.request_id=$3
       AND EXISTS(SELECT 1 FROM call_preferences p WHERE p.user_id=v.user_id AND p.phone_e164=v.phone_e164)`,
      [userId, phone, requestId, result.id],
    );
    if (!saved.rowCount) fail(409, 'Your phone number changed. Verify the new number.');
    return { sent: true, channel: 'voice', retryAfter: 60, expiresIn: 300 };
  }
  if (!(await provider.checkVerification(challenge.provider_reference, String(code))))
    fail(400, 'The verification code is incorrect or expired.');

  const confirmation = await db.connect();
  try {
    await confirmation.query('BEGIN');
    await confirmation.query('SELECT user_id FROM call_preferences WHERE user_id=$1 FOR UPDATE', [userId]);
    const updated = await confirmation.query(
      `UPDATE call_preferences p SET phone_verified_at=$5,updated_at=$5 WHERE p.user_id=$1 AND p.phone_e164=$2
       AND EXISTS(SELECT 1 FROM call_phone_verifications v WHERE v.user_id=p.user_id AND v.phone_e164=p.phone_e164
         AND v.request_id=$3 AND v.provider_reference=$4 AND v.expires_at>$5)`,
      [userId, phone, challenge.request_id, challenge.provider_reference, clock()],
    );
    if (!updated.rowCount) fail(409, 'Your phone or verification request changed. Request a new verification call.');
    await confirmation.query('DELETE FROM call_phone_verifications WHERE user_id=$1 AND request_id=$2', [userId, challenge.request_id]);
    await confirmation.query('COMMIT');
    return { verified: true };
  } catch (error) {
    await confirmation.query('ROLLBACK');
    throw error;
  } finally { confirmation.release(); }
}

module.exports = { verifyAuthkeyPhone };
