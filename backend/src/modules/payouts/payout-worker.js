const service = require('./payout-service').createPayoutService();
let busy = false;
async function tick() {
  if (busy) return { busy: true };
  busy = true;
  try {
    return await service.tick();
  } finally {
    busy = false;
  }
}
function start() {
  const timer = globalThis.setInterval(
    () => tick().catch(() => console.error('[payout-worker] Confirmation deferred.')),
    60000,
  );
  timer.unref?.();
  return timer;
}
module.exports = { tick, start };
