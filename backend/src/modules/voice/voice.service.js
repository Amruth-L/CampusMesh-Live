/* global setInterval, clearInterval, clearTimeout */
const { randomUUID } = require('node:crypto');
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

// One-use session tickets keep the provider key and configuration on the server.
function createVoiceService({
  clock = Date.now,
  settings = () => ({
    enabled: process.env.BROWSER_VOICE_ENABLED !== 'false',
    aiConfigured: Boolean(process.env.DEEPGRAM_API_KEY?.trim()),
  }),
} = {}) {
  const sessions = new Map(),
    usage = new Map();
  const durationMs = 10 * 60000;
  function remove(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    clearTimeout(session.timer);
    session.close?.();
  }
  function prune() {
    for (const [id, s] of sessions) if (s.expiresAt <= clock()) remove(id);
    for (const [id, u] of usage) if (u.until <= clock()) usage.delete(id);
  }
  const cleanup = setInterval(prune, 30000);
  cleanup.unref?.();
  function capabilities() {
    const config = settings();
    return {
      enabled: Boolean(config.enabled),
      aiConfigured: Boolean(config.aiConfigured),
      provider: 'deepgram',
      sessionSeconds: 600,
      maxTurns: 30,
      language: 'en',
    };
  }
  function start(userId) {
    prune();
    const config = capabilities();
    if (!config.enabled || !config.aiConfigured)
      fail(503, 'Deepgram voice is not configured yet. Please use text Support for now.');
    const entry = usage.get(userId) || { starts: 0, until: clock() + 10 * 60000 };
    if (entry.starts >= 5) fail(429, 'Please wait a few minutes before starting another conversation.');
    if (sessions.size >= 10 || (!usage.has(userId) && usage.size >= 1000))
      fail(503, 'Voice assistance is busy. Please try again shortly.');
    for (const [id, s] of sessions) if (s.userId === userId) remove(id);
    entry.starts++;
    usage.set(userId, entry);
    const id = randomUUID();
    const session = { userId, expiresAt: clock() + 30000, claimed: false };
    sessions.set(id, session);
    return { id, ...config };
  }
  function claim(userId, id, close, authExpiresAt) {
    prune();
    const session = sessions.get(id);
    if (!session || session.userId !== userId || session.claimed)
      fail(410, 'This voice session ended. Start a new conversation.');
    if (!capabilities().enabled || !capabilities().aiConfigured) fail(503, 'Voice is unavailable.');
    session.claimed = true;
    session.close = close;
    session.expiresAt = Math.min(clock() + durationMs, authExpiresAt || Infinity);
    if (session.expiresAt <= clock()) {
      remove(id);
      fail(401, 'Please sign in again.');
    }
    session.timer = setTimeout(() => remove(id), session.expiresAt - clock());
    session.timer.unref?.();
    return { expiresAt: session.expiresAt };
  }
  function end(userId, id) {
    if (sessions.get(id)?.userId === userId) remove(id);
  }
  return {
    capabilities,
    start,
    claim,
    end,
    dispose() {
      clearInterval(cleanup);
      for (const id of sessions.keys()) remove(id);
      usage.clear();
    },
  };
}
// HTTP and Socket.IO must share the same ticket registry.
const voiceService = createVoiceService();
module.exports = { createVoiceService, voiceService };
