const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

function workerFixture(t, service) {
  const servicePath = require.resolve('../src/modules/calls/call.service');
  const workerPath = require.resolve('../src/modules/calls/call.worker');
  const originalService = require.cache[servicePath];
  const originalWorker = require.cache[workerPath];
  require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true,
    exports: { createCallService: () => service } };
  delete require.cache[workerPath];
  t.after(() => {
    if (originalService) require.cache[servicePath] = originalService;
    else delete require.cache[servicePath];
    if (originalWorker) require.cache[workerPath] = originalWorker;
    else delete require.cache[workerPath];
  });
  return require('../src/modules/calls/call.worker');
}

test('login wake never starts a provider or queue while calling is unavailable', async t => {
  const worker = workerFixture(t, {
    status: () => ({ configured: false, schedulerEnabled: false }),
    enqueue: async () => assert.fail('Inactive calling reached the database queue'),
    dispatchOne: async () => assert.fail('Inactive calling reached dispatch'),
  });
  assert.equal(worker.requestTick(), false);
  await delay(10);
});

test('concurrent login wakes return immediately and coalesce into one worker pass', async t => {
  let enqueues = 0, dispatches = 0;
  const worker = workerFixture(t, {
    status: () => ({ configured: true, schedulerEnabled: true }),
    enqueue: async () => { enqueues++; return { queued: 0 }; },
    dispatchOne: async () => { dispatches++; return { empty: true }; },
  });
  for (let n = 0; n < 20; n++) assert.equal(worker.requestTick(), true);
  assert.equal(enqueues, 0, 'Authentication must not wait for queue or provider work');
  await delay(20);
  assert.equal(enqueues, 1);
  assert.equal(dispatches, 1);
});

test('sign-ins arriving during an active pass cause one additional pass', async t => {
  let finishFirst, enqueues = 0;
  const first = new Promise(resolve => { finishFirst = resolve; });
  const worker = workerFixture(t, {
    status: () => ({ configured: true, schedulerEnabled: true }),
    enqueue: async () => { if (++enqueues === 1) await first; return { queued: 0 }; },
    dispatchOne: async () => ({ empty: true }),
  });
  const current = worker.tick();
  for (let n = 0; n < 10; n++) worker.requestTick();
  assert.equal(enqueues, 1);
  finishFirst();
  await current;
  await delay(20);
  assert.equal(enqueues, 2);
});
