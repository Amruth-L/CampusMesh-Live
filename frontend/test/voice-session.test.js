import test from "node:test";
import assert from "node:assert/strict";
import {
  VoiceSession,
  voiceCapabilities,
} from "../src/features/voice/voice-session.js";

function fixture({ denied = false, pendingMic = false } = {}) {
  const track = {
    enabled: true,
    stop() {
      this.stopped = true;
    },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let releaseMic, audioContext;
  const node = () => ({
    connect() {},
    disconnect() {
      this.disconnected = true;
    },
  });
  class Context {
    constructor() {
      Object.assign(this, {
        state: "running",
        sampleRate: 48000,
        currentTime: 1,
        destination: {},
        audioWorklet: { addModule: async () => {} },
      });
      audioContext = this;
    }
    async resume() {}
    async close() {
      this.closed = true;
    }
    createMediaStreamSource() {
      return node();
    }
    createGain() {
      return { ...node(), gain: {} };
    }
    createBuffer(_channels, length, rate) {
      return {
        duration: length / rate,
        getChannelData: () => new Float32Array(length),
      };
    }
    createBufferSource() {
      return {
        ...node(),
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
      };
    }
  }
  class Worklet {
    constructor() {
      Object.assign(this, node(), { port: {} });
    }
  }
  const timers = new Map();
  let next = 0;
  const browser = {
    isSecureContext: true,
    location: { origin: "https://fixture" },
    AudioContext: Context,
    AudioWorkletNode: Worklet,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          if (denied)
            throw Object.assign(Error("denied"), { name: "NotAllowedError" });
          if (pendingMic)
            return new Promise((resolve) => {
              releaseMic = () => resolve(stream);
            });
          return stream;
        },
      },
    },
    setTimeout(fn) {
      timers.set(++next, fn);
      return next;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const handlers = new Map(),
    outgoing = [],
    closed = [];
  const socket = {
    connected: false,
    on(name, fn) {
      handlers.set(name, fn);
    },
    emit(name, data) {
      outgoing.push([name, data]);
    },
    connect() {
      this.connected = true;
    },
    disconnect() {
      this.connected = false;
    },
    removeAllListeners() {
      handlers.clear();
    },
  };
  socket.volatile = socket;
  let connections = 0;
  const session = new VoiceSession({
    browser,
    authorization: "Bearer fixture-jwt",
    api: {
      defaults: { baseURL: "https://fixture" },
      post: async () => ({ data: { id: "ticket" } }),
      delete: async (path, options) => {
        closed.push([path, options]);
      },
    },
    socketFactory(url, options) {
      connections++;
      assert.equal(url, "https://fixture/voice");
      assert.equal(options.auth.token, "fixture-jwt");
      assert.equal(options.auth.sampleRate, 48000);
      return socket;
    },
  });
  const receive = (name, data) => handlers.get(name)?.(data);
  return {
    session,
    browser,
    track,
    stream,
    socket,
    outgoing,
    closed,
    timers,
    receive,
    context: () => audioContext,
    release: () => releaseMic(),
    connections: () => connections,
  };
}

test("streams only after provider readiness, mutes mic, plays provider PCM and interrupts", async () => {
  const f = fixture();
  await f.session.start();
  assert.equal(f.session.state.phase, "connecting");
  f.session.capture.port.onmessage({ data: new ArrayBuffer(2048) });
  assert.equal(f.outgoing.length, 0);
  f.receive("voice:ready", { expiresAt: Date.now() + 600000 });
  f.session.capture.port.onmessage({ data: new ArrayBuffer(2048) });
  assert.equal(f.outgoing[0][0], "voice:audio");
  f.session.toggleMute();
  assert.equal(f.track.enabled, false);
  f.session.capture.port.onmessage({ data: new ArrayBuffer(2048) });
  assert.equal(f.outgoing.length, 1);
  f.session.toggleMute();
  assert.equal(f.track.enabled, true);
  f.receive("voice:audio", new Int16Array([1000, -1000]).buffer);
  const source = [...f.session.sources][0];
  assert.equal(source.started, true);
  f.receive("voice:event", { type: "UserStartedSpeaking" });
  assert.equal(source.stopped, true);
  assert.equal(f.session.sources.size, 0);
  f.receive("voice:event", {
    type: "ConversationText",
    role: "user",
    content: "My rental?",
  });
  assert.equal(f.session.state.transcript[0].text, "My rental?");
  f.session.ask("When is it due?");
  assert.deepEqual(f.outgoing.at(-1), ["voice:text", "When is it due?"]);
  f.session.end();
  assert.equal(f.track.stopped, true);
  assert.equal(f.context().closed, true);
  assert.equal(f.socket.connected, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.closed[0][1].headers.Authorization, "Bearer fixture-jwt");
});

test("permission denial never connects provider and closes audio resources", async () => {
  const f = fixture({ denied: true });
  await f.session.start();
  assert.equal(f.connections(), 0);
  assert.equal(f.session.state.phase, "error");
  assert.match(f.session.state.error, /denied/);
  assert.equal(f.context().closed, true);
});

test("ending while permission is pending stops late microphone stream and never connects", async () => {
  const f = fixture({ pendingMic: true });
  const pending = f.session.start();
  await Promise.resolve();
  await Promise.resolve();
  f.session.end();
  f.release();
  await pending;
  assert.equal(f.track.stopped, true);
  assert.equal(f.connections(), 0);
  assert.equal(f.session.state.phase, "ended");
});

test("network failure and expiry stop mic and prevent late speech", async () => {
  const f = fixture();
  await f.session.start();
  f.receive("voice:ready", { expiresAt: Date.now() + 600000 });
  f.receive("disconnect");
  assert.equal(f.session.state.phase, "error");
  assert.equal(f.track.stopped, true);
  f.receive("voice:audio", new ArrayBuffer(400));
  assert.equal(f.session.sources.size, 0);
  const g = fixture();
  await g.session.start();
  g.receive("voice:ready", { expiresAt: Date.now() + 600000 });
  [...g.timers.values()][0]();
  assert.equal(g.session.state.phase, "ended");
  assert.equal(g.track.stopped, true);
});

test("unsupported browsers do not request audio; playback can be muted separately", async () => {
  assert.equal(voiceCapabilities({}).supported, false);
  const f = fixture();
  f.browser.isSecureContext = false;
  await f.session.start();
  assert.match(f.session.state.error, /HTTPS/);
  assert.equal(f.connections(), 0);
  const g = fixture();
  await g.session.start();
  g.receive("voice:ready", { expiresAt: Date.now() + 600000 });
  g.session.setAudio(false);
  g.receive("voice:audio", new ArrayBuffer(400));
  assert.equal(g.session.sources.size, 0);
  assert.equal(g.track.enabled, true);
  g.session.dispose();
  assert.equal(g.track.stopped, true);
});
