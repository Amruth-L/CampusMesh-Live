const pool = require('../../config/database');
const twilio = require('twilio');
const { recommendations } = require('../intelligence/intelligence.service');
const { answer } = require('../support/support.service');
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const { saySoft: speak } = require('./voice');
const { webhookUrl } = require('./webhook-auth');
const { accountReadiness, bookingReadiness } = require('./call-readiness');
const { createAuthkeyClient, supportsPhone } = require('./authkey.client');
const { verifyAuthkeyPhone } = require('./authkey-verification');
const { config, ready, providerName } = require('./call.config');
const { E164, activeRentalStatuses, bookingStatuses, localTime, inCallWindow, reminderStage, consentFor } = require('./call-policy');
const { scriptFor, providerScript } = require('./call-scripts');

function createCallService({
  db = pool,
  settings = config,
  providerFactory = (c) => twilio(c.sid, c.token),
  authkeyFactory = createAuthkeyClient,
  clock = () => new Date(),
  recommend = recommendations,
  supportAnswer = answer,
} = {}) {
  const saySoft = (node, text) => speak(node, text, settings());
  const status = () => {
    const c = settings();
    return {
      mode: ready(c) ? 'live' : 'preview',
      provider: providerName(c),
      trialMode: providerName(c) === 'twilio' && Boolean(c.trial),
      configured: ready(c),
      schedulerEnabled: ready(c) && c.enabled,
      phoneVerificationConfigured: Boolean(ready(c) && (providerName(c) === 'authkey' ? /^\d{1,20}$/.test(c.authkeyOtpTemplateId || '') : c.verify)),
      phoneVerificationChannel: providerName(c) === 'authkey' ? 'voice' : 'sms',
      supportsInteractiveCalls: providerName(c) === 'twilio',
      recommendationsAvailable: providerName(c) === 'twilio',
      activationPending: providerName(c) === 'authkey' && !ready(c),
      language: 'English',
      window: '09:00–19:00 Asia/Kolkata',
      withinCallWindow: inCallWindow(clock()),
      limits:
        'At least 30 minutes between calls, at most three per day. One reminder per day.' +
        (providerName(c) === 'twilio' ? ' One recommendation per seven days.' : ''),
      welcome:
        'One welcome call after your first successful sign-in, with consent and a verified number. No repeat on later sign-ins.',
      signIn:
        'Optional greetings after successful sign-ins, using your verified number. Only the latest sign-in within 24 hours is eligible; repeat-call limits apply.',
    };
  };
  const preferences = async (userId) => {
    await db.query('INSERT INTO call_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
    return (await db.query('SELECT * FROM call_preferences WHERE user_id=$1', [userId])).rows[0];
  };
  const accountStatus = (prefs) => accountReadiness(status(), prefs);
  const bookingStatus = async (userId, rentalId) => {
    const { rows } = await db.query(
      `SELECT r.id,r.status,r.payment_status,r.booking_confirmed_at,l.demo_slug
       FROM rentals r JOIN listings l ON l.id=r.listing_id WHERE r.id=$1 AND r.borrower_id=$2`,
      [rentalId, userId],
    );
    if (!rows[0]) fail(404, 'Rental not found.');
    const prefs = await preferences(userId);
    const calls = await db.query(
      `SELECT id,status,outcome,last_error,created_at,started_at FROM automated_calls
       WHERE rental_id=$1 AND user_id=$2 AND kind='BOOKING_CONFIRMATION' ORDER BY created_at DESC LIMIT 1`,
      [rentalId, userId],
    );
    return bookingReadiness({
      rental: rows[0],
      preferences: prefs,
      status: status(),
      latestCall: calls.rows[0],
      bookingStatuses,
      now: clock(),
    });
  };
  const updatePreferences = async (userId, body) => {
    if (providerName(settings()) === 'authkey' && body.recommendations_enabled === true)
      fail(400, 'Recommendation calls are unavailable. This calling plan supports welcome and rental updates only.');
    if (
      typeof body.reminders_enabled !== 'boolean' ||
      typeof body.recommendations_enabled !== 'boolean' ||
      (body.booking_enabled !== undefined && typeof body.booking_enabled !== 'boolean') ||
      (body.welcome_enabled !== undefined && typeof body.welcome_enabled !== 'boolean') ||
      (body.login_calls_enabled !== undefined && typeof body.login_calls_enabled !== 'boolean') ||
      typeof body.phone_e164 !== 'string' ||
      (body.phone_e164 && !E164.test(body.phone_e164))
    )
      fail(
        400,
        'Use a phone number with country code, such as +91 followed by 10 digits, and choose both preferences.',
      );
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO call_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
      await c.query('SELECT user_id FROM call_preferences WHERE user_id=$1 FOR UPDATE', [userId]);
      const { rows } = await c.query(
        `UPDATE call_preferences SET phone_verified_at=CASE WHEN phone_e164 IS NOT DISTINCT FROM NULLIF($2,'') THEN phone_verified_at ELSE NULL END,phone_e164=NULLIF($2,''),reminders_enabled=$3,recommendations_enabled=$4,welcome_enabled=COALESCE($5,welcome_enabled),booking_enabled=COALESCE($6,booking_enabled),login_calls_enabled=COALESCE($7,login_calls_enabled),consent_version='2026-10-16',updated_at=NOW() WHERE user_id=$1 RETURNING *`,
        [
          userId,
          body.phone_e164,
          body.reminders_enabled,
          body.recommendations_enabled,
          body.welcome_enabled ?? null,
          body.booking_enabled ?? null,
          body.login_calls_enabled ?? null,
        ],
      );
      await c.query('DELETE FROM call_phone_verifications WHERE user_id=$1 AND phone_e164 IS DISTINCT FROM NULLIF($2,\'\')',
        [userId, body.phone_e164]);
      await c.query(
        "INSERT INTO call_consent_events(user_id,reminders_enabled,recommendations_enabled,welcome_enabled,booking_enabled,login_calls_enabled,consent_version) VALUES($1,$2,$3,$4,$5,$6,'2026-10-16')",
        [
          userId,
          body.reminders_enabled,
          body.recommendations_enabled,
          rows[0].welcome_enabled,
          rows[0].booking_enabled,
          rows[0].login_calls_enabled,
        ],
      );
      await c.query('COMMIT');
      // Release the preference lock before touching jobs (workers lock jobs first).
      // Preserve still-eligible jobs when saving unrelated settings. Revalidate before dispatch.
      await db.query(
        `UPDATE automated_calls SET status='CANCELLED',outcome='Preferences changed' WHERE user_id=$1 AND status='QUEUED' AND
        ($2::boolean IS FALSE OR (kind='WELCOME' AND (NOT $3 OR $7)) OR (kind='BOOKING_CONFIRMATION' AND NOT $4) OR (kind='DUE_REMINDER' AND NOT $5) OR (kind='RECOMMENDATION' AND NOT $6) OR (kind='SIGN_IN_GREETING' AND NOT $7))`,
        [
          userId,
          Boolean(rows[0].phone_verified_at),
          rows[0].welcome_enabled,
          rows[0].booking_enabled,
          rows[0].reminders_enabled,
          rows[0].recommendations_enabled,
          rows[0].login_calls_enabled,
        ],
      );
      return rows[0];
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  const verifyPhone = async (userId, code) => {
    const c = settings(),
      prefs = await preferences(userId);
    if (providerName(c) === 'authkey') {
      if (!status().phoneVerificationConfigured)
        fail(503, 'Phone verification is waiting for calling activation. Please try again after setup is complete.');
      return verifyAuthkeyPhone({ db, provider: authkeyFactory(c), clock }, userId, code);
    }
    if (!ready(c) || !c.verify)
      fail(
        503,
        'Phone verification is not configured yet. Calling activation must be completed before you can verify your number.',
      );
    if (!E164.test(prefs.phone_e164 || '')) fail(400, 'Save your phone number first.');
    if (code !== undefined && !/^\d{4,8}$/.test(String(code)))
      fail(400, 'Enter the verification code sent to your phone.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT user_id FROM call_preferences WHERE user_id=$1 FOR UPDATE', [userId]);
      const count = await client.query(
        "SELECT COUNT(*)::int n FROM phone_verification_attempts WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 hour'",
        [userId],
      );
      if (count.rows[0].n >= 8) fail(429, 'Too many verification attempts. Try again in an hour.');
      await client.query('INSERT INTO phone_verification_attempts(user_id) VALUES($1)', [userId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const service = providerFactory(c).verify.v2.services(c.verify);
    if (code !== undefined) {
      const result = await service.verificationChecks.create({ to: prefs.phone_e164, code: String(code) });
      if (result.status !== 'approved') fail(400, 'The verification code is incorrect or expired.');
      const verified = await db.query(
        'UPDATE call_preferences SET phone_verified_at=NOW() WHERE user_id=$1 AND phone_e164=$2',
        [userId, prefs.phone_e164],
      );
      if (!verified.rowCount) fail(409, 'Your phone number changed. Verify the new number.');
      return { verified: true };
    }
    await service.verifications.create({ to: prefs.phone_e164, channel: 'sms' });
    return { sent: true, channel: 'sms' };
  };
  const candidates = async (userId, prefs, preview = false) => {
    const result = [];
    const today = localTime(clock()).day;
    if (prefs.login_calls_enabled) {
      const { rows } = await db.query(
        `SELECT last_sign_in_id,last_signed_in_at FROM users WHERE id=$1 AND email_verified
         AND last_sign_in_id IS NOT NULL AND last_signed_in_at >= $2::timestamptz - INTERVAL '24 hours'
         AND last_signed_in_at <= $2::timestamptz AND last_sign_in_phone=$3`,
        [userId, clock(), prefs.phone_e164],
      );
      if (rows.length)
        result.push({
          kind: 'SIGN_IN_GREETING',
          payload: { sign_in_id: rows[0].last_sign_in_id, phone_e164: prefs.phone_e164 },
          key: `signin:${userId}:${rows[0].last_sign_in_id}`,
        });
    }
    if (prefs.welcome_enabled && !prefs.login_calls_enabled) {
      const { rows } = await db.query(
        `SELECT first_signed_in_at FROM users WHERE id=$1 AND email_verified AND first_signed_in_at IS NOT NULL AND first_signed_in_at >= $2::timestamptz - INTERVAL '7 days'`,
        [userId, clock()],
      );
      if (rows.length)
        result.push({
          kind: 'WELCOME',
          payload: { phone_e164: prefs.phone_e164 },
          key: `welcome:${userId}`,
        });
    }
    if (preview || prefs.booking_enabled) {
      const { rows } = await db.query(
        `SELECT r.id,l.title,r.end_date::text end_date,r.delivery_requested FROM rentals r JOIN listings l ON l.id=r.listing_id
         WHERE r.borrower_id=$1 AND r.payment_status='FULLY_PAID' AND r.status=ANY($2) AND l.demo_slug IS NULL
         AND r.booking_confirmed_at >= $3::timestamptz - INTERVAL '24 hours'`,
        [userId, bookingStatuses, clock()],
      );
      for (const row of rows)
        result.push({
          kind: 'BOOKING_CONFIRMATION',
          rental_id: row.id,
          payload: row,
          key: `booking:${userId}:${row.id}`,
        });
    }
    if (preview || prefs.reminders_enabled) {
      const { rows } = await db.query(
        `SELECT r.id,l.title,r.end_date::text end_date FROM rentals r JOIN listings l ON l.id=r.listing_id WHERE r.borrower_id=$1 AND r.status=ANY($2) AND r.payment_status='FULLY_PAID' AND l.demo_slug IS NULL AND r.end_date BETWEEN $3::date-1 AND $3::date+4`,
        [userId, activeRentalStatuses, today],
      );
      for (const row of rows) {
        const stage = reminderStage(row.end_date, today);
        if (stage)
          result.push({
            kind: 'DUE_REMINDER',
            rental_id: row.id,
            payload: { ...row, stage },
            key: `due:${userId}:${row.id}:${row.end_date}:${stage}`,
          });
      }
    }
    if (providerName(settings()) === 'twilio' && (preview || prefs.recommendations_enabled)) {
      const listing = (await recommend(userId, { db, includeDemo: false })).find((l) => l.evidence >= 5);
      if (listing) {
        const date = new Date(today + 'T00:00:00Z');
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        result.push({
          kind: 'RECOMMENDATION',
          listing_id: listing.id,
          payload: { title: listing.title, rent_price: Number(listing.rent_price), reason: listing.reason },
          key: `recommendation:${userId}:${date.toISOString().slice(0, 10)}`,
        });
      }
    }
    return result;
  };
  const preview = async (userId) => {
    const prefs = await preferences(userId);
    const list = await candidates(userId, prefs, true);
    return {
      status: status(),
      previews: list.map((j) => ({
        ...j,
        script: providerScript(j.kind, j.payload, settings()),
        eligible: Boolean(prefs.phone_verified_at) && prefs[consentFor(j.kind)],
      })),
      sample: {
        example: true,
        kind: 'DUE_REMINDER',
        script: providerScript('DUE_REMINDER', {
          title: 'a calculator',
          stage: 'in 4 days',
          end_date: new Date(Date.parse(localTime(clock()).day + 'T00:00:00Z') + 4 * 86400000)
            .toISOString()
            .slice(0, 10),
        }, settings()),
      },
      bookingSample: {
        example: true,
        kind: 'BOOKING_CONFIRMATION',
        script: providerScript('BOOKING_CONFIRMATION', {
          title: 'a calculator',
          delivery_requested: true,
          end_date: localTime(clock()).day,
        }, settings()),
      },
      welcomeSample: { example: true, kind: 'WELCOME', script: providerScript('WELCOME', {}, settings()) },
      signInSample: { example: true, kind: 'SIGN_IN_GREETING', script: providerScript('SIGN_IN_GREETING', {}, settings()) },
      note: 'Preview only. No phone is called, and no real reminder is created for a demo rental.',
    };
  };
  const enqueue = async () => {
    if (!ready(settings()) || !settings().enabled) return { queued: 0, mode: 'preview' };
    const users = (
      await db.query(
        'SELECT * FROM call_preferences WHERE phone_verified_at IS NOT NULL AND (welcome_enabled OR login_calls_enabled OR booking_enabled OR reminders_enabled OR recommendations_enabled)',
      )
    ).rows;
    let queued = 0;
    for (const prefs of users) {
      if (providerName(settings()) === 'authkey' && !supportsPhone(prefs.phone_e164)) continue;
      for (const j of await candidates(prefs.user_id, prefs)) {
        const persist = (target) => target.query(
          `INSERT INTO automated_calls(user_id,rental_id,listing_id,kind,dedupe_key,payload,script,provider) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(dedupe_key) DO UPDATE SET status='QUEUED',payload=EXCLUDED.payload,script=EXCLUDED.script,provider=EXCLUDED.provider,outcome=NULL,scheduled_at=NOW()
           WHERE automated_calls.status='CANCELLED' AND automated_calls.started_at IS NULL
           AND (automated_calls.kind IN ('WELCOME','BOOKING_CONFIRMATION','DUE_REMINDER')
             OR (automated_calls.kind='SIGN_IN_GREETING' AND automated_calls.outcome='Calling provider changed before dispatch'))`,
          [
            prefs.user_id,
            j.rental_id || null,
            j.listing_id || null,
            j.kind,
            j.key,
            j.payload,
            providerScript(j.kind, j.payload, settings()),
            providerName(settings()),
          ],
        );
        if (j.kind !== 'SIGN_IN_GREETING') {
          queued += (await persist(db)).rowCount;
          continue;
        }
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          // Match the event again under the same user lock used by sign-in. A
          // stale concurrent enqueuer must never cancel the newer greeting.
          // NO KEY UPDATE preserves serialization without blocking the user FK
          // KEY SHARE locks taken by concurrent preference/consent writes.
          const current = await client.query(
            `SELECT id FROM users WHERE id=$1 AND email_verified AND last_sign_in_id=$2
             AND last_signed_in_at >= $3::timestamptz - INTERVAL '24 hours'
             AND last_signed_in_at <= $3::timestamptz AND last_sign_in_phone=$4 FOR NO KEY UPDATE`,
            [prefs.user_id, j.payload.sign_in_id, clock(), prefs.phone_e164],
          );
          if (current.rowCount) {
            await client.query(
              `UPDATE automated_calls SET status='CANCELLED',outcome='Superseded by a newer sign-in'
               WHERE user_id=$1 AND kind='SIGN_IN_GREETING' AND status='QUEUED' AND dedupe_key<>$2`,
              [prefs.user_id, j.key],
            );
            queued += (await persist(client)).rowCount;
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
    }
    return { queued };
  };
  const eligible = async (job, prefs, client, { acceptedSignIn = false } = {}) => {
    if ((job.provider || providerName(settings())) === 'authkey' &&
        (!supportsPhone(prefs?.phone_e164) || job.kind === 'RECOMMENDATION')) return false;
    if (!prefs?.phone_verified_at || !E164.test(prefs.phone_e164 || '') || !prefs[consentFor(job.kind)])
      return false;
    if (job.kind === 'SIGN_IN_GREETING') {
      if (job.payload.phone_e164 !== prefs.phone_e164 ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(job.payload.sign_in_id || '')) return false;
      if (acceptedSignIn) {
        // A later login supersedes queued greetings, not a call already accepted
        // by Twilio. Keep checking its original durable intent and current
        // consent/phone ownership without requiring it to remain the latest.
        if ((job.provider || 'twilio') !== 'twilio' || !job.started_at ||
            !['SENT', 'RINGING', 'ANSWERED'].includes(job.status) ||
            !/^CA[\da-f]{32}$/i.test(job.provider_sid || '')) return false;
        const event = await client.query(
          `SELECT e.attempt_id FROM sign_in_call_events e JOIN users u ON u.id=e.user_id
           WHERE e.user_id=$1 AND u.email_verified AND e.attempt_id=$2 AND e.phone_e164=$4
           AND e.created_at >= $3::timestamptz - INTERVAL '24 hours' AND e.created_at <= $3::timestamptz`,
          [job.user_id, job.payload.sign_in_id, clock(), prefs.phone_e164],
        );
        return Boolean(event.rowCount);
      }
      const user = await client.query(
        `SELECT id FROM users WHERE id=$1 AND email_verified AND last_sign_in_id=$2
         AND last_signed_in_at >= $3::timestamptz - INTERVAL '24 hours'
         AND last_signed_in_at <= $3::timestamptz AND last_sign_in_phone=$4`,
        [job.user_id, job.payload.sign_in_id, clock(), prefs.phone_e164],
      );
      return Boolean(user.rowCount);
    }
    if (job.kind === 'WELCOME') {
      if (prefs.login_calls_enabled || job.payload.phone_e164 !== prefs.phone_e164) return false;
      const user = await client.query(
        "SELECT id FROM users WHERE id=$1 AND email_verified AND first_signed_in_at IS NOT NULL AND first_signed_in_at >= $2::timestamptz - INTERVAL '7 days'",
        [job.user_id, clock()],
      );
      return Boolean(user.rowCount);
    }
    if (job.kind === 'BOOKING_CONFIRMATION') {
      const r = await client.query(
        `SELECT 1 FROM rentals r JOIN listings l ON l.id=r.listing_id WHERE r.id=$1 AND r.borrower_id=$2
         AND r.payment_status='FULLY_PAID' AND r.status=ANY($3) AND l.demo_slug IS NULL AND r.end_date::text=$4
         AND r.booking_confirmed_at >= $5::timestamptz - INTERVAL '24 hours'`,
        [job.rental_id, job.user_id, bookingStatuses, job.payload.end_date, clock()],
      );
      return Boolean(r.rowCount);
    }
    if (job.kind === 'DUE_REMINDER') {
      const r = await client.query(
        `SELECT r.end_date::text end_date,r.status FROM rentals r JOIN listings l ON l.id=r.listing_id WHERE r.id=$1 AND r.borrower_id=$2 AND r.payment_status='FULLY_PAID' AND l.demo_slug IS NULL`,
        [job.rental_id, job.user_id],
      );
      return Boolean(
        r.rows[0] &&
        activeRentalStatuses.includes(r.rows[0].status) &&
        r.rows[0].end_date === job.payload.end_date &&
        reminderStage(r.rows[0].end_date, localTime(clock()).day) === job.payload.stage,
      );
    }
    if (clock().getTime() - new Date(job.created_at).getTime() > 7 * 86400000) return false;
    const l = await client.query(
      `SELECT 1 FROM listings l WHERE l.id=$1 AND l.is_active AND l.demo_slug IS NULL AND l.owner_id<>$2 AND l.rent_price=$3 AND NOT EXISTS(SELECT 1 FROM rentals r WHERE r.listing_id=l.id AND r.status NOT IN ('COMPLETED','CANCELLED','REJECTED','DEPOSIT_REFUNDED') AND r.start_date<=CURRENT_DATE AND r.end_date>=CURRENT_DATE)`,
      [job.listing_id, job.user_id, job.payload.rent_price],
    );
    return Boolean(l.rowCount);
  };
  const dispatchOne = async () => {
    const c = settings();
    if (!ready(c) || !c.enabled || !inCallWindow(clock())) return { skipped: true };
    const client = await db.connect();
    let job, prefs;
    try {
      await client.query('BEGIN');
      // Unknown transport outcomes are never retried automatically: that could ring twice.
      await client.query(
        "UPDATE automated_calls SET status='UNKNOWN',last_error='Provider acceptance needs reconciliation' WHERE status='DISPATCHING' AND started_at<NOW()-INTERVAL '5 minutes'",
      );
      job = (
        await client.query(
          "SELECT * FROM automated_calls WHERE status='QUEUED' AND scheduled_at<=NOW() ORDER BY CASE WHEN kind='DUE_REMINDER' THEN 0 WHEN kind='BOOKING_CONFIRMATION' THEN 1 ELSE 2 END,scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
      ).rows[0];
      if (!job) {
        await client.query('COMMIT');
        return { empty: true };
      }
      if ((job.provider || 'twilio') !== providerName(c)) {
        await client.query("UPDATE automated_calls SET status='CANCELLED',outcome='Calling provider changed before dispatch' WHERE id=$1", [job.id]);
        await client.query('COMMIT');
        return { cancelled: true };
      }
      prefs = (
        await client.query('SELECT * FROM call_preferences WHERE user_id=$1 FOR UPDATE', [job.user_id])
      ).rows[0];
      if (!(await eligible(job, prefs, client))) {
        await client.query(
          "UPDATE automated_calls SET status='CANCELLED',outcome='No longer eligible' WHERE id=$1",
          [job.id],
        );
        await client.query('COMMIT');
        return { cancelled: true };
      }
      const cap = await client.query(
        `SELECT 1 FROM automated_calls WHERE user_id=$1 AND id<>$2 AND started_at IS NOT NULL
         HAVING COUNT(*) FILTER (WHERE started_at>NOW()-INTERVAL '1 day')>=3
         OR COUNT(*) FILTER (WHERE started_at>NOW()-INTERVAL '30 minutes')>0
         OR COUNT(*) FILTER (WHERE $3='DUE_REMINDER' AND kind='DUE_REMINDER' AND started_at>NOW()-INTERVAL '1 day')>0
         OR COUNT(*) FILTER (WHERE $3='RECOMMENDATION' AND (started_at>NOW()-INTERVAL '1 day' OR (kind='RECOMMENDATION' AND started_at>NOW()-INTERVAL '7 days')))>0`,
        [job.user_id, job.id, job.kind],
      );
      if (cap.rowCount) {
        if (job.kind === 'SIGN_IN_GREETING') {
          // Greetings suppressed by repeat-call limits expire permanently for
          // this event, rather than building a backlog of delayed login calls.
          await client.query("UPDATE automated_calls SET status='CANCELLED',outcome='Sign-in greeting skipped by repeat-call limits' WHERE id=$1", [job.id]);
        } else {
          await client.query("UPDATE automated_calls SET scheduled_at=NOW()+INTERVAL '1 hour' WHERE id=$1", [job.id]);
        }
        await client.query('COMMIT');
        return { limited: true };
      }
      await client.query("UPDATE automated_calls SET status='DISPATCHING',started_at=NOW() WHERE id=$1", [
        job.id,
      ]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    // Recheck opt-out immediately before the paid provider operation.
    const latest = await preferences(job.user_id);
    if (!(await eligible(job, latest, db))) {
      await db.query(
        "UPDATE automated_calls SET status='CANCELLED',outcome='Preferences or rental changed' WHERE id=$1",
        [job.id],
      );
      return { cancelled: true };
    }
    try {
      const call = providerName(c) === 'authkey'
        ? await authkeyFactory(c).sendVoice({ to: latest.phone_e164, text: providerScript(job.kind, job.payload, c) })
        : await providerFactory(c).calls.create({
        to: latest.phone_e164,
        from: c.from,
        url: webhookUrl(c, job.id, 'voice'),
        ...(c.trial
          ? {}
          : {
              method: 'POST',
              statusCallbackMethod: 'POST',
              statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
              timeout: 20,
              timeLimit: 120,
            }),
        statusCallback: `${c.base}/api/calls/webhooks/${job.id}/status`,
      });
      await db.query(
        "UPDATE automated_calls SET provider_sid=COALESCE(provider_sid,$2),status=CASE WHEN status='DISPATCHING' THEN 'SENT' ELSE status END WHERE id=$1",
        [job.id, providerName(c) === 'authkey' ? call.id : call.sid],
      );
      return { sent: true };
    } catch (e) {
      const definite = providerName(c) === 'authkey' ? e.definite === true : Number(e.status) >= 400 && Number(e.status) < 500;
      await db.query('UPDATE automated_calls SET status=$2,last_error=$3 WHERE id=$1', [
        job.id,
        definite ? 'FAILED' : 'UNKNOWN',
        definite
          ? `Provider rejected the call (HTTP ${Number(e.status)}, code ${Number(e.code) || 0})`
          : 'Provider acceptance uncertain; check provider logs before retrying',
      ]);
      return { failed: true };
    }
  };
  const voice = async (id, body, kind) => {
    const job = (await db.query('SELECT * FROM automated_calls WHERE id=$1', [id])).rows[0];
    const response = new twilio.twiml.VoiceResponse();
    if (
      !job || (job.provider || 'twilio') !== 'twilio' ||
      !['DISPATCHING', 'SENT', 'RINGING', 'ANSWERED'].includes(job.status) ||
      (job.provider_sid && job.provider_sid !== body.CallSid)
    ) {
      response.hangup();
      return response.toString();
    }
    const signInGreeting = job.kind === 'SIGN_IN_GREETING';
    const acceptedSignIn = signInGreeting && Boolean(job.started_at) &&
      ['SENT', 'RINGING', 'ANSWERED'].includes(job.status) && /^CA[\da-f]{32}$/i.test(job.provider_sid || '');
    // A normally signed Twilio callback can arrive before calls.create returns
    // its SID. That DISPATCHING path still requires the latest sign-in; only
    // recorded provider acceptance permits checking the original event instead.
    const pendingSignIn = signInGreeting && job.status === 'DISPATCHING' && Boolean(job.started_at) &&
      /^CA[\da-f]{32}$/i.test(body.CallSid || '');
    if (signInGreeting && !acceptedSignIn && !pendingSignIn) {
      response.hangup();
      return response.toString();
    }
    const prefs = await preferences(job.user_id);
    if (!(await eligible(job, prefs, db, { acceptedSignIn }))) {
      saySoft(response, 'This reminder is no longer needed. Goodbye.');
      response.hangup();
      return response.toString();
    }
    if (body.Digits === '9' || /\b(stop|unsubscribe)\b/i.test(body.SpeechResult || '')) {
      await updatePreferences(job.user_id, {
        phone_e164: prefs.phone_e164,
        reminders_enabled: false,
        recommendations_enabled: false,
        welcome_enabled: false,
        login_calls_enabled: false,
        booking_enabled: false,
      });
      await db.query("UPDATE automated_calls SET outcome='Opted out' WHERE id=$1", [id]);
      saySoft(response, 'Automated calls have been switched off. Goodbye.');
      response.hangup();
      return response.toString();
    }
    if (kind === 'voice') {
      // The generic welcome contains no account details and can be heard immediately.
      if (job.kind === 'WELCOME' || job.kind === 'SIGN_IN_GREETING') {
        saySoft(
          response.gather({
            numDigits: 1,
            timeout: 5,
            action: webhookUrl(settings(), id, 'answer'),
            method: 'POST',
          }),
          job.script + ' Press 9 to stop automated calls.',
        );
        response.hangup();
        return response.toString();
      }
      saySoft(
        response.gather({
          numDigits: 1,
          timeout: 7,
          action: webhookUrl(settings(), id, 'answer'),
          method: 'POST',
        }),
        job.kind === 'BOOKING_CONFIRMATION'
          ? 'Hello! This is the automated CampusMesh assistant. Thank you for placing an order with us! Press 1 to hear your booking details. Press 9 to stop automated calls.'
          : 'Hello. This is the automated CampusMesh assistant. Press 1 to hear your update. Press 9 to stop automated calls.',
      );
      response.hangup();
      return response.toString();
    }
    const turns = (
      await db.query(
        "UPDATE automated_calls SET payload=jsonb_set(payload,'{voiceTurns}',to_jsonb(COALESCE((payload->>'voiceTurns')::int,0)+1)) WHERE id=$1 RETURNING (payload->>'voiceTurns')::int turns",
        [id],
      )
    ).rows[0].turns;
    if (turns > 3) {
      saySoft(response, 'Please open Support in CampusMesh for more help. Goodbye.');
      response.hangup();
      return response.toString();
    }
    let speech = job.script;
    if (body.SpeechResult) {
      const rentals = ['DUE_REMINDER', 'BOOKING_CONFIRMATION'].includes(job.kind)
        ? (
            await db.query(
              'SELECT l.title,r.end_date::text due_date,r.status,r.payment_status FROM rentals r JOIN listings l ON l.id=r.listing_id WHERE r.id=$1 AND r.borrower_id=$2',
              [job.rental_id, job.user_id],
            )
          ).rows
        : [];
      const result = await supportAnswer(job.user_id, String(body.SpeechResult).slice(0, 1500), {
        save: false,
        contextOverride: { rentals, wishes: [] },
      });
      speech = result.answer;
    } else if (body.Digits !== '1') {
      saySoft(response, 'Please open CampusMesh to review your update. Goodbye.');
      response.hangup();
      return response.toString();
    }
    saySoft(response, speech.slice(0, 1600));
    saySoft(
      response.gather({
        input: 'speech dtmf',
        numDigits: 1,
        language: 'en-IN',
        speechTimeout: 'auto',
        timeout: 5,
        action: webhookUrl(settings(), id, 'answer'),
        method: 'POST',
      }),
      'You can ask a short question about CampusMesh, or press 9 to stop automated calls.',
    );
    response.hangup();
    return response.toString();
  };
  return {
    status,
    accountStatus,
    bookingStatus,
    preferences,
    updatePreferences,
    verifyPhone,
    preview,
    enqueue,
    dispatchOne,
    voice,
    eligible,
  };
}
module.exports = {
  createCallService,
  config,
  ready,
  localTime,
  inCallWindow,
  reminderStage,
  scriptFor,
  providerScript,
  E164,
};
