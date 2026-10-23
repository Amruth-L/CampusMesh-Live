/* global AbortController, setInterval, clearInterval */
const { randomUUID } = require('node:crypto');

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const greeting =
  "Hello! Welcome to CampusMesh. I'm your automated assistant. I can help with renting, lending, deliveries and your rental status. What would you like help with?";

// Conversations are deliberately temporary, bounded and owned by the signed-in user.
// A restart ends sessions; no audio or transcript is written to the database.
function createVoiceService({
  answer,
  redact,
  clock = Date.now,
  settings = () => ({
    enabled: process.env.BROWSER_VOICE_ENABLED !== 'false',
    aiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
  }),
} = {}) {
  const sessions = new Map();
  const usage = new Map();
  const durationMs = 10 * 60 * 1000;
  function remove(id) {
    sessions.get(id)?.controller?.abort();
    sessions.delete(id);
  }
  function prune() {
    const now = clock();
    for (const [id, session] of sessions) if (session.expiresAt <= now) remove(id);
    for (const [id, entry] of usage) if (entry.until <= now) usage.delete(id);
  }
  const cleanup = setInterval(prune, 60000);
  cleanup.unref?.();
  function capabilities() {
    return { ...settings(), sessionSeconds: durationMs / 1000, maxTurns: 30, language: 'en-IN' };
  }
  function owned(userId, id) {
    prune();
    const session = sessions.get(id);
    if (!session || session.userId !== userId)
      fail(410, 'This voice session ended. Start a new conversation.');
    return session;
  }
  function start(userId) {
    prune();
    if (!settings().enabled) fail(503, 'Voice assistance is temporarily unavailable. Please use Support.');
    const now = clock();
    const entry = usage.get(userId) || { starts: 0, until: now + 10 * 60000 };
    if (entry.starts >= 5) fail(429, 'Please wait a few minutes before starting another conversation.');
    if (sessions.size >= 200 || (!usage.has(userId) && usage.size >= 1000))
      fail(503, 'Voice assistance is busy. Please try again shortly.');
    for (const [id, session] of sessions) if (session.userId === userId) remove(id);
    entry.starts++;
    usage.set(userId, entry);
    const id = randomUUID();
    const session = { userId, expiresAt: now + durationMs, history: [], turns: 0, recent: [], busy: false };
    sessions.set(id, session);
    return { id, expiresAt: new Date(session.expiresAt).toISOString(), greeting, ...capabilities() };
  }
  async function turn(userId, id, message) {
    if (!settings().enabled) {
      remove(id);
      fail(503, 'Voice assistance is temporarily unavailable.');
    }
    const session = owned(userId, id);
    if (typeof message !== 'string' || !message.trim() || message.length > 1500)
      fail(400, 'Ask a question of 1–1500 characters.');
    if (session.busy) fail(409, 'Please wait for the current reply.');
    if (session.turns >= 30) fail(429, 'This conversation reached its limit. End it and start another.');
    session.recent = session.recent.filter((t) => t > clock() - 60000);
    if (session.recent.length >= 10) fail(429, 'Please wait a minute before asking another question.');
    session.recent.push(clock());
    session.busy = true;
    session.controller = new AbortController();
    try {
      const reply = await answer(userId, message, {
        save: false,
        voice: true,
        history: session.history,
        signal: session.controller.signal,
      });
      if (sessions.get(id) !== session || session.expiresAt <= clock())
        fail(410, 'This voice session ended. Start a new conversation.');
      session.turns++;
      session.history = [
        ...session.history,
        { role: 'user', text: redact(message) },
        { role: 'assistant', text: redact(reply.answer, 1200) },
      ].slice(-8);
      return {
        answer: reply.answer,
        mode: reply.mode,
        sources: reply.sources,
        turnsRemaining: 30 - session.turns,
      };
    } finally {
      session.busy = false;
      session.controller = null;
    }
  }
  function end(userId, id) {
    // Same response for missing and other people's IDs: no session enumeration.
    if (sessions.get(id)?.userId === userId) remove(id);
  }
  return {
    capabilities,
    start,
    turn,
    end,
    dispose() {
      clearInterval(cleanup);
      for (const id of sessions.keys()) remove(id);
      usage.clear();
    },
  };
}
module.exports = { createVoiceService };
