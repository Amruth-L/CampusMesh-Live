const test = require('node:test');
const assert = require('node:assert/strict');
const { URL } = require('node:url');
const { Response, AbortSignal, DOMException } = globalThis;
const { createAuthkeyClient, supportsPhone } = require('../src/modules/calls/authkey.client');

const key = 'private_authkey_test_only';
const phone = '+919000000001';
const id = '28bf7375bb54540ba03a4eb873d4da44';
const ack = { LogID: id, Message: 'Submitted Successfully' };
const config = { authkeyApiKey: key, authkeyOtpTemplateId: '1001' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fixture(body = ack, options = {}) {
  const requests = [];
  const client = createAuthkeyClient({ ...config, ...options.config }, {
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      if (options.error) throw options.error;
      return response(body, options.status);
    },
  });
  return { client, requests };
}

test('only canonical Indian mobile numbers are accepted', () => {
  for (const number of ['+916000000000', '+917000000000', '+918000000000', '+919000000000']) assert.equal(supportsPhone(number), true);
  for (const number of ['+14155552671', '+915000000000', '9000000001', '+919000000001 ', null, 9000000001]) assert.equal(supportsPhone(number), false);
});

test('voice submission encodes text as one parameter and acknowledges submission only', async () => {
  const { client, requests } = fixture();
  const text = "CampusMesh: A & B's rental? Due +4 days. ₹100";
  assert.deepEqual(await client.sendVoice({ to: phone, text }), { id });
  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(url.origin, 'https://api.authkey.io');
  assert.equal(url.pathname, '/request');
  assert.equal(url.searchParams.get('authkey'), key);
  assert.equal(url.searchParams.get('mobile'), '9000000001');
  assert.equal(url.searchParams.get('country_code'), '91');
  assert.equal(url.searchParams.get('voice'), text);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['authkey', 'country_code', 'mobile', 'voice']);
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.ok(init.signal instanceof AbortSignal);
});

test('approved message template does not add SMS, fallback, events or billing actions', async () => {
  const { client, requests } = fixture(ack, { config: { authkeyVoiceTemplateId: '1002' } });
  await client.sendVoice({ to: phone, text: 'Welcome to CampusMesh.' });
  const params = requests[0].url.searchParams;
  assert.deepEqual([...params.keys()].sort(), ['authkey', 'country_code', 'message', 'mobile', 'vid']);
  assert.equal(params.get('vid'), '1002');
  assert.equal(params.get('message'), 'Welcome to CampusMesh.');
});

test('voice OTP sends approved 2FA template by POST and checks the server-held session', async () => {
  const { client, requests } = fixture();
  assert.deepEqual(await client.sendVerification(phone), { id });
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].url.searchParams.get('vid'), '1001');
  assert.equal(requests[0].url.searchParams.has('voice'), false);
  const verified = fixture({ status: true, message: 'Valid OTP' });
  assert.equal(await verified.client.checkVerification(id, '123456'), true);
  assert.equal(verified.requests[0].url.origin, 'https://console.authkey.io');
  assert.equal(verified.requests[0].url.pathname, '/api/2fa_verify.php');
  assert.equal(verified.requests[0].url.searchParams.get('channel'), 'voice');
  assert.equal(verified.requests[0].url.searchParams.get('logid'), id);
  assert.equal(verified.requests[0].url.searchParams.get('otp'), '123456');
});

test('phone verification accepts only literal boolean success, not truthy strings', async () => {
  assert.equal(await fixture({ status: false }).client.checkVerification(id, '123456'), false);
  for (const body of [{ status: 'true' }, { status: 1 }, { message: 'Valid OTP' }, ack]) {
    await assert.rejects(fixture(body).client.checkVerification(id, '123456'), { code: 'AUTHKEY_OUTCOME_UNKNOWN', definite: false });
  }
});

test('missing key, invalid recipient, bad template or invalid code never contact a provider', async () => {
  const cases = [
    [{ authkeyApiKey: '' }, (c) => c.sendVoice({ to: phone, text: 'Welcome' })],
    [{}, (c) => c.sendVoice({ to: '+14155552671', text: 'Welcome' })],
    [{}, (c) => c.sendVoice({ to: phone, text: '' })],
    [{}, (c) => c.sendVoice({ to: phone, text: 'x'.repeat(1601) })],
    [{ authkeyVoiceTemplateId: '1001&sms=bad' }, (c) => c.sendVoice({ to: phone, text: 'Welcome' })],
    [{ authkeyOtpTemplateId: '' }, (c) => c.sendVerification(phone)],
    [{}, (c) => c.checkVerification('fake', '123456')],
    [{}, (c) => c.checkVerification(id, '1234&x=1')],
  ];
  for (const [override, invoke] of cases) {
    const { client, requests } = fixture(ack, { config: override });
    await assert.rejects(invoke(client), { definite: true });
    assert.equal(requests.length, 0);
  }
});

test('submission needs acknowledgement and a safe ID, not just HTTP 200', async () => {
  for (const body of [{}, { LogID: id }, { ...ack, LogID: '' }, { ...ack, LogID: '<script>bad</script>' }, { ...ack, Message: 'Rejected' }, { ...ack, status: false }, { ...ack, success: false }, { ...ack, code: 500 }, []]) {
    const { client, requests } = fixture(body);
    await assert.rejects(client.sendVoice({ to: phone, text: 'Welcome' }), { code: 'AUTHKEY_OUTCOME_UNKNOWN', definite: false });
    assert.equal(requests.length, 1);
  }
});

test('explicit rejection is distinguished from an unknown provider outcome', async () => {
  for (const status of [400, 401, 403, 429]) {
    await assert.rejects(fixture({ error: 'private provider details' }, { status }).client.sendVoice({ to: phone, text: 'Welcome' }), { code: 'AUTHKEY_REJECTED', definite: true });
  }
  for (const body of [{ status: false }, { success: false }, { code: 402 }]) {
    await assert.rejects(fixture(body).client.sendVerification(phone), { code: 'AUTHKEY_REJECTED', definite: true });
  }
  for (const status of [500, 502, 503]) {
    const { client, requests } = fixture({}, { status });
    await assert.rejects(client.sendVerification(phone), { code: 'AUTHKEY_OUTCOME_UNKNOWN', definite: false });
    assert.equal(requests.length, 1);
  }
});

test('transport failure or timeout never retries or exposes a URL, key, phone or OTP', async () => {
  for (const error of [new TypeError(`GET https://api.authkey.io/request?authkey=${key}&mobile=${phone}&otp=123456`), new DOMException('Timed out with private data', 'TimeoutError')]) {
    const { client, requests } = fixture({}, { error });
    await assert.rejects(client.sendVerification(phone), (caught) => {
      assert.equal(caught.definite, false);
      assert.equal(caught.code, 'AUTHKEY_OUTCOME_UNKNOWN');
      const all = `${caught.stack} ${JSON.stringify(caught)}`;
      for (const secret of [key, phone, '123456', 'https://api.authkey.io', 'private data']) assert.equal(all.includes(secret), false);
      assert.equal(caught.cause, undefined);
      return true;
    });
    assert.equal(requests.length, 1);
  }
});

test('malformed or oversized responses stay unknown without leaking provider content', async () => {
  for (const raw of [`secret ${key} ${phone}`, 'x'.repeat(16385), 'null', '"string"']) {
    let requests = 0;
    const client = createAuthkeyClient(config, { fetchImpl: async () => { requests += 1; return new Response(raw); } });
    await assert.rejects(client.sendVoice({ to: phone, text: 'Welcome' }), (error) => {
      assert.equal(error.code, 'AUTHKEY_OUTCOME_UNKNOWN');
      assert.equal(error.definite, false);
      assert.equal(error.message.includes(key), false);
      assert.equal(error.message.includes(phone), false);
      return true;
    });
    assert.equal(requests, 1);
  }
});
