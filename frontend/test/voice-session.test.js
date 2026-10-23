import test from "node:test";
import assert from "node:assert/strict";
import {
  VoiceSession,
  voiceCapabilities,
  preferredVoice,
} from "../src/features/voice/voice-session.js";

function fixture(options = {}) {
  const events = [],
    timers = new Map();
  let serial = 0;
  class Recognition {
    constructor() {
      events.push(this);
    }
    start() {
      this.started = true;
    }
    abort() {
      this.aborted = true;
    }
    stop() {
      this.onend?.();
    }
    result(text) {
      const result = [{ transcript: text }];
      result.isFinal = true;
      this.onresult?.({ results: [result] });
      this.onend?.();
    }
  }
  const spoken = [],
    requests = [];
  const browser = {
    isSecureContext: true,
    SpeechRecognition: Recognition,
    SpeechSynthesisUtterance: class {},
    speechSynthesis: {
      getVoices: () => [{ name: "Samantha", lang: "en-US" }],
      speak: (u) => spoken.push(u),
      cancel() {
        this.cancelled = true;
      },
    },
    setTimeout(fn) {
      const id = ++serial;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    ...options.browser,
  };
  const api = {
    async post(path, body, config) {
      requests.push({ path, body, config });
      if (path.endsWith("/sessions"))
        return {
          data: {
            id: "s1",
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            greeting: "Welcome to CampusMesh.",
            aiConfigured: true,
          },
        };
      return {
        data: { answer: "Open My rentals.", mode: "ai_grounded", sources: [] },
      };
    },
    async delete(path, config) {
      requests.push({ path, config, method: "DELETE" });
    },
    ...options.api,
  };
  const states = [];
  const session = new VoiceSession({
    browser,
    api,
    onChange: (state) => states.push(state),
    authorization: "Bearer fixture-signin-token",
  });
  return { session, browser, events, spoken, requests, states, timers };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("explicit start greets without opening mic; speech turn answers once; mute/end release resources", async () => {
  const f = fixture();
  await f.session.start();
  assert.equal(
    f.events.length,
    0,
    "No microphone at login or session greeting",
  );
  assert.equal(f.session.state.phase, "speaking");
  f.session.listen();
  assert.equal(f.session.state.phase, "listening");
  assert.equal(f.events[0].started, true);
  f.events[0].result("When is my item due?");
  await flush();
  assert.equal(f.requests.filter((r) => r.path.endsWith("/turns")).length, 1);
  assert.equal(f.session.state.transcript.at(-1).text, "Open My rentals.");
  f.session.listen();
  const mic = f.events.at(-1);
  f.session.toggleMute();
  assert.equal(mic.aborted, true);
  assert.equal(f.session.state.muted, true);
  f.session.listen();
  assert.equal(f.events.length, 2, "Muted mic cannot restart");
  f.session.toggleMute();
  f.session.listen();
  f.session.end();
  assert.equal(f.events.at(-1).aborted, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.session.state.phase, "ended");
  assert.ok(f.requests.some((r) => r.method === "DELETE"));
  assert.equal(
    f.requests.find((r) => r.method === "DELETE").config.headers.Authorization,
    "Bearer fixture-signin-token",
    "Closing still authenticates after logout removes the stored token",
  );
});

test("denied mic and unsupported speech allow typed answers without silently reopening capture", async () => {
  const f = fixture();
  await f.session.start();
  f.session.listen();
  f.events[0].onerror({ error: "not-allowed" });
  assert.match(f.session.state.error, /denied/);
  assert.equal(f.events[0].aborted, true);
  await f.session.ask("How do I return?");
  assert.equal(f.session.state.transcript.at(-1).mode, "ai_grounded");
  assert.equal(f.events.length, 1);
  f.session.dispose();
  const unsupported = fixture({
    browser: { SpeechRecognition: undefined, speechSynthesis: undefined },
  });
  assert.deepEqual(voiceCapabilities(unsupported.browser), {
    recognition: false,
    speech: false,
  });
  await unsupported.session.start();
  unsupported.session.listen();
  assert.match(unsupported.session.state.error, /supported/);
  await unsupported.session.ask("Returns?");
  assert.equal(unsupported.session.state.phase, "ready");
  unsupported.session.dispose();
});

test("ending during network request ignores late response and does not play it", async () => {
  let resolve;
  const f = fixture();
  await f.session.start();
  const original = f.session.api.post;
  f.session.api.post = (path, body, config) =>
    path.endsWith("/turns")
      ? new Promise((r) => {
          resolve = r;
          f.requestSignal = config.signal;
        })
      : original(path, body, config);
  const question = f.session.ask("Return?");
  const spokenCount = f.spoken.length;
  f.session.end();
  assert.equal(f.requestSignal.aborted, true);
  resolve({ data: { answer: "Late answer", mode: "ai_grounded" } });
  await question;
  assert.equal(f.session.state.phase, "ended");
  assert.equal(f.spoken.length, spokenCount);
  assert.notEqual(f.session.state.transcript.at(-1).text, "Late answer");
});

test("network errors, session expiry and recognition timeouts are recoverable", async () => {
  const f = fixture();
  await f.session.start();
  f.session.listen();
  f.timers.get(f.session.listenTimer)();
  assert.equal(f.events[0].aborted, true);
  assert.match(f.session.state.notice, /30 seconds/);
  f.session.api.post = async () => {
    throw { response: { status: 503, data: { error: "Try again." } } };
  };
  await f.session.ask("Rent?");
  assert.equal(f.session.state.phase, "ready");
  assert.equal(f.session.state.error, "Try again.");
  f.timers.get(f.session.expiry)();
  assert.equal(f.session.state.phase, "ended");
  assert.match(f.session.state.notice, /10-minute/);
});

test("known female English voice is preferred with honest default fallback", () => {
  assert.equal(
    preferredVoice([
      { name: "Other", lang: "en-US" },
      { name: "Veena", lang: "en-IN" },
    ]).name,
    "Veena",
  );
  assert.equal(
    preferredVoice([{ name: "Device voice", lang: "en-US", default: true }])
      .name,
    "Device voice",
  );
  assert.equal(preferredVoice([]), undefined);
});
