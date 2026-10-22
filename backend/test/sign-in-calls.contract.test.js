const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('successful sign-ins create consented, verified and deduplicated greeting calls', {
  skip: process.env.SIGN_IN_CALLS_E2E !== '1',
  timeout: 600000,
}, async (t) => {
  require('dotenv').config({ quiet: true });
  const pool = require('../src/config/database');
  const bcrypt = require('bcrypt');
  const { createCallService, inCallWindow, localTime } = require('../src/modules/calls/call.service');
  const users = [], emails = [], calls = [];
  const password = 'FixtureSignInCalls123!';
  const hash = await bcrypt.hash(password, 4);
  let now = new Date();
  if (!inCallWindow(now)) {
    const opening = new Date(`${localTime(now).day}T03:30:00Z`);
    now = now < opening ? opening : new Date(opening.getTime() + 86400000);
  }
  const settings = () => ({
    provider: 'authkey', live: true, enabled: true,
    authkeyApiKey: 'fixture-only-key', authkeyVoiceApproved: true,
    authkeyOtpTemplateId: '1001',
  });
  const fakeProvider = {
    sendVoice: async (request) => {
      const id = `fixture-call-${randomUUID()}`;
      calls.push({ ...request, id });
      return { id };
    },
    sendVerification: async () => { assert.fail('This fixture never contacts a phone-verification provider'); },
    checkVerification: async () => { assert.fail('This fixture never contacts a phone-verification provider'); },
  };
  const serviceOptions = {
    db: pool, settings, clock: () => new Date(Math.max(now.getTime(), Date.now())),
    authkeyFactory: () => fakeProvider,
    providerFactory: () => { assert.fail('Authkey sign-in calls must not invoke Twilio'); },
    recommend: async () => { assert.fail('Sign-in greetings must not request promotions'); },
  };
  const service = createCallService(serviceOptions);
  const prefsBody = (phone, extra = {}) => ({
    phone_e164: phone, login_calls_enabled: true, welcome_enabled: false,
    booking_enabled: false, reminders_enabled: false, recommendations_enabled: false,
    ...extra,
  });
  const eventsFor = async (id) => (await pool.query(
    'SELECT * FROM sign_in_call_events WHERE user_id=$1 ORDER BY created_at,attempt_id', [id],
  )).rows;
  const jobsFor = async (id) => (await pool.query(
    'SELECT * FROM automated_calls WHERE user_id=$1 ORDER BY created_at,id', [id],
  )).rows;
  const latestFor = async (id) => (await pool.query(
    'SELECT first_signed_in_at,last_signed_in_at,last_sign_in_id,last_sign_in_phone FROM users WHERE id=$1', [id],
  )).rows[0];
  const verifyFixturePhone = (id) => pool.query(
    'UPDATE call_preferences SET phone_verified_at=NOW() WHERE user_id=$1 AND phone_e164 IS NOT NULL', [id],
  );
  const ageAttempts = (id, interval = '31 minutes') => pool.query(
    'UPDATE automated_calls SET started_at=NOW()-$2::interval WHERE user_id=$1 AND started_at IS NOT NULL', [id, interval],
  );
  const disable = async (user) => service.updatePreferences(user.id, prefsBody(user.phone, {
    login_calls_enabled: false, welcome_enabled: false,
  }));
  let phoneSequence = 100;
  const createUser = async ({ emailVerified = true, phoneVerified = true, loginEnabled = true, welcomeEnabled = false } = {}) => {
    const id = randomUUID();
    const phone = `+91900000${String(phoneSequence++).padStart(4, '0')}`;
    const email = `qa-signin-${id}@dbit.co.in`;
    users.push(id);
    emails.push(email);
    await pool.query(
      'INSERT INTO users(id,name,email,password,email_verified,phone_number) VALUES($1,$2,$3,$4,$5,$6)',
      [id, 'QA Sign-in', email, hash, emailVerified, phone],
    );
    await service.updatePreferences(id, prefsBody(phone, {
      login_calls_enabled: loginEnabled, welcome_enabled: welcomeEnabled,
    }));
    if (phoneVerified) await verifyFixturePhone(id);
    return { id, phone, email, password };
  };
  const withUser = async (options, run) => {
    const user = await createUser(options);
    try { await run(user); } finally { await disable(user); }
  };
  const workerPath = require.resolve('../src/modules/calls/call.worker');
  const mailPath = require.resolve('../src/shared/send-email');
  const originalWorker = require.cache[workerPath], originalMail = require.cache[mailPath];
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalServeFrontend = process.env.SERVE_FRONTEND;
  const codes = new Map();
  let wakeRequests = 0, server, isolated = false;
  try {
    // This test writes multiple accounts and jobs. Never use the application's
    // public schema or any search_path which can silently fall back to it.
    const namespace = (await pool.query(
      'SELECT current_schema() AS schema,current_schemas(false) AS schemas',
    )).rows[0];
    assert(namespace.schema && namespace.schema !== 'public',
      'SIGN_IN_CALLS_E2E requires an isolated schema; refusing the public database');
    assert(!namespace.schemas.includes('public'), 'Fixture search_path must not include public');
    const tables = (await pool.query(
      `SELECT n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.oid=ANY(ARRAY['users'::regclass,'call_preferences'::regclass,'call_consent_events'::regclass,
         'sign_in_call_events'::regclass,'automated_calls'::regclass,'auth_codes'::regclass])`,
    )).rows;
    assert.equal(tables.length, 6);
    assert(tables.every((row) => row.schema === namespace.schema), 'Every fixture table must be isolated');
    isolated = true;

    process.env.JWT_SECRET = 'fixture-jwt-secret-never-used-outside-this-isolated-test';
    process.env.SERVE_FRONTEND = 'false';
    require.cache[workerPath] = {
      id: workerPath, filename: workerPath, loaded: true,
      exports: {
        requestTick: () => { wakeRequests += 1; return true; },
        tick: async () => { assert.fail('No global call worker may execute in this fixture'); },
        start: () => { assert.fail('No global call worker may start in this fixture'); },
      },
    };
    require.cache[mailPath] = {
      id: mailPath, filename: mailPath, loaded: true,
      exports: async (email, _subject, code) => { codes.set(email, code); },
    };
    // Mocks must be installed before auth.controller captures requestTick/sendCode.
    const app = require('../src/app');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const request = async (path, { body, token, method = body ? 'POST' : 'GET' } = {}) => {
      const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    };
    const login = (user, attemptId = randomUUID(), extra = {}) => request('/login', {
      body: { email: user.email, password: user.password, login_attempt_id: attemptId, ...extra },
    });
    const expectLogin = async (user, attemptId = randomUUID()) => {
      const result = await login(user, attemptId);
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal(typeof result.data.token, 'string');
      return { ...result, attemptId };
    };
    const expectOneDispatch = async (user) => {
      const before = calls.length;
      assert.equal((await service.enqueue()).queued, 1);
      assert.deepEqual(await service.dispatchOne(), { sent: true });
      assert.equal(calls.length, before + 1);
      assert.equal(calls[before].to, user.phone);
      return calls[before];
    };

    await t.test('signup records explicit login-call consent and first sign-in produces no double welcome', async () => {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const signup = {
        name: 'QA Sign-in Signup', username: `qasi_${suffix}`,
        email: `qa-signup-${suffix}@dbit.co.in`, password,
        phone_number: '+919000000090', welcome_enabled: true,
        login_calls_enabled: true, rental_calls_enabled: false,
      };
      emails.push(signup.email);
      assert.equal((await request('/signup', { body: { ...signup, login_calls_enabled: 'true' } })).status, 400);
      const result = await request('/signup', { body: signup });
      assert.equal(result.status, 201, JSON.stringify(result.data));
      const user = (await pool.query('SELECT id,email FROM users WHERE email=$1', [signup.email])).rows[0];
      users.push(user.id);
      Object.assign(user, { phone: signup.phone_number, password });
      try {
        const prefs = await service.preferences(user.id);
        assert.equal(prefs.login_calls_enabled, true);
        assert.equal(prefs.welcome_enabled, true);
        assert.equal(prefs.phone_verified_at, null);
        const consent = (await pool.query(
          'SELECT login_calls_enabled FROM call_consent_events WHERE user_id=$1', [user.id],
        )).rows;
        assert.equal(consent.length, 1);
        assert.equal(consent[0].login_calls_enabled, true);
        assert.equal((await eventsFor(user.id)).length, 0);
        assert.equal((await jobsFor(user.id)).length, 0);
        assert.equal((await request('/verify-email', { body: { email: user.email, otp: codes.get(user.email) } })).status, 200);
        await verifyFixturePhone(user.id);
        const signedIn = await expectLogin(user);
        assert.equal((await eventsFor(user.id)).length, 1);
        await expectOneDispatch(user);
        const jobs = await jobsFor(user.id);
        assert.equal(jobs.length, 1, 'First sign-in must not send both legacy WELCOME and a sign-in greeting');
        assert.equal(jobs[0].kind, 'SIGN_IN_GREETING');
        assert.equal(jobs[0].status, 'SENT');
        assert.equal(jobs[0].provider, 'authkey');
        assert.doesNotMatch(jobs[0].script, /press\s+[19]|<Gather|<Say/i);
        const beforeWake = wakeRequests;
        const beforeLatest = await latestFor(user.id);
        for (let repeat = 0; repeat < 2; repeat++) {
          assert.equal((await request('/me', { token: signedIn.data.token })).status, 200);
        }
        assert.equal(wakeRequests, beforeWake, 'Session/profile refreshes must not wake call dispatch');
        assert.deepEqual(await latestFor(user.id), beforeLatest);
        assert.equal((await eventsFor(user.id)).length, 1, '/me must not create a sign-in event');
      } finally { await disable(user); }
    });

    await t.test('invalid credentials, unverified email and invalid attempt IDs never create events', async () => {
      await withUser({ emailVerified: false }, async (user) => {
        const beforeWake = wakeRequests;
        assert.equal((await login(user)).status, 403);
        assert.equal((await login(user, randomUUID(), { password: 'not-the-password' })).status, 400);
        assert.equal((await login(user, randomUUID(), { email: `absent-${randomUUID()}@dbit.co.in` })).status, 400);
        assert.equal((await login(user, null)).status, 400);
        assert.equal((await login(user, 'not-a-uuid')).status, 400);
        assert.equal((await eventsFor(user.id)).length, 0);
        assert.equal((await latestFor(user.id)).first_signed_in_at, null);
        assert.equal(wakeRequests, beforeWake);
        assert.equal((await service.enqueue()).queued, 0);
      });
    });

    await t.test('replaying an older attempt cannot replace the latest intent or refresh the old timestamp', async () => {
      await withUser({}, async (user) => {
        const attemptA = randomUUID(), attemptB = randomUUID();
        await expectLogin(user, attemptA);
        assert.equal((await service.enqueue()).queued, 1);
        const initialEvents = await eventsFor(user.id);
        await expectLogin(user, attemptB);
        const afterB = await latestFor(user.id);
        assert.equal(afterB.last_sign_in_id, attemptB);
        await expectLogin(user, attemptA);
        assert.deepEqual(await latestFor(user.id), afterB);
        const events = await eventsFor(user.id);
        assert.equal(events.length, 2);
        assert.equal(events.find((event) => event.attempt_id === attemptA).created_at.getTime(), initialEvents[0].created_at.getTime());
        assert.equal((await service.enqueue()).queued, 1);
        const jobs = await jobsFor(user.id);
        assert.equal(jobs.length, 2);
        assert.equal(jobs.filter((job) => job.status === 'QUEUED').length, 1);
        assert.equal(jobs.filter((job) => job.status === 'CANCELLED' && !job.started_at).length, 1,
          'The superseded intent must not remain a delayed greeting');
        const before = calls.length;
        assert.deepEqual(await service.dispatchOne(), { sent: true });
        assert.equal(calls.length, before + 1);
      });
    });

    await t.test('concurrent retries of one successful login produce one event and one greeting', async () => {
      await withUser({}, async (user) => {
        const attemptId = randomUUID();
        const logins = await Promise.all([login(user, attemptId), login(user, attemptId), login(user, attemptId)]);
        assert(logins.every((result) => result.status === 200));
        assert.equal((await eventsFor(user.id)).length, 1);
        assert.equal((await latestFor(user.id)).last_sign_in_id, attemptId);
        const queued = await Promise.all([service.enqueue(), service.enqueue()]);
        assert.equal(queued.reduce((sum, result) => sum + result.queued, 0), 1);
        const before = calls.length;
        await Promise.all([service.dispatchOne(), service.dispatchOne()]);
        assert.equal(calls.length, before + 1);
        assert.equal((await jobsFor(user.id)).length, 1);
      });
    });

    await t.test('recording a sign-in can overlap a preference save without a user-to-preference deadlock', {
      timeout: 25000,
    }, async () => {
      await withUser({}, async (user) => {
        const { recordSuccessfulSignIn } = require('../src/modules/auth/onboarding.service');
        const gate = () => {
          let resolve;
          const promise = new Promise((done) => { resolve = done; });
          return { promise, resolve };
        };
        const userLocked = gate(), preferencesLocked = gate();
        let heldUserLock = false, heldPreferencesLock = false;
        const wrappedDb = (afterQuery) => ({
          query: (sql, values) => pool.query(sql, values),
          connect: async () => {
            const client = await pool.connect();
            return {
              release: () => client.release(),
              query: async (sql, values) => {
                const result = await client.query(sql, values);
                if (sql === 'BEGIN') await client.query("SET LOCAL lock_timeout='5s'");
                await afterQuery(sql);
                return result;
              },
            };
          },
        });
        const recordingDb = wrappedDb(async (sql) => {
          if (sql.startsWith('SELECT id FROM users') && /FOR (?:NO KEY )?UPDATE/.test(sql)) {
            heldUserLock = true;
            userLocked.resolve();
            // Allow the preference transaction to take its row lock before the
            // sign-in transaction proceeds to request that same preference row.
            await preferencesLocked.promise;
          }
        });
        const preferenceDb = wrappedDb(async (sql) => {
          if (sql.startsWith('SELECT user_id FROM call_preferences') && sql.includes('FOR UPDATE')) {
            heldPreferencesLock = true;
            preferencesLocked.resolve();
          }
        });
        const preferenceService = createCallService({ ...serviceOptions, db: preferenceDb });
        const beforeCalls = calls.length;
        const recording = recordSuccessfulSignIn(user.id, randomUUID(), recordingDb)
          .finally(() => userLocked.resolve());
        const saving = (async () => {
          await userLocked.promise;
          try {
            return await preferenceService.updatePreferences(user.id, prefsBody(user.phone));
          } finally { preferencesLocked.resolve(); }
        })();
        const outcomes = await Promise.allSettled([recording, saving]);
        assert.equal(heldUserLock, true, 'The fixture must hold the actual user serialization lock');
        assert.equal(heldPreferencesLock, true, 'The preference save must overlap that user lock');
        assert(outcomes.every((result) => result.status === 'fulfilled'),
          `Overlapping sign-in and preference transactions must both commit: ${outcomes.map((result) => result.reason?.code || result.status).join(', ')}`);
        assert.equal(outcomes[0].value.recorded, true);
        assert.equal(outcomes[1].value.login_calls_enabled, true);
        assert.equal((await eventsFor(user.id)).length, 1);
        assert.equal(calls.length, beforeCalls, 'Recording and saving do not contact a provider directly');
      });
    });

    await t.test('later legitimate sign-ins greet again while rapid sign-ins are cancelled without a backlog', async () => {
      await withUser({}, async (user) => {
        const before = calls.length;
        await expectLogin(user);
        await expectOneDispatch(user);
        await ageAttempts(user.id);
        await expectLogin(user);
        await expectOneDispatch(user);
        await expectLogin(user);
        assert.equal((await service.enqueue()).queued, 1);
        await service.dispatchOne();
        const jobs = await jobsFor(user.id);
        assert.equal(jobs.filter((job) => job.status === 'SENT').length, 2);
        assert.equal(jobs.filter((job) => job.status === 'CANCELLED' && !job.started_at).length, 1);
        assert.equal(jobs.filter((job) => job.status === 'QUEUED').length, 0);
        assert.equal(calls.length, before + 2);
        await ageAttempts(user.id);
        assert.equal((await service.enqueue()).queued, 0, 'A rate-limited sign-in must never revive later');
        assert.deepEqual(await service.dispatchOne(), { empty: true });
        assert.equal(calls.length, before + 2);
      });
    });

    await t.test('three calls per rolling day is enforced even when the spacing limit is satisfied', async () => {
      await withUser({}, async (user) => {
        const before = calls.length;
        for (let count = 0; count < 3; count++) {
          await ageAttempts(user.id);
          await expectLogin(user);
          await expectOneDispatch(user);
        }
        await ageAttempts(user.id);
        await expectLogin(user);
        assert.equal((await service.enqueue()).queued, 1);
        await service.dispatchOne();
        assert.equal(calls.length, before + 3);
        const jobs = await jobsFor(user.id);
        assert.equal(jobs.filter((job) => job.status === 'SENT').length, 3);
        assert.equal(jobs.filter((job) => job.status === 'CANCELLED').length, 1);
        await ageAttempts(user.id, '25 hours');
        assert.equal((await service.enqueue()).queued, 0, 'A daily-limit cancellation must stay terminal');
        assert.deepEqual(await service.dispatchOne(), { empty: true });
        assert.equal(calls.length, before + 3);
      });
    });

    await t.test('changing the verified number never redirects a previous sign-in intent', async () => {
      await withUser({}, async (user) => {
        await expectLogin(user);
        assert.equal((await service.enqueue()).queued, 1);
        const oldPhone = user.phone;
        user.phone = '+919000000091';
        await service.updatePreferences(user.id, prefsBody(user.phone));
        assert.equal((await service.preferences(user.id)).phone_verified_at, null);
        await verifyFixturePhone(user.id);
        const before = calls.length;
        assert.equal((await service.enqueue()).queued, 0);
        await service.dispatchOne();
        assert.equal(calls.length, before);
        assert.equal((await latestFor(user.id)).last_sign_in_phone, oldPhone);
        await expectLogin(user);
        await expectOneDispatch(user);
        assert.equal(calls.at(-1).to, user.phone);
      });
    });

    await t.test('withdrawing login-call consent cancels pending greetings and requires a fresh login after opting in', async () => {
      await withUser({}, async (user) => {
        await expectLogin(user);
        assert.equal((await service.enqueue()).queued, 1);
        const before = calls.length;
        await service.updatePreferences(user.id, prefsBody(user.phone, { login_calls_enabled: false }));
        assert.equal((await service.enqueue()).queued, 0);
        await service.dispatchOne();
        assert.equal(calls.length, before);
        assert.equal((await jobsFor(user.id))[0].status, 'CANCELLED');
        await expectLogin(user);
        assert.equal((await eventsFor(user.id)).length, 1, 'No-consent login must not add a call event');
        await service.updatePreferences(user.id, prefsBody(user.phone));
        assert.equal((await service.enqueue()).queued, 0, 'Opting in again must not replay the cancelled greeting');
        await expectLogin(user);
        await expectOneDispatch(user);
      });
    });

    await t.test('stale sign-in greetings are cancelled after 24 hours', async () => {
      await withUser({}, async (user) => {
        await expectLogin(user);
        assert.equal((await service.enqueue()).queued, 1);
        await pool.query("UPDATE users SET last_signed_in_at=NOW()-INTERVAL '25 hours' WHERE id=$1", [user.id]);
        await pool.query("UPDATE sign_in_call_events SET created_at=NOW()-INTERVAL '25 hours' WHERE user_id=$1", [user.id]);
        const before = calls.length;
        await service.dispatchOne();
        assert.equal(calls.length, before);
        assert.equal((await jobsFor(user.id))[0].status, 'CANCELLED');
        assert.equal((await service.enqueue()).queued, 0);
      });
    });

    await t.test('preview mode creates no jobs or provider calls for a valid sign-in intent', async () => {
      await withUser({}, async (user) => {
        await expectLogin(user);
        const preview = createCallService({ ...serviceOptions, settings: () => ({ ...settings(), live: false }) });
        const before = calls.length;
        assert.equal((await preview.enqueue()).queued, 0);
        assert.deepEqual(await preview.dispatchOne(), { skipped: true });
        await preview.preview(user.id);
        assert.equal((await jobsFor(user.id)).length, 0);
        assert.equal(calls.length, before);
      });
    });

    await t.test('a saved unverified phone waits for ownership verification and a missing phone creates no event', async () => {
      await withUser({ phoneVerified: false }, async (user) => {
        const signedIn = await expectLogin(user);
        assert.equal(signedIn.data.callSetupNeeded, true);
        assert.equal((await eventsFor(user.id)).length, 1);
        assert.equal((await service.enqueue()).queued, 0);
        await verifyFixturePhone(user.id);
        await expectOneDispatch(user);
      });
      await withUser({}, async (user) => {
        user.phone = '';
        await service.updatePreferences(user.id, prefsBody(''));
        await expectLogin(user);
        assert.equal((await eventsFor(user.id)).length, 0);
        assert.equal((await service.enqueue()).queued, 0);
      });
    });

    await t.test('legacy one-time welcome consent does not silently become repeated sign-in consent', async () => {
      await withUser({ loginEnabled: false, welcomeEnabled: true }, async (user) => {
        const legacyPreferences = prefsBody(user.phone, { welcome_enabled: true });
        delete legacyPreferences.login_calls_enabled;
        await service.updatePreferences(user.id, legacyPreferences);
        assert.equal((await service.preferences(user.id)).login_calls_enabled, false);
        await expectLogin(user);
        assert.equal((await eventsFor(user.id)).length, 0);
        await expectOneDispatch(user);
        assert.equal((await jobsFor(user.id))[0].kind, 'WELCOME');
        await ageAttempts(user.id);
        await expectLogin(user);
        assert.equal((await eventsFor(user.id)).length, 0);
        assert.equal((await service.enqueue()).queued, 0);
        assert.equal((await jobsFor(user.id)).length, 1);
      });
    });
  } finally {
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      if (isolated) {
        await pool.query('DELETE FROM auth_codes WHERE email=ANY($1::text[])', [emails]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
      }
    } finally {
      if (originalWorker) require.cache[workerPath] = originalWorker;
      else delete require.cache[workerPath];
      if (originalMail) require.cache[mailPath] = originalMail;
      else delete require.cache[mailPath];
      if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalJwtSecret;
      if (originalServeFrontend === undefined) delete process.env.SERVE_FRONTEND;
      else process.env.SERVE_FRONTEND = originalServeFrontend;
      await pool.end();
    }
  }
});
