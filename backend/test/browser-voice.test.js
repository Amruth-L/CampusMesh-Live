/* global fetch */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { io: client } = require('../../frontend/node_modules/socket.io-client');
const { createVoiceService } = require('../src/modules/voice/voice.service');
const { createVoiceRouter } = require('../src/modules/voice/voice.routes');
const { attachVoice } = require('../src/modules/voice/voice.socket');
const { agentSettings } = require('../src/modules/voice/deepgram.settings');
const ALICE = '00000000-0000-4000-8000-000000000011',
  BOB = '00000000-0000-4000-8000-000000000012',
  UNVERIFIED = '00000000-0000-4000-8000-000000000013',
  DELETED = '00000000-0000-4000-8000-000000000014';
const configured = () => ({ enabled: true, aiConfigured: true, key: 'never-expose' });
const fakeDB = {
  query: async (_sql, [id]) => ({
    rows: id === DELETED ? [] : [{ auth_version: 0, email_verified: id !== UNVERIFIED }],
  }),
};

async function fixture(t) {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'voice-fixture-only';
  const voice = createVoiceService({ settings: configured });
  const app = express();
  app.use(express.json());
  app.use('/api/voice', createVoiceRouter({ service: voice, db: fakeDB }));
  const server = http.createServer(app),
    io = new Server(server);
  const providers = [];
  attachVoice(io, {
    service: voice,
    db: fakeDB,
    settings: async (user, _db, rate) => ({ type: 'Settings', account: user, sample_rate: rate }),
    connect: () => {
      const provider = new EventEmitter();
      Object.assign(provider, {
        readyState: 1,
        bufferedAmount: 0,
        sent: [],
        terminated: false,
        send(data) {
          this.sent.push(data);
          this.emit('sent', data);
        },
        terminate() {
          this.terminated = true;
          this.emit('close');
        },
        message(data, binary = false) {
          this.emit('message', binary ? data : Buffer.from(JSON.stringify(data)), binary);
        },
      });
      providers.push(provider);
      return provider;
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const token = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const sockets = [];
  t.after(async () => {
    sockets.forEach((s) => s.disconnect());
    voice.dispose();
    await new Promise((r) => io.close(r));
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  return {
    voice,
    providers,
    async request(user, path, method = 'GET') {
      const res = await fetch(url + '/api/voice' + path, {
        method,
        headers: user ? { Authorization: 'Bearer ' + token(user) } : {},
      });
      return { status: res.status, data: res.status === 204 ? null : await res.json() };
    },
    socket(user, sessionId) {
      const socket = client(url + '/voice', {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        autoConnect: false,
        auth: { token: user ? token(user) : '', sessionId, sampleRate: 48000 },
      });
      sockets.push(socket);
      return socket;
    },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

test(
  'HTTP and streaming authenticate verified users; tickets cannot cross accounts',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    assert.equal((await f.request(null, '/sessions', 'POST')).status, 401);
    assert.equal((await f.request(UNVERIFIED, '/sessions', 'POST')).status, 403);
    assert.equal((await f.request(DELETED, '/capabilities')).status, 403);
    const result = await f.request(ALICE, '/sessions', 'POST');
    assert.equal(result.status, 201);
    assert.equal(result.data.key, undefined);
    for (const user of [null, UNVERIFIED]) {
      const socket = f.socket(user, result.data.id),
        rejected = once(socket, 'connect_error');
      socket.connect();
      assert.match((await rejected)[0].message, /Sign in/);
      socket.disconnect();
    }
    const wrong = f.socket(BOB, result.data.id),
      rejected = once(wrong, 'voice:error');
    wrong.connect();
    await rejected;
    assert.equal(f.providers.length, 0);
    assert.equal((await f.request(BOB, `/sessions/${result.data.id}`, 'DELETE')).status, 204);
    let closed = false;
    f.voice.claim(ALICE, result.data.id, () => {
      closed = true;
    });
    await f.request(ALICE, `/sessions/${result.data.id}`, 'DELETE');
    assert.equal(closed, true);
  },
);

test(
  'Deepgram bridge waits for handshake, carries PCM and text, sanitizes events and closes resources',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      ticket = f.voice.start(ALICE);
    const socket = f.socket(ALICE, ticket.id),
      connected = once(socket, 'connect');
    socket.connect();
    await connected;
    await tick();
    const upstream = f.providers[0];
    assert.equal(upstream.sent.length, 0);
    socket.emit('voice:audio', Buffer.alloc(1024));
    await tick();
    assert.equal(upstream.sent.length, 0);
    upstream.message({ type: 'Welcome' });
    assert.deepEqual(JSON.parse(upstream.sent[0]), {
      type: 'Settings',
      account: ALICE,
      sample_rate: 48000,
    });
    const ready = once(socket, 'voice:ready');
    upstream.message({ type: 'SettingsApplied' });
    await ready;
    const audio = once(socket, 'voice:audio');
    upstream.message(Buffer.from([0, 1, 0, 2]), true);
    assert.equal((await audio)[0].byteLength, 4);
    const event = once(socket, 'voice:event');
    upstream.message({ type: 'ConversationText', role: 'assistant', content: 'Hello', secret: 'discard' });
    assert.deepEqual((await event)[0], { type: 'ConversationText', role: 'assistant', content: 'Hello' });
    socket.emit('voice:audio', Buffer.alloc(2048));
    socket.emit('voice:text', 'My return?');
    await tick();
    assert.ok(upstream.sent.some((b) => Buffer.isBuffer(b) && b.length === 2048));
    assert.ok(upstream.sent.some((b) => typeof b === 'string' && b.includes('InjectUserMessage')));
    socket.emit('voice:settings', { prompt: 'untrusted override' });
    await tick();
    assert.ok(!upstream.sent.some((b) => String(b).includes('untrusted override')));
    const ended = once(socket, 'voice:ended');
    socket.emit('voice:end');
    await ended;
    assert.equal(upstream.terminated, true);
    assert.throws(() => f.voice.claim(ALICE, ticket.id, () => {}), { status: 410 });
  },
);

test('provider failure ends the session without exposing its description', { timeout: 10000 }, async (t) => {
  const f = await fixture(t),
    ticket = f.voice.start(ALICE),
    socket = f.socket(ALICE, ticket.id);
  const connected = once(socket, 'connect');
  socket.connect();
  await connected;
  await tick();
  const error = once(socket, 'voice:error');
  f.providers[0].message({
    type: 'Error',
    code: 'INVALID_SETTINGS',
    description: 'private-provider-payload',
  });
  assert.doesNotMatch((await error)[0].message, /private-provider/);
  assert.equal(f.providers[0].terminated, true);
});

test('tickets expire, cannot be replayed, replace prior sessions and limit starts', (t) => {
  let now = 100000;
  const voice = createVoiceService({ settings: configured, clock: () => now });
  t.after(() => voice.dispose());
  const expired = voice.start('a');
  now += 31000;
  assert.throws(() => voice.claim('a', expired.id, () => {}), { status: 410 });
  const first = voice.start('a');
  let closed = false;
  voice.claim('a', first.id, () => {
    closed = true;
  });
  assert.throws(() => voice.claim('a', first.id, () => {}), { status: 410 });
  voice.start('a');
  assert.equal(closed, true);
  voice.start('a');
  voice.start('a');
  assert.throws(() => voice.start('a'), { status: 429 });
  const disabled = createVoiceService({ settings: () => ({ enabled: true, aiConfigured: false }) });
  assert.throws(() => disabled.start('a'), { status: 503 });
  disabled.dispose();
});

test('Deepgram settings use managed AI and expose only minimal owned records', async () => {
  const calls = [];
  const config = await agentSettings(
    ALICE,
    {
      query: async (sql, params) => {
        calls.push(params);
        return {
          rows: sql.includes('FROM rentals')
            ? [
                {
                  id: 'private-id',
                  title: 'Laptop owner@example.com',
                  status: 'RENTAL_ACTIVE',
                  due_date: '2026-11-01',
                  payment_status: 'FULLY_PAID',
                  deposit_status: 'PAID',
                  phone: '1234567890',
                },
              ]
            : [],
        };
      },
    },
    48000,
  );
  assert.deepEqual(calls, [[ALICE], [ALICE]]);
  assert.equal(config.audio.input.sample_rate, 48000);
  assert.equal(config.agent.think.provider.model, 'gpt-4o-mini');
  assert.equal(config.agent.think.endpoint, undefined);
  assert.equal(config.agent.speak.provider.model, 'aura-2-thalia-en');
  assert.doesNotMatch(config.agent.think.prompt, /private-id|owner@example|1234567890/);
  assert.match(config.agent.think.prompt, /2026-11-01/);
  assert.equal(config.mip_opt_out, true);
});
