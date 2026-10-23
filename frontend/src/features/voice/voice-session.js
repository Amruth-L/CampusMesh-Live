import { io } from "socket.io-client";

const initial = () => ({
  phase: "idle",
  session: null,
  transcript: [],
  muted: false,
  error: "",
  notice: "",
});
export function voiceCapabilities(browser = globalThis) {
  return {
    supported: Boolean(
      browser.isSecureContext &&
      browser.navigator?.mediaDevices?.getUserMedia &&
      (browser.AudioContext || browser.webkitAudioContext) &&
      browser.AudioWorkletNode,
    ),
  };
}

// Browser audio transport only. Deepgram performs recognition, reasoning and TTS.
export class VoiceSession {
  constructor({
    api,
    browser = globalThis,
    onChange = () => {},
    authorization,
    socketFactory = io,
  }) {
    Object.assign(this, { api, browser, onChange, socketFactory });
    this.token = authorization?.replace(/^Bearer\s+/i, "");
    this.closeOptions = {
      headers: { Authorization: authorization },
      timeout: 5000,
    };
    this.state = initial();
    this.generation = 0;
    this.sources = new Set();
    this.audioEnabled = true;
  }
  update(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
  active() {
    return Boolean(this.state.session) || this.state.phase === "connecting";
  }
  async start() {
    if (this.active()) return;
    if (!voiceCapabilities(this.browser).supported) {
      this.update({
        phase: "error",
        error:
          "Voice needs a browser with microphone and Web Audio support over HTTPS. Use text Support instead.",
      });
      return;
    }
    const generation = ++this.generation;
    this.update({ ...initial(), phase: "connecting" });
    this.request = new AbortController();
    try {
      const AudioContext =
        this.browser.AudioContext || this.browser.webkitAudioContext;
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      const stream = await this.browser.navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !this.state.muted;
        track.onended = () =>
          this.end(
            "The microphone disconnected. Check your device and start again.",
          );
      });
      await context.audioWorklet.addModule("/audio/voice-capture.js");
      if (generation !== this.generation) return;
      this.capture = new this.browser.AudioWorkletNode(
        context,
        "campusmesh-voice-capture",
      );
      this.input = context.createMediaStreamSource(stream);
      this.silent = context.createGain();
      this.silent.gain.value = 0;
      this.input.connect(this.capture);
      this.capture.connect(this.silent);
      this.silent.connect(context.destination);
      const { data } = await this.api.post(
        "/api/voice/sessions",
        {},
        { signal: this.request.signal, timeout: 15000 },
      );
      if (generation !== this.generation) {
        this.api
          .delete(`/api/voice/sessions/${data.id}`, this.closeOptions)
          .catch(() => {});
        return;
      }
      this.update({ session: data });
      const base = (
        this.api.defaults?.baseURL || this.browser.location.origin
      ).replace(/\/$/, "");
      const socket = this.socketFactory(`${base}/voice`, {
        auth: {
          token: this.token,
          sessionId: data.id,
          sampleRate: context.sampleRate,
        },
        transports: ["websocket"],
        reconnection: false,
        autoConnect: false,
        timeout: 15000,
        forceNew: true,
      });
      this.socket = socket;
      let ready = false;
      const current = () => generation === this.generation;
      this.capture.port.onmessage = ({ data: pcm }) => {
        if (current() && ready && socket.connected && !this.state.muted)
          socket.volatile.emit("voice:audio", pcm);
      };
      socket.on("voice:ready", ({ expiresAt }) => {
        if (!current()) return;
        ready = true;
        this.browser.clearTimeout(this.connectTimer);
        this.update({ phase: "listening" });
        this.expiry = this.browser.setTimeout(
          () => this.end("The 10-minute session ended. You can start another."),
          Math.max(0, expiresAt - Date.now()),
        );
      });
      socket.on("voice:audio", (pcm) => {
        if (current() && ready) this.play(pcm);
      });
      socket.on("voice:event", (event) => {
        if (current() && ready) this.event(event);
      });
      socket.on("voice:notice", ({ message }) => {
        if (current()) this.update({ notice: message, phase: "listening" });
      });
      socket.on("voice:error", ({ message }) => {
        if (current()) this.fail(message);
      });
      socket.on("voice:ended", ({ message }) => {
        if (current()) this.end(message);
      });
      socket.on("connect_error", (error) => {
        if (current())
          this.fail(
            error.message?.startsWith("Sign in")
              ? error.message
              : "Could not connect to voice. Check your connection and try again.",
          );
      });
      socket.on("disconnect", () => {
        if (current())
          this.fail("The voice connection was lost. Please start again.");
      });
      this.connectTimer = this.browser.setTimeout(
        () => this.fail("Voice took too long to connect. Please try again."),
        25000,
      );
      socket.connect();
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(
        error.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser’s site settings, or use text Support."
          : error.name === "NotFoundError"
            ? "No microphone was found. Connect one or use text Support."
            : error.response?.data?.error ||
              "Could not start voice. Check your microphone and connection, then retry.",
      );
    }
  }
  event(event) {
    if (event.type === "UserStartedSpeaking") {
      this.stopPlayback();
      this.update({ phase: "listening", notice: "" });
    } else if (event.type === "AgentThinking")
      this.update({ phase: "thinking" });
    else if (event.type === "AgentStartedSpeaking")
      this.update({ phase: "speaking" });
    else if (event.type === "AgentAudioDone") {
      // The last PCM buffer may still be playing after the provider finishes sending.
      if (!this.sources.size) this.update({ phase: "listening" });
    } else if (event.type === "ConversationText") {
      this.update({
        transcript: [
          ...this.state.transcript,
          { role: event.role, text: event.content },
        ].slice(-80),
      });
    }
  }
  play(data) {
    if (!this.audioEnabled || !this.context) return;
    const bytes =
      data instanceof ArrayBuffer
        ? data
        : data.buffer?.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          );
    if (!bytes || bytes.byteLength % 2) return;
    const pcm = new Int16Array(bytes);
    if (!pcm.length) return;
    const context = this.context;
    if (context.state !== "running") {
      this.fail("Audio playback paused. Start again to resume voice.");
      return;
    }
    if ((this.nextAudio || 0) - context.currentTime > 15) {
      this.fail("Audio playback fell behind. Please reconnect.");
      return;
    }
    const buffer = context.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const at = Math.max(context.currentTime, this.nextAudio || 0);
    this.nextAudio = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (!this.sources.size && this.state.phase === "speaking")
        this.update({ phase: "listening" });
    };
    source.start(at);
    this.update({ phase: "speaking" });
  }
  stopPlayback() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
        source.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextAudio = 0;
  }
  toggleMute() {
    if (!this.active()) return;
    const muted = !this.state.muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.update({ muted });
  }
  setAudio(enabled) {
    this.audioEnabled = enabled;
    if (!enabled) this.stopPlayback();
  }
  ask(raw) {
    const content = raw.trim();
    if (
      !this.socket?.connected ||
      !content ||
      content.length > 1500 ||
      this.state.phase !== "listening"
    )
      return;
    this.update({ phase: "thinking", notice: "" });
    this.socket.emit("voice:text", content);
  }
  fail(message) {
    this.end();
    this.update({ phase: "error", error: message, notice: "" });
  }
  end(notice = "Conversation ended. The microphone is off.") {
    const session = this.state.session;
    this.generation++;
    this.request?.abort();
    this.browser.clearTimeout(this.expiry);
    this.browser.clearTimeout(this.connectTimer);
    this.socket?.removeAllListeners();
    this.socket?.emit("voice:end");
    this.socket?.disconnect();
    this.socket = null;
    this.stopPlayback();
    if (this.capture) this.capture.port.onmessage = null;
    for (const node of [this.input, this.capture, this.silent])
      node?.disconnect();
    this.input = this.capture = this.silent = null;
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = null;
    this.context?.close().catch(() => {});
    this.context = null;
    this.update({
      phase: "ended",
      session: null,
      muted: false,
      error: "",
      notice,
    });
    if (session)
      this.api
        .delete(`/api/voice/sessions/${session.id}`, this.closeOptions)
        .catch(() => {});
  }
  dispose() {
    this.onChange = () => {};
    this.end();
  }
}
