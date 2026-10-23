import test from "node:test";
import assert from "node:assert/strict";
import { AnnouncementPlayer } from "../src/features/voice/announcement-player.js";
const tick = () => new Promise((r) => setTimeout(r, 0));
const item = { id: "booking:1", kind: "booking", rentalId: "1" };
function fixture(fetchAudio = async () => new ArrayBuffer(8)) {
  const sources = [],
    saved = new Map();
  let state;
  class AudioContext {
    state = "suspended";
    async resume() {
      this.state = "running";
    }
    async close() {
      this.state = "closed";
    }
    async decodeAudioData() {
      return {};
    }
    createBufferSource() {
      const s = {
        connect() {},
        disconnect() {},
        start() {
          s.started = true;
        },
        stop() {
          s.stopped = true;
        },
      };
      sources.push(s);
      return s;
    }
  }
  const player = new AnnouncementPlayer({
    browser: { AudioContext },
    onChange: (s) => (state = s),
  });
  const storage = {
    getItem: (k) => saved.get(k),
    setItem: (k, v) => saved.set(k, v),
  };
  player.configure({ storage, scope: "alice", fetchAudio });
  return { player, sources, storage, state: () => state };
}
test("autoplay fallback retains update, then plays once after a gesture and deduplicates polling", async () => {
  const f = fixture();
  f.player.enqueue([item]);
  assert.equal(f.state().phase, "blocked");
  assert.equal(f.sources.length, 0);
  await f.player.prime();
  await tick();
  assert.equal(f.state().phase, "speaking");
  f.player.enqueue([item]);
  assert.equal(f.sources.length, 1);
  f.sources[0].onended();
  f.player.enqueue([item]);
  await tick();
  assert.equal(f.sources.length, 1);
  assert.equal(f.state().phase, "idle");
  f.player.dispose();
});
test("logout/account switch or hidden tab aborts pending audio without late playback", async () => {
  let resolve;
  const f = fixture(() => new Promise((r) => (resolve = r)));
  await f.player.prime();
  f.player.enqueue([item]);
  f.player.pause();
  resolve(new ArrayBuffer(8));
  await tick();
  assert.equal(f.sources.length, 0);
  f.player.configure({
    storage: f.storage,
    scope: "bob",
    fetchAudio: async () => new ArrayBuffer(8),
  });
  assert.equal(f.player.queue.length, 0);
  f.player.dispose();
});
test("mute stops audio and suppresses replay, but other accounts have independent history", async () => {
  const f = fixture();
  await f.player.prime();
  f.player.enqueue([item]);
  await tick();
  f.player.setMuted(true);
  assert.equal(f.sources[0].stopped, true);
  f.player.setMuted(false);
  f.player.enqueue([item]);
  await tick();
  assert.equal(f.sources.length, 1);
  f.player.configure({
    storage: f.storage,
    scope: "bob",
    fetchAudio: async () => new ArrayBuffer(8),
  });
  f.player.enqueue([item]);
  await tick();
  assert.equal(f.sources.length, 2);
  f.player.dispose();
});
test("network failure waits for explicit retry, never marks an unheard update delivered", async () => {
  let fail = true;
  const f = fixture(async () => {
    if (fail) throw Error("offline");
    return new ArrayBuffer(8);
  });
  await f.player.prime();
  f.player.enqueue([item]);
  await tick();
  assert.equal(f.state().phase, "error");
  f.player.enqueue([item]);
  assert.equal(f.player.queue.length, 1);
  fail = false;
  f.player.retry();
  await tick();
  assert.equal(f.state().phase, "speaking");
  f.player.dispose();
});
