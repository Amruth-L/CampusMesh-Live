const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { rentalDays, dateError, campusToday, overlaps } = require('../../shared/rental-dates.js');
const { listingInput } = require('../src/modules/listings/listing-input');
const { rentalQuote } = require('../src/shared/rental-quote');
const { publicListing } = require('../src/modules/listings/public-listing');
const { passwordError } = require('../src/shared/validation');

test('inclusive dates are calendar-based, including same day, leap/month boundary and invalid dates', () => {
  for (const [a, b, n] of [
    ['2028-02-29', '2028-02-29', 1],
    ['2028-02-28', '2028-03-01', 3],
    ['2026-10-31', '2026-11-02', 3],
  ])
    assert.equal(rentalDays(a, b), n);
  for (const [a, b] of [
    ['2026-02-30', '2026-03-01'],
    ['2026-01-02', '2026-01-01'],
    [null, '2026-01-01'],
    ['2026-1-1', '2026-01-02'],
  ])
    assert.equal(rentalDays(a, b), 0);
  assert.ok(dateError('2026-01-01', '2026-01-02', '2026-01-03'));
  assert.equal(campusToday(new Date('2026-01-01T20:00:00Z')), '2026-01-02');
  assert.equal(
    overlaps('2026-01-01', '2026-01-05', [{ start_date: '2026-01-03', end_date: '2026-01-03' }]),
    true,
  );
});
test('public listing contract cannot expose private or newly added database fields', () => {
  assert.deepEqual(
    publicListing({
      id: 'id',
      title: 'Book',
      owner_email: 'secret',
      phone_number: 'secret',
      future_private_field: 'secret',
    }),
    { id: 'id', title: 'Book' },
  );
});
const listing = {
  title: 'Book',
  description: 'A textbook',
  category: 'Books',
  location: 'Library',
  rent_price: 20,
  price: 500,
  deposit: 300,
  delivery_charge: 10,
  delivery_available: true,
  condition: 'Good',
};
test('create/edit share field validation and preserve precise amounts', () => {
  assert.equal(listingInput({ ...listing, rent_price: '20.55' }).rent_price, 20.55);
  assert.equal(listingInput({ title: 'Edited' }, listing).deposit, 300);
  for (const patch of [
    { title: 1 },
    { price: Infinity },
    { price: null },
    { deposit: -1 },
    { rent_price: '12x' },
    { rent_price: '12.345' },
    { delivery_available: 'false' },
    { is_active: null },
    { image_urls: 'url' },
    { pickup_time: 2 },
  ])
    assert.throws(() => listingInput(patch, listing), { status: 400 });
  assert.ok(passwordError('a'.repeat(73)));
  assert.equal(passwordError('valid password'), null);
});
test('payment modes share authoritative price amounts and explicit due stages', () => {
  const q = rentalQuote(listing, 2, true, true);
  assert.deepEqual(
    [q.rentalFee, q.platformFee, q.securityDeposit, q.payNow, q.payAfterAcceptance, q.payAfterHandover],
    [40, 0, 300, 0, 340, 10],
  );
  const legacy = rentalQuote(listing, 2, true, false);
  assert.equal(legacy.totalAmount, 52);
  assert.equal(legacy.payNow, 52);
  assert.equal(rentalQuote({ ...listing, deposit: 0, delivery_charge: 0 }, 1, true, true).securityDeposit, 0);
});

test(
  'isolated API regression journeys',
  { skip: !process.env.REVIEW_DATABASE_URL, timeout: 120000 },
  async (t) => {
    // Hard boundary: never run fixture/schema tests against a hosted database.
    const url = new URL(process.env.REVIEW_DATABASE_URL);
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
      'Use a disposable loopback PostgreSQL database.',
    );
    assert.equal(url.pathname, '/campusmesh_review');
    const { Pool } = require('pg'),
      admin = new Pool({ connectionString: url.toString() });
    const schema = `qa_review_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = 'local-review-test-only';
    process.env.DIRECT_UPI_ENABLED = 'true';
    process.env.CALLS_MODE = 'preview';
    process.env.CALLS_SCHEDULER_ENABLED = 'false';
    const db = require('../src/config/database');
    let child;
    try {
      const fs = require('node:fs/promises'),
        path = require('node:path');
      for (const f of (await fs.readdir(path.join(__dirname, '../src/db/migrations')))
        .filter((n) => /^\d{3}_.+\.sql$/.test(n))
        .sort())
        await db.query(await fs.readFile(path.join(__dirname, '../src/db/migrations', f), 'utf8'));
      const owner = randomUUID(),
        renter = randomUUID(),
        stranger = randomUUID(),
        item = randomUUID(),
        delivery = randomUUID();
      const bcrypt = require('bcrypt');
      const password = await bcrypt.hash('correct password', 4);
      for (const id of [owner, renter, stranger])
        await db.query('INSERT INTO users(id,name,email,password,email_verified) VALUES($1,$2,$3,$4,true)', [
          id,
          'QA student',
          `${id}@dbit.co.in`,
          password,
        ]);
      await db.query(
        "INSERT INTO listings(id,owner_id,title,description,category,location,rent_price,price,deposit,delivery_available,delivery_charge,image_url) VALUES($1,$2,'Book','Fixture','Books','Library',20,500,300,true,10,'https://example.invalid/photo.jpg')",
        [item, owner],
      );
      await db.query(
        "INSERT INTO delivery_requests(id,customer_id,seller_id,item_description,pickup_location,drop_location) VALUES($1,$2,$3,'QA','Library','Hostel')",
        [delivery, renter, owner],
      );
      const invoke = async (handler, user = owner, body = {}, params = { id: item }) => {
        const out = { status: 200, headers: {} };
        await handler(
          { user: { id: user }, body, params, ip: '127.0.0.1' },
          {
            status(n) {
              out.status = n;
              return this;
            },
            set(k, v) {
              out.headers[k] = v;
              return this;
            },
            json(data) {
              out.data = data;
              return this;
            },
            end() {},
          },
        );
        return out;
      };
      await t.test('both actual public endpoints omit private contact fields', async () => {
        const c = require('../src/modules/listings/listings.controller');
        for (const handler of [c.getListings, c.getListingById]) {
          const res = await invoke(handler);
          assert.equal(res.status, 200);
          for (const row of Array.isArray(res.data) ? res.data : [res.data])
            assert.equal('owner_email' in row, false);
        }
      });
      await t.test('malformed profile values return 400 without database errors', async () => {
        const c = require('../src/modules/profile/profile.controller');
        for (const body of [
          { name: 123 },
          { username: null },
          { department: [] },
          { new_password: 'a'.repeat(73) },
        ])
          assert.equal((await invoke(c.updateProfile, owner, body)).status, 400);
      });
      await t.test('create and update persist all fields and preserve photos and precision', async () => {
        const c = require('../src/modules/listings/listings.controller'),
          photos = require('../src/modules/listings/photo-storage');
        const original = photos.prepare;
        photos.prepare = async ({ images, cover }) => ({ images, cover });
        try {
          const made = await invoke(c.createListing, owner, {
            ...listing,
            rent_price: 20.55,
            image_url: 'https://example.invalid/photo.jpg',
          });
          assert.equal(made.status, 201);
          assert.equal(Number(made.data.rent_price), 20.55);
          const edited = await invoke(
            c.updateListing,
            owner,
            {
              rent_price: 21.75,
              deposit: 150,
              condition: 'Fair',
              location: 'Lab',
              pickup_time: '10 min',
              delivery_charge: 5,
              delivery_available: false,
            },
            { id: made.data.id },
          );
          assert.equal(edited.status, 200);
          const row = (await db.query('SELECT * FROM listings WHERE id=$1', [made.data.id])).rows[0];
          assert.equal(Number(row.rent_price), 21.75);
          assert.equal(Number(row.deposit), 150);
          assert.equal(row.condition, 'Fair');
          assert.equal(row.location, 'Lab');
          assert.equal(row.image_url, made.data.image_url);
          assert.equal(row.delivery_available, false);
          assert.equal((await invoke(c.updateListing, owner, { title: 123 })).status, 400);
        } finally {
          photos.prepare = original;
        }
      });
      await t.test(
        'server quote ignores client price overrides; same day quote/cart/book agree',
        async () => {
          const today = campusToday();
          const p = require('../src/modules/payments/pricing.controller');
          const q = await invoke(p.calculatePricingHandler, renter, {
            listing_id: item,
            start_date: today,
            end_date: today,
            daily_rent: 0,
            custom_deposit: 0,
          });
          assert.equal(q.status, 200);
          assert.equal(q.data.rentalFee, 20);
          assert.equal(q.data.securityDeposit, 300);
          const cart = require('../src/modules/cart/cart.controller');
          const added = await invoke(cart.addToCart, renter, {
            item_id: item,
            start_date: today,
            end_date: today,
          });
          assert.equal(added.status, 201);
          assert.equal(added.data.cartItem.days, 1);
          assert.equal(Number(added.data.cartItem.platform_fee), 0);
          for (const body of [
            { item_id: item, start_date: 'bad', end_date: today },
            { item_id: item, start_date: today, end_date: today, delivery_requested: 'false' },
          ])
            assert.equal((await invoke(cart.addToCart, renter, body)).status, 400);
          assert.equal(
            (
              await invoke(
                cart.updateCartDates,
                renter,
                { start_date: today, end_date: today, delivery_requested: 'false' },
                { id: added.data.cartItem.id },
              )
            ).status,
            400,
          );
          const c = require('../src/modules/rentals/rentals.controller');
          const booked = await invoke(c.bookRental, renter, {
            listing_id: item,
            start_date: today,
            end_date: today,
          });
          assert.equal(booked.status, 201);
          assert.equal(booked.data.rental.rental_days, 1);
          assert.equal(Number(booked.data.rental.rental_fee), q.data.rentalFee);
          const retry = await invoke(c.bookRental, renter, {
            listing_id: item,
            start_date: today,
            end_date: today,
          });
          assert.equal(retry.data.rental.id, booked.data.rental.id);
          assert.equal(
            (await invoke(c.bookRental, stranger, { listing_id: item, start_date: today, end_date: today }))
              .status,
            409,
          );
        },
      );
      await t.test(
        'shared login limiter handles concurrency, Retry-After, expiry and another IP',
        async () => {
          const middleware = require('../src/modules/auth/login-throttle').loginThrottle(db, {
            pairLimit: 2,
            ipLimit: 20,
            windowSeconds: 60,
          });
          const attempt = async (ip = '127.0.0.1') => {
            const req = { ip, body: { email: 'USER@dbit.co.in' } };
            const result = {};
            await middleware(
              req,
              {
                set(k, v) {
                  result[k] = v;
                  return this;
                },
                status(n) {
                  result.status = n;
                  return this;
                },
                json(data) {
                  result.data = data;
                },
              },
              () => {
                result.status = 200;
                result.clear = req.clearLoginAttempts;
              },
            );
            return result;
          };
          assert.equal((await attempt()).status, 200);
          assert.equal((await attempt()).status, 200);
          const limited = await attempt();
          assert.equal(limited.status, 429);
          assert.ok(Number(limited['Retry-After']) > 0);
          assert.equal((await attempt('127.0.0.2')).status, 200);
          await db.query("UPDATE login_attempt_limits SET expires_at=NOW()-INTERVAL '1 second'");
          const recovered = await attempt();
          assert.equal(recovered.status, 200);
          await recovered.clear();
          assert.equal((await attempt()).status, 200);
        },
      );
      await t.test(
        'malformed socket payloads, unauthorized joins and database failure leave API alive',
        async () => {
          const { spawn } = require('node:child_process');
          const { io } = require('../../frontend/node_modules/socket.io-client');
          child = spawn(process.execPath, [require.resolve('../src/server')], {
            env: {
              PATH: process.env.PATH,
              DATABASE_URL: url.toString(),
              JWT_SECRET: process.env.JWT_SECRET,
              PORT: '3036',
              CALLS_MODE: 'preview',
              CALLS_SCHEDULER_ENABLED: 'false',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('API startup timeout')), 15000);
            child.stdout.on('data', (d) => {
              if (d.toString().includes('listening')) {
                globalThis.clearTimeout(timer);
                resolve();
              }
            });
            child.once('exit', () => reject(new Error('API exited')));
          });
          const token = require('jsonwebtoken').sign({ id: stranger }, process.env.JWT_SECRET);
          const socket = io('http://127.0.0.1:3036', { auth: { token }, reconnection: false });
          await new Promise((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
          });
          const join = (id) =>
            new Promise((resolve, reject) =>
              socket
                .timeout(2000)
                .emit('delivery:join', id, (err, result) => (err ? reject(err) : resolve(result))),
            );
          for (const id of ['not-a-uuid', null, {}, 123, delivery]) assert.equal((await join(id)).ok, false);
          socket.close();
          const participant = io('http://127.0.0.1:3036', {
            auth: { token: require('jsonwebtoken').sign({ id: owner }, process.env.JWT_SECRET) },
            reconnection: false,
          });
          await new Promise((resolve) => participant.on('connect', resolve));
          const good = await new Promise((resolve) => participant.emit('delivery:join', delivery, resolve));
          assert.equal(good.ok, true);
          participant.close();
          assert.equal((await fetch('http://127.0.0.1:3036/health')).status, 200);
          assert.equal(child.exitCode, null);
          for (const body of [{ name: 123 }, { username: null }]) {
            const response = await fetch('http://127.0.0.1:3036/api/profile', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify(body),
            });
            assert.equal(response.status, 400);
          }
          await db.query('DELETE FROM login_attempt_limits');
          for (let i = 0; i < 10; i++) {
            const response = await fetch('http://127.0.0.1:3036/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: `${renter}@dbit.co.in`, password: 'wrong-password' }),
            });
            assert.equal(response.status, 400);
          }
          const throttled = await fetch('http://127.0.0.1:3036/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `${renter}@dbit.co.in`, password: 'correct password' }),
          });
          assert.equal(throttled.status, 429);
          assert.ok(throttled.headers.get('retry-after'));
          await db.query("UPDATE login_attempt_limits SET expires_at=NOW()-INTERVAL '1 second'");
          const signedIn = await fetch('http://127.0.0.1:3036/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `${renter}@dbit.co.in`, password: 'correct password' }),
          });
          assert.equal(signedIn.status, 200);
          assert.ok((await signedIn.json()).token);

          const listeners = {};
          require('../src/modules/delivery/delivery.socket').attachDeliveryRooms(
            {
              user: { id: owner },
              on(e, f) {
                listeners[e] = f;
              },
              join() {
                throw new Error('should not join');
              },
            },
            {
              query: async () => {
                throw new Error('private database detail');
              },
            },
          );
          await listeners['delivery:join'](delivery, (result) => {
            assert.equal(result.ok, false);
            assert.doesNotMatch(result.error, /private database/);
          });
        },
      );
    } finally {
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
