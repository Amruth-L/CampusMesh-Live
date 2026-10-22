const { createCallService } = require('./call.service');
const service = createCallService();
let busy = false;
let requested = false;
let wakeTimer;
function scheduleRequestedTick() {
  if (!requested || busy || wakeTimer) return;
  wakeTimer = setTimeout(() => {
    wakeTimer = undefined;
    requested = false;
    tick().catch((e) => console.error('[call-worker]', e.message));
  }, 0);
  wakeTimer.unref?.();
}
function requestTick() {
  // Disabled providers and preview mode never create background work. Requests
  // arriving during a tick are coalesced into one subsequent pass.
  const status = service.status();
  if (!status.configured || !status.schedulerEnabled) return false;
  requested = true;
  scheduleRequestedTick();
  return true;
}
async function tick() {
  if (busy) return { busy: true };
  busy = true;
  try {
    const result = await service.enqueue();
    const dispatches = [];
    for (let n = 0; n < 5; n++) {
      const r = await service.dispatchOne();
      dispatches.push(r);
      if (r.empty || r.skipped) break;
    }
    return { ...result, dispatches };
  } finally {
    busy = false;
    scheduleRequestedTick();
  }
}
function start() {
  const timer = globalThis.setInterval(
    () => tick().catch((e) => console.error('[call-worker]', e.message)),
    60000,
  );
  timer.unref?.();
  return timer;
}
module.exports = { tick, start, requestTick };
