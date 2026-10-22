const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('Authkey ownership verification and automatic calls stay isolated, consented and deduplicated', {
  skip: process.env.AUTHKEY_E2E !== '1',
  timeout: 180000,
}, async (t) => {
  require('dotenv').config({ quiet: true });
  const pool = require('../src/config/database');
  const { createCallService, localTime } = require('../src/modules/calls/call.service');
  const users = [], listings = [], rentals = [];
  const sends = [], checks = [], voiceCalls = [], references = new Set();
  let now = new Date(`${localTime().day}T06:00:00Z`);
  let sendHook, checkHook, voiceHook;
  let isolated = false;
  const settings = () => ({
    provider: 'authkey', live: true, enabled: true,
    authkeyApiKey: 'fixture-only', authkeyVoiceApproved: true,
    authkeyOtpTemplateId: '1001',
  });
  const fakeProvider = {
    sendVerification: async (phone) => {
      const id = `fixture-otp-${randomUUID()}`;
      references.add(id);
      sends.push({ phone, id });
      if (sendHook) await sendHook(phone);
      return { id };
    },
    checkVerification: async (id, code) => {
      assert(references.has(id), 'Only a server-held provider challenge can be checked');
      checks.push({ id });
      if (checkHook) await checkHook(id);
      return code === '654321';
    },
    sendVoice: async (request) => {
      const id = `fixture-call-${randomUUID()}`;
      voiceCalls.push({ ...request, id });
      if (voiceHook) await voiceHook(request);
      return { id };
    },
  };
  const service = createCallService({
    db: pool, settings, clock: () => new Date(now),
    authkeyFactory: () => fakeProvider,
    providerFactory: () => { assert.fail('Authkey must never fall through to Twilio'); },
    recommend: async () => { assert.fail('Transactional Authkey calls must not request promotions'); },
  });
  const preferences = (phone, extra = {}) => ({
    phone_e164: phone, welcome_enabled: true, booking_enabled: true,
    reminders_enabled: true, recommendations_enabled: false, ...extra,
  });
  const createUser = async (phone, extra = {}) => {
    const id = randomUUID();
    users.push(id);
    await pool.query(
      'INSERT INTO users(id,name,email,email_verified,first_signed_in_at) VALUES($1,$2,$3,TRUE,$4)',
      [id, 'QA Authkey', `qa-authkey-${id}@dbit.co.in`, now],
    );
    await service.updatePreferences(id, preferences(phone, extra));
    return id;
  };
  const challengeCount = async (id) => (await pool.query(
    'SELECT COUNT(*)::int AS count FROM call_phone_verifications WHERE user_id=$1', [id],
  )).rows[0].count;
  const verifyUser = async (id) => {
    await service.verifyPhone(id);
    assert.deepEqual(await service.verifyPhone(id, '654321'), { verified: true });
  };
  const disableUser = async (id, phone) => service.updatePreferences(id, preferences(phone, {
    welcome_enabled: false, booking_enabled: false, reminders_enabled: false,
  }));
  const createRental = async (borrowerId, ownerId, { status, days, confirmed = false }) => {
    const listing = randomUUID(), rental = randomUUID();
    listings.push(listing);
    rentals.push(rental);
    await pool.query(
      "INSERT INTO listings(id,owner_id,title,description,category,rent_price) VALUES($1,$2,'Private delivery fixture','fixture','Electronics',25)",
      [listing, ownerId],
    );
    await pool.query(
      `INSERT INTO rentals(id,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,
        rental_fee,booking_amount,status,payment_status,booking_confirmed_at,delivery_requested)
       VALUES($1,$2,$3,$4,$5,$5::date+$6::int,$6::int+1,125,125,$7,'FULLY_PAID',$8,TRUE)`,
      [rental, listing, borrowerId, ownerId, localTime(now).day, days, status, confirmed ? now : null],
    );
    return rental;
  };
  const callsFor = async (id) => (await pool.query(
    'SELECT * FROM automated_calls WHERE user_id=$1 ORDER BY created_at', [id],
  )).rows;
  try {
    const namespace = (await pool.query(
      'SELECT current_schema() AS schema,current_schemas(false) AS schemas',
    )).rows[0];
    assert(namespace.schema && namespace.schema !== 'public',
      'AUTHKEY_E2E requires an isolated schema; refusing the default database schema');
    assert(!namespace.schemas.includes('public'), 'The fixture search_path must not fall back to public');
    const tables = (await pool.query(
      `SELECT n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.oid=ANY(ARRAY['users'::regclass,'call_preferences'::regclass,
         'call_phone_verifications'::regclass,'phone_verification_attempts'::regclass,
         'automated_calls'::regclass,'rentals'::regclass,'listings'::regclass])`,
    )).rows;
    assert.equal(tables.length, 7);
    assert(tables.every((row) => row.schema === namespace.schema), 'All fixture tables must be isolated');
    isolated = true;

    let welcomeUser;
    const welcomePhone = '+919000000001';
    await t.test('phone ownership gates one welcome despite concurrent scheduler runs', async () => {
      welcomeUser = await createUser(welcomePhone);
      assert.equal((await service.enqueue()).queued, 0);
      assert.equal(voiceCalls.length, 0, 'A saved number and first sign-in alone must not dial');
      assert.deepEqual(await service.verifyPhone(welcomeUser), {
        sent: true, channel: 'voice', retryAfter: 60, expiresIn: 300,
      }, 'The browser receives timing, never an OTP or provider reference');
      assert.equal(sends.length, 1);
      await assert.rejects(service.verifyPhone(welcomeUser, '111111'),
        (error) => error.status === 400 && /incorrect|expired/i.test(error.message));
      assert.equal((await service.preferences(welcomeUser)).phone_verified_at, null);
      assert.deepEqual(await service.verifyPhone(welcomeUser, '654321'), { verified: true });
      assert((await service.preferences(welcomeUser)).phone_verified_at);
      assert.equal(await challengeCount(welcomeUser), 0, 'Consumed challenges cannot be replayed');
      const queued = await Promise.all([service.enqueue(), service.enqueue()]);
      assert.equal(queued.reduce((total, result) => total + result.queued, 0), 1);
      await Promise.all([service.dispatchOne(), service.dispatchOne()]);
      assert.equal(voiceCalls.length, 1);
      assert.equal(voiceCalls[0].to, welcomePhone);
      assert.match(voiceCalls[0].text, /Welcome to CampusMesh/i);
      assert.doesNotMatch(voiceCalls[0].text, /press\s+[19]|<Gather|<Say/i);
      const jobs = (await pool.query('SELECT * FROM automated_calls WHERE user_id=$1', [welcomeUser])).rows;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].kind, 'WELCOME');
      assert.equal(jobs[0].provider, 'authkey');
      assert.equal(jobs[0].provider_sid, voiceCalls[0].id);
      assert.equal(jobs[0].status, 'SENT');
      assert.equal((await service.enqueue()).queued, 0, 'Later scheduler runs do not repeat the welcome');
      await service.dispatchOne();
      assert.equal(voiceCalls.length, 1);
      await assert.rejects(service.updatePreferences(welcomeUser,
        preferences(welcomePhone, { recommendations_enabled: true })),
      (error) => error.status === 400);
    });

    await t.test('due reminders are cancelled on opt-out before any provider operation', async () => {
      assert(welcomeUser, 'Welcome fixture must exist');
      const owner = await createUser('+919000000002', {
        welcome_enabled: false, booking_enabled: false, reminders_enabled: false,
      });
      const listing = randomUUID(), rental = randomUUID();
      listings.push(listing);
      rentals.push(rental);
      await pool.query(
        "INSERT INTO listings(id,owner_id,title,description,category,rent_price) VALUES($1,$2,'Private fixture item','fixture','Electronics',25)",
        [listing, owner],
      );
      await pool.query(
        `INSERT INTO rentals(id,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,
          rental_fee,booking_amount,status,payment_status)
         VALUES($1,$2,$3,$4,$5,$5::date+4,5,125,125,'RENTAL_ACTIVE','FULLY_PAID')`,
        [rental, listing, welcomeUser, owner, localTime(now).day],
      );
      assert.equal((await service.enqueue()).queued, 1);
      let job = (await pool.query(
        "SELECT * FROM automated_calls WHERE rental_id=$1 AND kind='DUE_REMINDER'", [rental],
      )).rows[0];
      assert.equal(job.provider, 'authkey');
      assert.match(job.script, /due in 4 days/i);
      assert.doesNotMatch(job.script, /Private fixture item|press\s+[19]/i);
      await service.updatePreferences(welcomeUser, preferences(welcomePhone, { reminders_enabled: false }));
      job = (await pool.query('SELECT status FROM automated_calls WHERE id=$1', [job.id])).rows[0];
      assert.equal(job.status, 'CANCELLED');
      const before = voiceCalls.length;
      await service.dispatchOne();
      assert.equal(voiceCalls.length, before);
    });

    await t.test('changing the saved number clears pending and completed verification', async () => {
      const id = await createUser('+919000000003');
      await service.verifyPhone(id);
      assert.equal(await challengeCount(id), 1);
      await service.updatePreferences(id, preferences('+919000000004'));
      assert.equal(await challengeCount(id), 0);
      await assert.rejects(service.verifyPhone(id, '654321'), (error) => error.status === 400);
      assert.equal((await service.preferences(id)).phone_verified_at, null);

      await service.updatePreferences(welcomeUser, preferences('+919000000005'));
      assert.equal((await service.preferences(welcomeUser)).phone_verified_at, null);
      assert.equal((await service.enqueue()).queued, 0, 'A replacement number must prove ownership again');
    });

    await t.test('concurrent accounts sharing one number cannot bypass send cooldown or hourly cap', async () => {
      const phone = '+919000000006';
      const ids = [await createUser(phone), await createUser(phone)];
      const before = sends.length;
      for (let round = 0; round < 3; round++) {
        const results = await Promise.allSettled(ids.map((id) => service.verifyPhone(id)));
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert(results.filter((result) => result.status === 'rejected').every(
          (result) => result.reason.status === 429,
        ));
        now = new Date(now.getTime() + 61000);
      }
      const capped = await Promise.allSettled(ids.map((id) => service.verifyPhone(id)));
      assert(capped.every((result) => result.status === 'rejected' && result.reason.status === 429));
      assert.equal(sends.length - before, 3, 'All accounts share the same destination call cap');
    });

    await t.test('expired verification never marks the number verified or contacts the provider', async () => {
      const id = await createUser('+919000000007');
      await service.verifyPhone(id);
      const before = checks.length;
      now = new Date(now.getTime() + 301000);
      await assert.rejects(service.verifyPhone(id, '654321'),
        (error) => error.status === 400 && /expired/i.test(error.message));
      assert.equal(checks.length, before);
      assert.equal((await service.preferences(id)).phone_verified_at, null);
    });

    await t.test('a phone change while the provider checks a code cannot verify the replacement', async () => {
      const id = await createUser('+919000000008');
      await service.verifyPhone(id);
      const entered = deferred(), release = deferred();
      checkHook = async () => { entered.resolve(); await release.promise; };
      const attempt = service.verifyPhone(id, '654321');
      const rejected = assert.rejects(attempt, (error) => error.status === 409);
      try {
        await entered.promise;
        await service.updatePreferences(id, preferences('+919000000009'));
      } finally {
        checkHook = undefined;
        release.resolve();
      }
      await rejected;
      const prefs = await service.preferences(id);
      assert.equal(prefs.phone_e164, '+919000000009');
      assert.equal(prefs.phone_verified_at, null);
      assert.equal(await challengeCount(id), 0);
    });

    await t.test('a phone change during verification-call dispatch cannot attach the old challenge', async () => {
      const id = await createUser('+919000000010');
      const entered = deferred(), release = deferred();
      sendHook = async () => { entered.resolve(); await release.promise; };
      const attempt = service.verifyPhone(id);
      const rejected = assert.rejects(attempt, (error) => error.status === 409);
      try {
        await entered.promise;
        await service.updatePreferences(id, preferences('+919000000011'));
      } finally {
        sendHook = undefined;
        release.resolve();
      }
      await rejected;
      assert.equal((await service.preferences(id)).phone_verified_at, null);
      assert.equal(await challengeCount(id), 0);
    });

    await t.test('a confirmed real booking dispatches one Authkey call with private details kept in the app', async () => {
      const phone = '+919000000012';
      const borrower = await createUser(phone, { welcome_enabled: false, reminders_enabled: false });
      const owner = await createUser('+919000000013', {
        welcome_enabled: false, booking_enabled: false, reminders_enabled: false,
      });
      await verifyUser(borrower);
      const rental = await createRental(borrower, owner, { status: 'QR_GENERATED', days: 6, confirmed: true });
      const before = voiceCalls.length;
      assert.equal((await service.enqueue()).queued, 1);
      assert.deepEqual(await service.dispatchOne(), { sent: true });
      assert.equal(voiceCalls.length, before + 1);
      assert.equal(voiceCalls[before].to, phone);
      assert.match(voiceCalls[before].text, /booking is confirmed/i);
      assert.match(voiceCalls[before].text, /delivery tracking/i);
      assert.doesNotMatch(voiceCalls[before].text, /Private delivery fixture|press\s+[19]|<Gather|<Say/i);
      const jobs = await callsFor(borrower);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].rental_id, rental);
      assert.equal(jobs[0].kind, 'BOOKING_CONFIRMATION');
      assert.equal(jobs[0].provider, 'authkey');
      assert.equal(jobs[0].status, 'SENT', 'Provider acceptance must not be shown as answered or completed');
      assert.equal(jobs[0].provider_sid, voiceCalls[before].id);
      assert.equal((await service.enqueue()).queued, 0);
      assert.deepEqual(await service.dispatchOne(), { empty: true });
      assert.equal(voiceCalls.length, before + 1, 'Booking confirmation must not repeat');
      await disableUser(borrower, phone);
    });

    await t.test('an active real rental dispatches its four-day reminder once', async () => {
      const phone = '+919000000014';
      const borrower = await createUser(phone, { welcome_enabled: false, booking_enabled: false });
      const owner = await createUser('+919000000015', {
        welcome_enabled: false, booking_enabled: false, reminders_enabled: false,
      });
      await verifyUser(borrower);
      const rental = await createRental(borrower, owner, { status: 'RENTAL_ACTIVE', days: 4 });
      const before = voiceCalls.length;
      assert.equal((await service.enqueue()).queued, 1);
      assert.deepEqual(await service.dispatchOne(), { sent: true });
      assert.equal(voiceCalls.length, before + 1);
      assert.equal(voiceCalls[before].to, phone);
      assert.match(voiceCalls[before].text, /due in 4 days/i);
      assert.match(voiceCalls[before].text, /arrange the return or request an extension/i);
      assert.doesNotMatch(voiceCalls[before].text, /Private delivery fixture|press\s+[19]|<Gather|<Say/i);
      const jobs = await callsFor(borrower);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].rental_id, rental);
      assert.equal(jobs[0].kind, 'DUE_REMINDER');
      assert.equal(jobs[0].provider, 'authkey');
      assert.equal(jobs[0].status, 'SENT');
      assert.equal(jobs[0].provider_sid, voiceCalls[before].id);
      assert.equal((await service.enqueue()).queued, 0);
      assert.deepEqual(await service.dispatchOne(), { empty: true });
      assert.equal(voiceCalls.length, before + 1, 'The same reminder stage must not repeat');
      await disableUser(borrower, phone);
    });

    await t.test('an unattempted job from a previous provider is cancelled then safely requeued for Authkey', async () => {
      const phone = '+919000000016';
      const id = await createUser(phone, { booking_enabled: false, reminders_enabled: false });
      await verifyUser(id);
      assert.equal((await service.enqueue()).queued, 1);
      const original = (await callsFor(id))[0];
      assert.equal(original.status, 'QUEUED');
      // Model a job persisted before CALLS_PROVIDER changed, without contacting Twilio.
      await pool.query("UPDATE automated_calls SET provider='twilio' WHERE id=$1", [original.id]);
      const before = voiceCalls.length;
      assert.deepEqual(await service.dispatchOne(), { cancelled: true });
      const cancelled = (await callsFor(id))[0];
      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.provider, 'twilio');
      assert.equal(cancelled.started_at, null);
      assert.equal(cancelled.provider_sid, null);
      assert.equal(voiceCalls.length, before, 'No provider may receive a mismatched queued job');
      assert.equal((await service.enqueue()).queued, 1);
      const requeued = await callsFor(id);
      assert.equal(requeued.length, 1, 'Switching providers must keep the same deduplication record');
      assert.equal(requeued[0].id, original.id);
      assert.equal(requeued[0].provider, 'authkey');
      assert.equal(requeued[0].status, 'QUEUED');
      assert.equal(requeued[0].started_at, null);
      assert.deepEqual(await service.dispatchOne(), { sent: true });
      assert.equal(voiceCalls.length, before + 1);
      assert.equal(voiceCalls[before].to, phone);
      assert.equal((await service.enqueue()).queued, 0);
      await disableUser(id, phone);
    });

    await t.test('definite rejection and uncertain acceptance retain separate statuses and never auto-redial', async () => {
      for (const [index, definite, expectedStatus] of [[0, true, 'FAILED'], [1, false, 'UNKNOWN']]) {
        const phone = `+9190000000${17 + index}`;
        const id = await createUser(phone, { booking_enabled: false, reminders_enabled: false });
        await verifyUser(id);
        assert.equal((await service.enqueue()).queued, 1);
        const before = voiceCalls.length;
        voiceHook = async () => {
          throw Object.assign(new Error('Fixture provider outcome'), {
            definite, status: 503,
            code: definite ? 'AUTHKEY_REJECTED' : 'AUTHKEY_OUTCOME_UNKNOWN',
          });
        };
        try {
          assert.deepEqual(await service.dispatchOne(), { failed: true });
        } finally { voiceHook = undefined; }
        const jobs = await callsFor(id);
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].status, expectedStatus);
        assert.equal(jobs[0].provider, 'authkey');
        assert(jobs[0].started_at, 'An attempted submission must keep its dispatch history');
        assert.equal(jobs[0].provider_sid, null);
        assert.equal(voiceCalls.length, before + 1);
        if (definite) assert.match(jobs[0].last_error, /rejected/i);
        else assert.match(jobs[0].last_error, /uncertain|reconciliation/i);
        for (let repeat = 0; repeat < 2; repeat++) {
          assert.equal((await service.enqueue()).queued, 0);
          assert.deepEqual(await service.dispatchOne(), { empty: true });
        }
        assert.equal(voiceCalls.length, before + 1, 'Neither failed nor uncertain submissions may silently redial');
        assert.equal((await callsFor(id))[0].status, expectedStatus);
        await disableUser(id, phone);
      }
    });
  } finally {
    try {
      if (isolated) {
        await pool.query('DELETE FROM rentals WHERE id=ANY($1::uuid[])', [rentals]);
        await pool.query('DELETE FROM listings WHERE id=ANY($1::uuid[])', [listings]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
      }
    } finally {
      await pool.end();
    }
  }
});
