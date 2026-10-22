const test = require('node:test');
const assert = require('node:assert/strict');
const { URLSearchParams } = require('node:url');
const express = require('express');
const twilio = require('twilio');

test('accepted Twilio callbacks remain authenticated after selecting Authkey or pausing new calls', async () => {
  const databasePath = require.resolve('../src/config/database');
  const servicePath = require.resolve('../src/modules/calls/call.service');
  const routesPath = require.resolve('../src/modules/calls/call.routes');
  const originalModules = new Map(Object.entries(require.cache));
  const env = {
    CALLS_PROVIDER: 'authkey',
    CALLS_MODE: 'preview',
    CALLS_SCHEDULER_ENABLED: 'false',
    TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
    TWILIO_AUTH_TOKEN: 'fixture-signing-secret-only',
    TWILIO_FROM_NUMBER: '+14155552671',
    TWILIO_TRIAL_MODE: 'false',
    PUBLIC_API_URL: 'https://campusmesh.example.invalid',
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  const twilioId = '11111111-1111-4111-8111-111111111111';
  const authkeyId = '22222222-2222-4222-8222-222222222222';
  const callSid = `CA${'2'.repeat(32)}`;
  const jobs = new Map([
    [twilioId, { id: twilioId, provider: 'twilio', provider_sid: callSid, status: 'SENT' }],
    [authkeyId, { id: authkeyId, provider: 'authkey', provider_sid: 'fixture-authkey-submission', status: 'SENT' }],
  ]);
  const queries = [];
  const fakePool = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.startsWith('UPDATE automated_calls SET status=')) {
        assert.match(sql, /provider='twilio'/, 'Provider status evidence must be scoped to Twilio jobs');
        const job = jobs.get(parameters[0]);
        if (job?.provider !== 'twilio') return { rowCount: 0, rows: [] };
        assert.equal(parameters[2], job.provider_sid);
        job.status = parameters[1];
        return { rowCount: 1, rows: [] };
      }
      if (sql === 'SELECT * FROM automated_calls WHERE id=$1') {
        return { rowCount: 1, rows: [jobs.get(parameters[0])] };
      }
      assert.fail(`Unexpected database operation in callback fixture: ${sql}`);
    },
    connect: async () => { assert.fail('Callback fixtures must not connect to a database'); },
  };
  let server;
  try {
    Object.assign(process.env, env);
    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: fakePool };
    delete require.cache[servicePath];
    delete require.cache[routesPath];
    const router = require('../src/modules/calls/call.routes');
    const { createCallService } = require('../src/modules/calls/call.service');
    const app = express();
    app.use('/api/calls', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const post = (id, kind, body, signature = 'valid') => {
      const path = `/api/calls/webhooks/${id}/${kind}`;
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (signature) headers['X-Twilio-Signature'] = signature === 'valid'
        ? twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, env.PUBLIC_API_URL + path, body)
        : signature;
      return globalThis.fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST', headers, body: new URLSearchParams(body).toString(),
      });
    };
    const completed = { CallSid: callSid, CallStatus: 'completed', SequenceNumber: '1' };

    assert.equal((await post(twilioId, 'status', completed, null)).status, 403);
    assert.equal((await post(twilioId, 'status', completed, 'invalid-signature')).status, 403);
    assert.equal(queries.length, 0, 'Rejected signatures must not read or mutate call records');

    assert.equal((await post(twilioId, 'status', completed)).status, 204);
    assert.equal(jobs.get(twilioId).status, 'COMPLETED');
    assert.equal(queries.length, 1, 'A valid signed callback survives the outbound-provider switch');

    assert.equal((await post(authkeyId, 'status', completed)).status, 204);
    assert.equal(jobs.get(authkeyId).status, 'SENT', 'Twilio cannot supply delivery evidence for an Authkey call');

    const voiceResponse = await post(authkeyId, 'voice', { CallSid: callSid });
    assert.equal(voiceResponse.status, 200);
    const xml = await voiceResponse.text();
    assert.match(xml, /<Hangup\s*\/>/);
    assert.doesNotMatch(xml, /<Say|<Gather/);

    // Exercise the service guard directly too: no preference or private rental
    // lookup may follow a provider mismatch, even with a plausible Twilio SID.
    let serviceQueries = 0;
    const service = createCallService({
      db: { query: async (sql) => {
        serviceQueries += 1;
        assert.equal(sql, 'SELECT * FROM automated_calls WHERE id=$1');
        return { rows: [{ ...jobs.get(authkeyId), provider_sid: callSid }] };
      } },
      providerFactory: () => { assert.fail('A webhook must not create a provider call'); },
      authkeyFactory: () => { assert.fail('A Twilio webhook must not invoke Authkey'); },
    });
    assert.match(await service.voice(authkeyId, { CallSid: callSid }, 'voice'), /<Hangup\s*\/>/);
    assert.equal(serviceQueries, 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    // Restore every module touched while the pool was injected. This also removes
    // newly loaded modules which otherwise retain the fake pool through closures.
    for (const filename of Object.keys(require.cache)) {
      if (!originalModules.has(filename)) delete require.cache[filename];
    }
    for (const [filename, entry] of originalModules) require.cache[filename] = entry;
  }
});
