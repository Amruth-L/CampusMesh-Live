const pool = require('../../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { sendCode, consumeCode } = require('./otp.service');
const { normalizePhone, recordFirstSignIn, recordSuccessfulSignIn } = require('./onboarding.service');
const { requestTick } = require('../calls/call.worker');
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = email => /^[^\s@]+@dbit\.co\.in$/.test(email);
const respondError = (res, result, extra = {}) => {
  if (result.retryAfter) res.set('Retry-After', String(result.retryAfter));
  return res.status(result.status).json({ ...result, ...extra });
};
const serverError = (res, error) => {
  console.error('[auth]', error.code || error.name);
  return res.status(503).json({ error: 'CampusMesh is temporarily unavailable. Please try again shortly.' });
};

exports.signup = async (req, res) => {
  const { name, username, password } = req.body;
  const email = emailOf(req.body.email);
  const phone = normalizePhone(req.body.phone_number);
  const welcome = req.body.welcome_enabled === true;
  const rentalCalls = req.body.rental_calls_enabled === true;
  const loginCalls = req.body.login_calls_enabled === true;
  if (req.body.login_calls_enabled !== undefined && typeof req.body.login_calls_enabled !== 'boolean')
    return res.status(400).json({ error: 'Choose whether you want calls after successful sign-ins.' });
  if (req.body.rental_calls_enabled !== undefined && typeof req.body.rental_calls_enabled !== 'boolean')
    return res.status(400).json({ error: 'Choose whether you want rental calls.' });
  if (typeof name !== 'string' || !name.trim() || typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username.trim()))
    return res.status(400).json({ error: 'Enter your name and a username of 3–20 letters, numbers, or underscores.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Use your DBIT email (@dbit.co.in).' });
  if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password) > 72)
    return res.status(400).json({ error: 'Use a password of at least 6 characters and at most 72 bytes.' });
  if (!phone) return res.status(400).json({ error: 'Enter your mobile number with country code, or a 10-digit Indian mobile number.' });
  if (req.body.welcome_enabled !== undefined && typeof req.body.welcome_enabled !== 'boolean')
    return res.status(400).json({ error: 'Choose whether you want a one-time welcome call.' });
  try {
    const existing = await pool.query('SELECT id,email_verified FROM users WHERE LOWER(email)=$1', [email]);
    if (existing.rowCount) return res.status(409).json(existing.rows[0].email_verified
      ? { error: 'Email is already registered. Please sign in.' }
      : { error: 'Your account is waiting for email verification. Request a new code to finish signing up.',
        requiresVerification: true, email });
    const hash = await bcrypt.hash(password, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO users(name,username,email,password,phone_number) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [name.trim(), username.trim().toLowerCase(), email, hash, phone]);
      await client.query(
        "INSERT INTO call_preferences(user_id,phone_e164,welcome_enabled,booking_enabled,reminders_enabled,login_calls_enabled,consent_version) VALUES($1,$2,$3,$4,$4,$5,'2026-10-16')",
        [rows[0].id, phone, welcome, rentalCalls, loginCalls]);
      await client.query(
        "INSERT INTO call_consent_events(user_id,reminders_enabled,recommendations_enabled,welcome_enabled,booking_enabled,login_calls_enabled,consent_version) VALUES($1,$3,FALSE,$2,$3,$4,'2026-10-16')",
        [rows[0].id, welcome, rentalCalls, loginCalls]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    const result = await sendCode(email, 'verify', name.trim());
    if (result.error) return respondError(res, result, { accountCreated: true, email });
    return res.status(201).json({ message: 'Verification code sent. Check your email.', ...result });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Username or email is already registered.' });
    return serverError(res, error);
  }
};

exports.verifyEmail = async (req, res) => {
  const email = emailOf(req.body.email);
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter your DBIT email.' });
  try {
    const result = await consumeCode(email, 'verify', req.body.otp, client =>
      client.query('UPDATE users SET email_verified=TRUE,otp=NULL,otp_expiry=NULL WHERE email=$1', [email]));
    if (result.error) return respondError(res, result);
    return res.json({ message: 'Email verified. You can now sign in.' });
  } catch (error) { return serverError(res, error); }
};

exports.resendOtp = async (req, res) => {
  const email = emailOf(req.body.email);
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter your DBIT email.' });
  try {
    const { rows } = await pool.query('SELECT name,email_verified FROM users WHERE email=$1', [email]);
    if (!rows[0]) return res.status(404).json({ error: 'Create an account before requesting a verification code.' });
    if (rows[0].email_verified) return res.status(409).json({ error: 'Email already verified. Please sign in.' });
    const result = await sendCode(email, 'verify', rows[0].name);
    if (result.error) return respondError(res, result);
    return res.json({ message: 'A new verification code has been sent.', ...result });
  } catch (error) { return serverError(res, error); }
};

exports.forgotPassword = async (req, res) => {
  const email = emailOf(req.body.email);
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter your DBIT email.' });
  try {
    const { rows } = await pool.query('SELECT name FROM users WHERE email=$1', [email]);
    if (rows[0]) {
      const result = await sendCode(email, 'reset', rows[0].name);
      if (result.error) return respondError(res, result);
    }
    return res.json({ message: 'If an account exists, a reset code has been sent.', retryAfter: 60, expiresIn: 600 });
  } catch (error) { return serverError(res, error); }
};

exports.resetPassword = async (req, res) => {
  const email = emailOf(req.body.email);
  const { newPassword } = req.body;
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter your DBIT email.' });
  if (typeof newPassword !== 'string' || newPassword.length < 6 || Buffer.byteLength(newPassword) > 72)
    return res.status(400).json({ error: 'Use a password of at least 6 characters and at most 72 bytes.' });
  try {
    const result = await consumeCode(email, 'reset', req.body.otp, async client => {
      const password = await bcrypt.hash(newPassword, 10);
      await client.query('UPDATE users SET password=$1,otp=NULL,otp_expiry=NULL,email_verified=TRUE WHERE email=$2', [password, email]);
    });
    if (result.error) return respondError(res, result);
    return res.json({ message: 'Password reset. You can now sign in.' });
  } catch (error) { return serverError(res, error); }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const attemptId = req.body.login_attempt_id === undefined ? randomUUID() : req.body.login_attempt_id;
    if (typeof attemptId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(attemptId)) {
      return res.status(400).json({ error: 'Invalid sign-in attempt. Please try again.' });
    }

    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const userResult = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ message: 'Please verify your email first.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    const welcomeCallSetupNeeded = await recordFirstSignIn(user.id);
    const signIn = await recordSuccessfulSignIn(user.id, attemptId);
    const callSetupNeeded = welcomeCallSetupNeeded || signIn.setupNeeded;

    res.json({
      token,
      welcomeCallSetupNeeded: callSetupNeeded,
      callSetupNeeded,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone_number: user.phone_number,
        avatar_url: user.avatar_url,
        bio: user.bio,
        department: user.department,
        hostel: user.hostel,
        created_at: user.created_at
      }
    });
    // The durable sign-in event is committed before returning. Wake the worker
    // without putting a provider request on the authentication response path.
    requestTick();
  } catch (error) {
    console.error('[Login Error]', error.message || error);
    return serverError(res, error);
  }
};

exports.setMode = async (req, res) => {
  const mode = String(req.body.mode || '').toUpperCase();
  if (!['RENT', 'DELIVERY'].includes(mode)) return res.status(400).json({ error: 'Mode must be RENT or DELIVERY.' });
  // A workspace switch changes navigation preference, not delivery availability.
  const { rows } = await pool.query('UPDATE users SET active_mode = $1 WHERE id = $2 RETURNING id, active_mode, delivery_available', [mode, req.user.id]);
  res.json(rows[0]);
};

exports.setDeliveryAvailability = async (req, res) => {
  const available = Boolean(req.body.available);
  if (available) {
    const route = await pool.query(
      'SELECT id FROM courier_route_availability WHERE courier_id=$1 AND is_active AND available_until > NOW() LIMIT 1',
      [req.user.id],
    );
    if (!route.rowCount) return res.status(409).json({ error: 'Save a future delivery route before going online.' });
  }
  const { rows } = await pool.query('UPDATE users SET delivery_available = $1, active_mode = \'DELIVERY\' WHERE id = $2 RETURNING id, active_mode, delivery_available', [available, req.user.id]);
  res.json(rows[0]);
};

exports.logout = (req, res) => {
  res.json({
    message: 'Logout successful. Delete the JWT from the client.'
  });
};
