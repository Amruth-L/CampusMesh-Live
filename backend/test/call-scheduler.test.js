/* global fetch */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { schedulerRouter } = require('../src/modules/calls/scheduler.routes');
test('external scheduler fails closed and invokes the worker only with its own secret', async () => {
  let runs = 0;
  const app = express();
  app.use(
    schedulerRouter({
      secret: () => 'a'.repeat(48),
      run: async () => {
        runs++;
        return { queued: 0 };
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const request = (authorization) =>
      fetch(`http://127.0.0.1:${server.address().port}/tick`, {
        method: 'POST',
        headers: authorization ? { Authorization: authorization } : {},
      });
    assert.equal((await request()).status, 401);
    assert.equal((await request('Bearer user-jwt')).status, 401);
    assert.equal(runs, 0);
    const response = await request('Bearer ' + 'a'.repeat(48));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(runs, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
