/* global fetch, AbortController */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createVoiceService } = require('../src/modules/voice/voice.service');
const { createVoiceRouter } = require('../src/modules/voice/voice.routes');

const reply = { answer: 'Open My rentals to request your return.', mode: 'ai_grounded', sources: [] };
const service = (options) =>
  createVoiceService({
    answer: async () => reply,
    redact: (text) => text.replace(/secret/g, '[removed]'),
    settings: () => ({ enabled: true, aiConfigured: true }),
    ...options,
  });

test('voice endpoints enforce existing JWT, verified accounts and session ownership', async (t) => {
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'voice-fixture-only';
  const voice = service();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/voice',
    createVoiceRouter({
      service: voice,
      db: {
        query: async (_sql, [id]) => ({
          rows: id === 'deleted' ? [] : [{ email_verified: id !== 'unverified' }],
        }),
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    voice.dispose();
    await new Promise((resolve) => server.close(resolve));
    if (old === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = old;
  });
  const request = async (user, path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/voice${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: `Bearer ${jwt.sign({ id: user }, process.env.JWT_SECRET)}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      headers: response.headers,
      data: response.status === 204 ? null : await response.json(),
    };
  };
  assert.equal((await request(null, '/sessions', 'POST')).status, 401);
  assert.equal((await request('unverified', '/sessions', 'POST')).status, 403);
  assert.equal((await request('deleted', '/capabilities')).status, 403);
  const created = await request('alice', '/sessions', 'POST', { userId: 'bob' });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.equal(created.data.apiKey, undefined);
  const path = `/sessions/${created.data.id}`;
  assert.equal((await request('bob', path + '/turns', 'POST', { message: 'My rentals?' })).status, 410);
  assert.equal((await request('bob', path, 'DELETE')).status, 204);
  assert.equal(
    (await request('alice', path + '/turns', 'POST', { message: 'My rentals?' })).data.answer,
    reply.answer,
  );
  assert.equal((await request('alice', path + '/turns', 'POST', { message: 'x'.repeat(1501) })).status, 400);
  assert.equal((await request('alice', path, 'DELETE')).status, 204);
  assert.equal((await request('alice', path + '/turns', 'POST', { message: 'Hi' })).status, 410);
});

test('ephemeral conversation remembers only redacted owned turns; limits and expiry apply', async (t) => {
  let now = 1000000;
  const seen = [];
  const voice = service({
    clock: () => now,
    answer: async (id, text, options) => {
      seen.push({ id, text, ...options });
      return reply;
    },
  });
  t.after(() => voice.dispose());
  const session = voice.start('alice');
  await voice.turn('alice', session.id, 'secret return question');
  await voice.turn('alice', session.id, 'What about that?');
  assert.equal(seen[1].id, 'alice');
  assert.equal(seen[1].save, false);
  assert.equal(seen[1].voice, true);
  assert.equal(seen[1].history[0].text, '[removed] return question');
  for (let i = 0; i < 8; i++) await voice.turn('alice', session.id, 'return');
  await assert.rejects(voice.turn('alice', session.id, 'again'), { status: 429 });
  now += 61000;
  for (let i = 0; i < 20; i++) {
    if (i % 10 === 0) now += 61000;
    await voice.turn('alice', session.id, 'return');
  }
  await assert.rejects(voice.turn('alice', session.id, 'limit'), { status: 429 });
  now += 600001;
  await assert.rejects(voice.turn('alice', session.id, 'expired'), { status: 410 });
  for (let i = 0; i < 5; i++) voice.start('bob');
  assert.throws(() => voice.start('bob'), { status: 429 });
});

test('end and session replacement abort in-flight answers and prevent late replies', async (t) => {
  let finish, signal;
  const voice = service({
    answer: async (_id, _text, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  t.after(() => voice.dispose());
  const first = voice.start('alice');
  const pending = voice.turn('alice', first.id, 'My rental');
  await assert.rejects(voice.turn('alice', first.id, 'duplicate'), { status: 409 });
  voice.start('alice');
  assert.equal(signal.aborted, true);
  finish(reply);
  await assert.rejects(pending, { status: 410 });
});

test('grounded AI voice requests carry bounded history, no storage, cancellation and honest fallback', async (t) => {
  const { answer } = require('../src/modules/support/support.service');
  const before = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
  process.env.OPENAI_API_KEY = 'fixture-only';
  process.env.OPENAI_MODEL = 'fixture-model';
  t.after(() => {
    for (const [key, value] of [
      ['OPENAI_API_KEY', before.key],
      ['OPENAI_MODEL', before.model],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let payload;
  const options = {
    save: false,
    voice: true,
    contextOverride: { rentals: [], wishes: [] },
    history: [{ role: 'user', text: 'My return secret@example.com' }],
    transport: async (_url, request) => {
      payload = JSON.parse(request.body);
      return {
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    answer: 'You can request a return in My rentals. Is it a delivery return?',
                    source_ids: ['return'],
                    needs_human: false,
                  }),
                },
              ],
            },
          ],
        }),
      };
    },
  };
  const result = await answer('alice', 'How do I return?', options);
  assert.equal(result.mode, 'ai_grounded');
  assert.equal(payload.store, false);
  assert.match(payload.instructions, /spoken conversation/);
  assert.doesNotMatch(payload.input, /secret@example/);
  assert.equal(JSON.parse(payload.input).conversation.length, 1);
  const fallback = await answer('alice', 'return', {
    ...options,
    transport: async () => {
      throw Error('provider failure');
    },
  });
  assert.equal(fallback.mode, 'help_library_fallback');
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    answer('alice', 'return', {
      ...options,
      signal: cancelled.signal,
      transport: async () => {
        throw Error('cancelled');
      },
    }),
    { status: 410 },
  );
});
