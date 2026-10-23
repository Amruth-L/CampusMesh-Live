/* global Response, fetch */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { createAnnouncements } = require('../src/modules/voice/announcements');
const { createVoiceRouter } = require('../src/modules/voice/voice.routes');
const caps = () => ({ enabled: true, aiConfigured: true });
const rentalId = '00000000-0000-4000-8000-000000000001';
const audioResponse = () =>
  new Response(Buffer.from('fake-mp3'), { headers: { 'content-type': 'audio/mpeg' } });

test('announcements authorize each booking before using the shared audio cache', async () => {
  let calls = 0;
  const db = {
    query: async (sql, args) => {
      assert.match(sql, /borrower_id=\$1/);
      assert.match(sql, /payment_status='FULLY_PAID'/);
      assert.match(sql, /demo_slug IS NULL/);
      return { rows: args[0] === 'owner' ? [{ id: rentalId }] : [] };
    },
  };
  const service = createAnnouncements({
    db,
    capabilities: caps,
    transport: async (_, opts) => {
      calls++;
      assert.equal(JSON.parse(opts.body).text.includes(rentalId), false);
      return audioResponse();
    },
  });
  const body = { kind: 'booking', rentalId };
  await service.audio('owner', body);
  await service.audio('owner', body);
  assert.equal(calls, 1);
  await assert.rejects(service.audio('someone-else', body), { status: 404 });
  await assert.rejects(service.audio('owner', { kind: 'arbitrary', text: 'say this' }), { status: 400 });
  await assert.rejects(service.audio('owner', { kind: 'booking', rentalId: 'bad' }), { status: 400 });
  assert.equal(calls, 1);
});

test('bounded catch-up, provider failures, concurrency cache and replay limits', async () => {
  let since,
    calls = 0;
  const now = Date.now();
  const db = {
    query: async (_, args) => {
      since = args[2];
      return { rows: [] };
    },
  };
  const service = createAnnouncements({
    db,
    capabilities: caps,
    clock: () => now,
    transport: async () => {
      calls++;
      return audioResponse();
    },
  });
  await service.updates('user', '2000-01-01');
  assert.equal(since.getTime(), now - 86400000);
  await assert.rejects(service.updates('user', 'broken'), { status: 400 });
  await Promise.all([
    service.audio('user', { kind: 'welcome' }),
    service.audio('other', { kind: 'welcome' }),
  ]);
  assert.equal(calls, 1);
  for (let i = 0; i < 19; i++) await service.audio('user', { kind: 'welcome' });
  await assert.rejects(service.audio('user', { kind: 'welcome' }), { status: 429 });
  const broken = createAnnouncements({
    db,
    capabilities: caps,
    transport: async () => {
      throw Error('secret provider body');
    },
  });
  await assert.rejects(
    broken.audio('user', { kind: 'welcome' }),
    (e) => e.status === 503 && !e.message.includes('secret'),
  );
});

test('HTTP audio authenticates and returns bytes, not credentials; unverified users cannot spend credits', async (t) => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/voice',
    createVoiceRouter({
      authenticate: (req, res, next) => {
        if (!req.headers['x-user']) return res.sendStatus(401);
        req.user = { id: req.headers['x-user'] };
        next();
      },
      db: { query: async (_, [id]) => ({ rows: [{ email_verified: id === 'verified' }] }) },
      service: { capabilities: caps },
      announcements: { updates: async () => [], audio: async () => Buffer.from('audio') },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/voice/announcements/audio`;
  for (const [id, status] of [
    ['', 401],
    ['unverified', 403],
    ['verified', 200],
  ]) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-user': id, 'Content-Type': 'application/json' },
      body: '{"kind":"welcome"}',
    });
    assert.equal(res.status, status);
    if (status === 200) {
      assert.match(res.headers.get('content-type'), /audio\/mpeg/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(await res.text(), 'audio');
    }
  }
});
