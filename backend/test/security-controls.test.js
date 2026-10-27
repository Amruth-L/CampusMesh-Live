const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { securityPolicy } = require('../src/security/policy');
const { authenticateToken } = require('../src/security/session');
const { requestLimit } = require('../src/security/request-limits');
const secret = 'security-regression-secret-not-for-production';

test('production rejects missing or insecure origins and short signing keys', () => {
  assert.throws(() => securityPolicy({ NODE_ENV: 'production', JWT_SECRET: secret }), /Production needs/);
  assert.throws(
    () =>
      securityPolicy({
        NODE_ENV: 'production',
        FRONTEND_ORIGIN: 'https://campus.example',
        JWT_SECRET: 'short',
      }),
    /Production needs/,
  );
  assert.throws(
    () =>
      securityPolicy({
        NODE_ENV: 'production',
        FRONTEND_ORIGIN: 'http://campus.example',
        JWT_SECRET: secret,
      }),
    /HTTPS/,
  );
  const config = securityPolicy({
    NODE_ENV: 'production',
    FRONTEND_ORIGIN: 'https://campus.example/',
    JWT_SECRET: secret,
  });
  assert.equal(config.allowed('https://campus.example'), true);
  assert.equal(config.allowed('https://campus.example.attacker.invalid'), false);
  assert.equal(config.allowed('https://attacker.invalid'), false);
  assert.equal(config.allowed(undefined), true, 'Native clients still need normal API authentication');
  assert.equal(securityPolicy({}).allowed('http://127.0.0.1:5175'), true);
});

test('session checks reject revoked, deleted, expired and wrong-algorithm tokens', async (t) => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  t.after(() => {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  const id = randomUUID();
  let version = 0,
    exists = true;
  const db = {
    query: async () => ({ rows: exists ? [{ id, auth_version: version, email_verified: true }] : [] }),
  };
  const token = jwt.sign({ id }, secret, { expiresIn: '5m' });
  assert.equal((await authenticateToken(token, db)).id, id, 'Legacy version-zero token remains compatible');
  version = 1;
  await assert.rejects(authenticateToken(token, db), { status: 403 });
  const current = jwt.sign({ id, session_version: 1 }, secret, { expiresIn: '5m' });
  assert.equal((await authenticateToken(current, db)).id, id);
  for (const bad of [
    jwt.sign({ id, session_version: 1 }, secret, { algorithm: 'HS384' }),
    jwt.sign({ id, session_version: 1 }, secret, { expiresIn: -1 }),
    jwt.sign({ id: 'bad' }, secret),
    jwt.sign({ id, session_version: '1' }, secret),
  ])
    await assert.rejects(authenticateToken(bad, db), { status: 403 });
  exists = false;
  await assert.rejects(authenticateToken(current, db), { status: 403 });
});

test('request limiter returns retry guidance and hides database errors', async (t) => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  t.after(() => {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  const response = () => ({
    headers: {},
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  });
  const limited = requestLimit({
    scope: 'test',
    limit: 2,
    seconds: 60,
    db: { query: async (sql) => ({ rows: sql.startsWith('INSERT') ? [{ attempts: 3, retry: 20 }] : [] }) },
  });
  const res = response();
  await limited({ ip: '127.0.0.1' }, res, () => assert.fail('Must throttle'));
  assert.equal(res.code, 429);
  assert.equal(res.headers['Retry-After'], '20');
  const broken = requestLimit({
    scope: 'test',
    limit: 2,
    seconds: 60,
    db: {
      query: async () => {
        throw new Error('secret database detail');
      },
    },
  });
  const failed = response();
  await broken({ ip: '127.0.0.1' }, failed, () => assert.fail('Must fail closed'));
  assert.equal(failed.code, 503);
  assert.doesNotMatch(failed.body.error, /secret database/);
});

test(
  'security HTTP and socket journeys use an isolated local schema',
  { skip: !process.env.REVIEW_DATABASE_URL, timeout: 120000 },
  async (t) => {
    const url = new URL(process.env.REVIEW_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/campusmesh_review');
    const { Pool } = require('pg'),
      admin = new Pool({ connectionString: url.toString() });
    const schema = 'qa_security_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = secret;
    const db = require('../src/config/database');
    let child, socket;
    try {
      const fs = require('node:fs/promises'),
        path = require('node:path');
      for (const f of (await fs.readdir(path.join(__dirname, '../src/db/migrations')))
        .filter((n) => /^\d{3}_.+\.sql$/.test(n))
        .sort())
        await db.query(await fs.readFile(path.join(__dirname, '../src/db/migrations', f), 'utf8'));
      const owner = randomUUID(),
        other = randomUUID();
      const hash = await require('bcrypt').hash('original-password', 4);
      for (const id of [owner, other])
        await db.query('INSERT INTO users(id,name,email,password,email_verified) VALUES($1,$2,$3,$4,true)', [
          id,
          'QA security',
          id + '@dbit.co.in',
          hash,
        ]);
      const { spawn } = require('node:child_process');
      child = spawn(process.execPath, [require.resolve('../src/server')], {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: url.toString(),
          JWT_SECRET: secret,
          PORT: '3037',
          CALLS_MODE: 'preview',
          CALLS_SCHEDULER_ENABLED: 'false',
          DIRECT_UPI_ENABLED: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Startup timeout')), 15000);
        child.stdout.on('data', (data) => {
          if (data.toString().includes('listening')) {
            globalThis.clearTimeout(timer);
            resolve();
          }
        });
        child.once('exit', () => reject(new Error('API exited')));
      });
      const base = 'http://127.0.0.1:3037';
      const call = (path, body, token, extra = {}) =>
        fetch(base + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const login = async (id, password = 'original-password') => {
        const r = await call('/login', { email: id + '@dbit.co.in', password });
        assert.equal(r.status, 200);
        return (await r.json()).token;
      };
      let first = await login(owner),
        second = await login(owner);
      const unrelated = await login(other);
      await t.test('headers and origin filtering work without changing public listing access', async () => {
        const res = await call('/listings', undefined, undefined, { Origin: 'http://127.0.0.1:5175' });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5175');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-frame-options'), 'DENY');
        assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
        assert.ok(res.headers.get('content-security-policy-report-only'));
        assert.match(res.headers.get('permissions-policy'), /microphone=\(self\)/);
        assert.equal(
          (await call('/listings', undefined, undefined, { Origin: 'https://attacker.invalid' })).status,
          403,
        );
      });
      await t.test(
        'large ordinary JSON is rejected; upload routes require authentication before body parsing',
        async () => {
          assert.equal(
            (await call('/login', { email: 'x@dbit.co.in', password: 'x', padding: 'a'.repeat(140000) }))
              .status,
            413,
          );
          assert.equal((await call('/listings', { image_url: 'a'.repeat(200000) })).status, 401);
          assert.equal(
            (await call('/api/delivery/' + randomUUID() + '/condition-photos', { image: 'a'.repeat(200000) }))
              .status,
            401,
          );
          const res = await call(
            '/listings',
            {
              title: 'QA large photo',
              description: 'Fixture',
              category: 'Books',
              location: 'Library',
              rent_price: 10,
              price: 500,
              deposit: 100,
              image_url:
                'data:image/png;base64,' +
                (
                  await fs.readFile(path.join(__dirname, '../../frontend/public/images/categories/books.png'))
                ).toString('base64'),
              padding: 'a'.repeat(200000),
            },
            first,
          );
          assert.equal(res.status, 503);
          assert.match(
            (await res.json()).error,
            /storage is not configured/i,
            'Large authenticated photo reaches storage validation, not the small ordinary parser',
          );
        },
      );
      await t.test(
        'request budgets are atomic and shared between limiter instances; expired windows recover',
        async () => {
          const key = 'security-test-' + randomUUID();
          const a = requestLimit({ scope: key, limit: 2, seconds: 60, db }),
            b = requestLimit({ scope: key, limit: 2, seconds: 60, db });
          const invoke = async (fn) => {
            let status = 200;
            await fn(
              { ip: '127.0.0.5' },
              {
                set() {
                  return this;
                },
                status(n) {
                  status = n;
                  return this;
                },
                json() {},
              },
              () => {},
            );
            return status;
          };
          assert.deepEqual((await Promise.all([invoke(a), invoke(b), invoke(a)])).sort(), [200, 200, 429]);
          await db.query("UPDATE request_rate_limits SET expires_at=NOW()-INTERVAL '1 second'");
          assert.equal(await invoke(b), 200);
        },
      );
      await t.test(
        'logout invalidates all copied tokens, disconnects sockets and leaves other users signed in',
        async () => {
          const { io } = require('../../frontend/node_modules/socket.io-client');
          socket = io(base, { auth: { token: first }, transports: ['websocket'], reconnection: false });
          await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
          });
          const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
          assert.equal((await call('/logout', {}, first)).status, 200);
          await disconnected;
          assert.equal((await call('/me', undefined, first)).status, 403);
          assert.equal((await call('/me', undefined, second)).status, 403);
          assert.equal((await call('/me', undefined, unrelated)).status, 200);
          first = await login(owner);
          assert.equal(jwt.decode(first).session_version, 1);
          assert.equal((await call('/me', undefined, first)).status, 200);
        },
      );
      await t.test('password reset revokes copied tokens only after a valid code is consumed', async () => {
        const email = owner + '@dbit.co.in',
          code = '123456',
          digest = createHmac('sha256', secret).update(`${email}:reset:${code}`).digest('hex');
        await db.query(
          "INSERT INTO auth_codes(email,purpose,code_hash,expires_at,sent_at) VALUES($1,'reset',$2,NOW()+INTERVAL '10 minutes',NOW())",
          [email, digest],
        );
        assert.equal(
          (await call('/reset-password', { email, otp: '654321', newPassword: 'updated-password' })).status,
          400,
        );
        assert.equal((await call('/me', undefined, first)).status, 200);
        assert.equal(
          (await call('/reset-password', { email, otp: code, newPassword: 'updated-password' })).status,
          200,
        );
        assert.equal((await call('/me', undefined, first)).status, 403);
        assert.equal((await call('/login', { email, password: 'original-password' })).status, 400);
        first = await login(owner, 'updated-password');
      });
      await t.test('profile password changes revoke existing sessions atomically', async () => {
        const res = await fetch(base + '/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + first },
          body: JSON.stringify({ old_password: 'updated-password', new_password: 'changed-again-password' }),
        });
        assert.equal(res.status, 200);
        assert.equal((await call('/me', undefined, first)).status, 403);
        await login(owner, 'changed-again-password');
      });
    } finally {
      socket?.close();
      if (child) {
        child.kill();
        await new Promise((resolve) => child.once('exit', resolve));
      }
      await db.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
