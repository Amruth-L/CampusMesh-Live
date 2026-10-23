// Deepgram playback only: no microphone or telephone connection.
export class AnnouncementPlayer {
  constructor({ browser = globalThis, onChange = () => {} } = {}) {
    Object.assign(this, { browser, onChange });
    this.queue = [];
    this.seen = new Set();
    this.generation = 0;
    this.paused = true;
    this.muted = false;
  }
  update(phase, message = "") {
    this.phase = phase;
    this.onChange({ phase, message, item: this.queue[0], muted: this.muted });
  }
  async prime() {
    const AudioContext =
      this.browser.AudioContext || this.browser.webkitAudioContext;
    if (!AudioContext || this.muted) return;
    try {
      this.context ||= new AudioContext();
      // Called from a real click/key event. No permission to listen is requested.
      await this.context.resume();
      if (this.phase === "blocked") {
        this.update("idle");
        this.pump();
      }
    } catch {
      /* Tap to hear remains available. */
    }
  }
  configure({ storage, scope, fetchAudio, muted = false }) {
    this.stop();
    Object.assign(this, { storage, scope, fetchAudio, muted });
    this.queue = [];
    this.seen = new Set(this.readSeen());
    this.paused = false;
    this.update("idle");
  }
  readSeen() {
    try {
      const v = JSON.parse(this.storage?.getItem(this.scope) || "[]");
      return Array.isArray(v) ? v.slice(-300) : [];
    } catch {
      return [];
    }
  }
  remember(id) {
    this.seen.add(id);
    try {
      this.storage?.setItem(
        this.scope,
        JSON.stringify(
          [...new Set([...this.readSeen(), ...this.seen])].slice(-300),
        ),
      );
    } catch {
      /* In-memory dedupe remains. */
    }
  }
  enqueue(items) {
    for (const id of this.readSeen()) this.seen.add(id);
    for (const item of items) {
      if (
        !this.seen.has(item.id) &&
        !this.queue.some((x) => x.id === item.id) &&
        this.queue.length < 100
      )
        this.queue.push(item);
    }
    this.pump();
  }
  async pump() {
    if (
      this.paused ||
      this.muted ||
      this.active ||
      !this.queue.length ||
      ["error", "blocked"].includes(this.phase)
    )
      return;
    while (this.queue.length && this.readSeen().includes(this.queue[0].id))
      this.queue.shift();
    const item = this.queue[0];
    if (!item) return this.update("idle");
    if (this.context?.state !== "running")
      return this.update("blocked", "Tap to hear your update.");
    const generation = ++this.generation;
    this.active = true;
    this.request = new AbortController();
    this.update("loading");
    try {
      const bytes = await this.fetchAudio(item, this.request.signal);
      if (generation !== this.generation) return;
      const buffer = await this.context.decodeAudioData(bytes);
      if (generation !== this.generation) return;
      if (this.context.state !== "running") {
        this.active = false;
        return this.update("blocked", "Tap to hear your update.");
      }
      const source = this.context.createBufferSource();
      this.source = source;
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.onended = () => {
        source.disconnect();
        if (generation !== this.generation) return;
        this.active = false;
        this.remember(item.id);
        this.queue.shift();
        this.update("idle");
        this.pump();
      };
      source.start();
      this.update("speaking");
    } catch (e) {
      if (generation !== this.generation) return;
      this.active = false;
      this.update(
        e.name === "NotAllowedError" ? "blocked" : "error",
        "Voice could not play. Your account and booking are unaffected.",
      );
    }
  }
  retry() {
    this.update("idle");
    this.pump();
  }
  stop() {
    ++this.generation;
    this.request?.abort();
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
        this.source.disconnect();
      } catch {
        /* Already ended. */
      }
      this.source = null;
    }
    this.active = false;
  }
  pause() {
    this.paused = true;
    this.stop();
    this.update("idle");
  }
  resume() {
    this.paused = false;
    this.retry();
  }
  dismiss() {
    this.stop();
    if (this.queue[0]) this.remember(this.queue.shift().id);
    this.update("idle");
    this.pump();
  }
  setMuted(value) {
    this.muted = value;
    if (value) {
      this.stop();
      this.queue.forEach((x) => this.remember(x.id));
      this.queue = [];
    }
    this.update("idle");
  }
  dispose() {
    this.pause();
    this.queue = [];
    this.context?.close().catch(() => {});
  }
}
