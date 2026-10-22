'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHandler } = require('./index');

const env = { EMAIL_USER: 'sender@gmail.com', EMAIL_PASS: 'fixture-app-password' };
const event = { version: 1, to: 'student@dbit.co.in', purpose: 'verify', code: '012345', name: 'Student' };

test('sends one normalized college OTP with fixed sender and escaped content over bounded TLS SMTP', async () => {
  let attempts = 0, closes = 0;
  const handler = createHandler({ env, transportFactory: options => {
    assert.equal(options.host, 'smtp.gmail.com');
    assert.equal(options.port, 465);
    assert.equal(options.secure, true);
    assert.equal(options.pool, false);
    assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.connectionTimeout, 6000);
    assert.equal(options.socketTimeout, 10000);
    assert.equal(options.logger, false);
    assert.equal(options.debug, false);
    assert.deepEqual(options.auth, { user: env.EMAIL_USER, pass: env.EMAIL_PASS });
    return {
      close() { closes++; },
      async sendMail(message) {
        attempts++;
        assert.deepEqual(message.from, { name: 'CampusMesh', address: 'sender@gmail.com' });
        assert.deepEqual(message.to, { address: 'student@dbit.co.in' });
        assert.equal(message.subject, 'Verify your CampusMesh email');
        assert.match(message.html, /&lt;Student &amp; &quot;Friend&quot;&gt;/);
        assert.doesNotMatch(message.html, /<Student/);
        assert.match(message.text, /012345/);
        assert.match(message.text, /verify your college email/);
        assert.equal(message.disableFileAccess, true);
        assert.equal(message.disableUrlAccess, true);
        return { accepted: ['student@dbit.co.in'], rejected: [], messageId: '<fixture@gmail.com>' };
      },
    };
  } });
  assert.deepEqual(await handler({ ...event, to: ' STUDENT@DBIT.CO.IN ', name: '<Student & "Friend">' }), { ok: true, messageId: '<fixture@gmail.com>' });
  assert.equal(attempts, 1);
  assert.equal(closes, 1);
});

test('reset purpose creates a fixed reset message and supports an omitted name', async () => {
  const handler = createHandler({ env, transportFactory: () => ({
    async sendMail(message) {
      assert.equal(message.subject, 'Reset your CampusMesh password');
      assert.match(message.text, /Hello there/);
      assert.match(message.text, /reset your CampusMesh password/);
      return { accepted: [event.to], messageId: 'fixture' };
    },
  }) });
  assert.equal((await handler({ ...event, purpose: 'reset', name: undefined })).ok, true);
});

test('rejects non-college recipients, arbitrary mail content and malformed requests before SMTP', async () => {
  const handler = createHandler({ env, transportFactory: () => assert.fail('Invalid input opened SMTP') });
  for (const invalid of [
    null, 'payload', [], { ...event, version: 2 }, { ...event, purpose: 'marketing' },
    { ...event, purpose: '__proto__' }, { ...event, code: 123456 }, { ...event, code: '12345' },
    { ...event, code: '123456\n' }, { ...event, code: '<script>' },
    { ...event, to: 'student@gmail.com' }, { ...event, to: 'student@dbit.co.in.attacker.com' },
    { ...event, to: 'student@dbit.co.in,other@dbit.co.in' }, { ...event, to: [event.to] },
    { ...event, to: 'student@dbit.co.in\r\nBcc: victim@dbit.co.in' },
    { ...event, to: '<student@dbit.co.in>' }, { ...event, to: 'first..last@dbit.co.in' },
    { ...event, subject: 'Arbitrary subject' }, { ...event, html: '<h1>Spam</h1>' },
    { ...event, from: 'attacker@gmail.com' }, { ...event, cc: 'other@dbit.co.in' },
    { ...event, name: 'x'.repeat(121) }, { ...event, name: 'Student\r\nInjected' },
  ]) {
    assert.deepEqual(await handler(invalid), { ok: false, code: 'INVALID_REQUEST', retryable: false });
  }
});

test('missing or unsafe sender configuration fails closed before SMTP', async () => {
  for (const invalidEnv of [{}, { EMAIL_USER: env.EMAIL_USER }, { ...env, EMAIL_PASS: '' }, { ...env, EMAIL_USER: 'Sender <sender@gmail.com>' }, { ...env, EMAIL_USER: 'sender@gmail.com\r\nBcc:victim@gmail.com' }]) {
    const handler = createHandler({ env: invalidEnv, transportFactory: () => assert.fail('Invalid configuration opened SMTP') });
    assert.deepEqual(await handler(event), { ok: false, code: 'CONFIGURATION', retryable: false });
  }
});

test('requires acknowledgement for the exact intended recipient and a valid message identifier', async () => {
  for (const result of [
    undefined, {}, { accepted: [], messageId: 'fixture' },
    { accepted: ['other@dbit.co.in'], messageId: 'fixture' },
    { accepted: [event.to, 'other@dbit.co.in'], messageId: 'fixture' },
    { accepted: [event.to], rejected: ['other@dbit.co.in'], messageId: 'fixture' },
    { accepted: [event.to] }, { accepted: [event.to], messageId: 'injected\r\nvalue' },
  ]) {
    const handler = createHandler({ env, transportFactory: () => ({ sendMail: async () => result }) });
    assert.deepEqual(await handler(event), { ok: false, code: 'DELIVERY_UNCONFIRMED', retryable: false });
  }
});

test('classifies SMTP failures without leaking raw errors or retrying delivery', async () => {
  const cases = [
    [{ code: 'EAUTH', responseCode: 535 }, 'SMTP_AUTHENTICATION', false],
    [{ code: 'EENVELOPE', responseCode: 550 }, 'SMTP_REJECTED', false],
    [{ code: 'EENVELOPE', responseCode: 450 }, 'SMTP_TEMPORARY', true],
    [{ code: 'ETIMEDOUT' }, 'DELIVERY_UNCONFIRMED', false],
    [{ code: 'ECONNECTION' }, 'DELIVERY_UNAVAILABLE', true],
    [{ code: 'unknown' }, 'DELIVERY_UNAVAILABLE', false],
  ];
  for (const [properties, code, retryable] of cases) {
    let attempts = 0, closes = 0;
    const error = Object.assign(new Error(`${event.to} ${event.code} ${env.EMAIL_PASS}`), properties);
    error.response = error.message;
    const handler = createHandler({ env, transportFactory: () => ({
      async sendMail() { attempts++; throw error; },
      close() { closes++; throw new Error('Private SMTP cleanup details'); },
    }) });
    const result = await handler(event);
    assert.deepEqual(result, { ok: false, code, retryable });
    assert.doesNotMatch(JSON.stringify(result), /student@|012345|fixture-app-password|Private SMTP/);
    assert.equal(attempts, 1);
    assert.equal(closes, 1);
  }
});

test('a stalled SMTP send reaches the total deadline, closes once, and does not retry', async () => {
  let attempts = 0, closes = 0;
  const handler = createHandler({ env, deadlineMs: 10, transportFactory: () => ({
    sendMail() { attempts++; return new Promise(() => {}); },
    close() { closes++; },
  }) });
  assert.deepEqual(await handler(event), { ok: false, code: 'DELIVERY_TIMEOUT', retryable: false });
  assert.equal(attempts, 1);
  assert.equal(closes, 1);
});

test('the deadline destroys the owned TLS socket even before the handshake finishes', async () => {
  let destroys = 0;
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.destroy = () => { destroys++; };
  const handler = createHandler({ env, deadlineMs: 10,
    socketFactory: options => {
      assert.equal(options.host, 'smtp.gmail.com');
      assert.equal(options.servername, 'smtp.gmail.com');
      assert.equal(options.port, 465);
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.minVersion, 'TLSv1.2');
      return socket;
    },
    transportFactory: options => ({
      sendMail() {
        options.getSocket({}, () => assert.fail('A stalled handshake unexpectedly completed'));
        return new Promise(() => {});
      },
    }),
  });
  assert.deepEqual(await handler(event), { ok: false, code: 'DELIVERY_TIMEOUT', retryable: false });
  assert.equal(destroys, 1);
});

test('the relay hands Nodemailer an authenticated TLS socket and destroys it after acceptance', async () => {
  let destroys = 0;
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.destroy = () => { destroys++; };
  const handler = createHandler({ env, socketFactory: () => socket,
    transportFactory: options => ({
      sendMail() {
        return new Promise((resolve, reject) => {
          options.getSocket({}, (error, result) => {
            if (error) return reject(error);
            assert.equal(result.secured, true);
            assert.equal(result.connection, socket);
            resolve({ accepted: [event.to], messageId: 'fixture' });
          });
          socket.emit('secureConnect');
        });
      },
    }),
  });
  assert.deepEqual(await handler(event), { ok: true, messageId: 'fixture' });
  assert.equal(destroys, 1);
});
