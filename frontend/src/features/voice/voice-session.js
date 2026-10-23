const initial = () => ({
  phase: "idle",
  session: null,
  transcript: [],
  interim: "",
  muted: false,
  error: "",
  notice: "",
  voiceName: "",
});

export function voiceCapabilities(browser = globalThis) {
  return {
    recognition: Boolean(
      browser.isSecureContext &&
      (browser.SpeechRecognition || browser.webkitSpeechRecognition),
    ),
    speech: Boolean(
      browser.speechSynthesis && browser.SpeechSynthesisUtterance,
    ),
  };
}

export function preferredVoice(voices) {
  const english = voices.filter((v) => /^en(?:[-_]|$)/i.test(v.lang));
  const female = english.filter((v) =>
    /\b(veena|aditi|raveena|samantha|victoria|karen|moira|tessa|serena|susan|zira|aria|jenny|sonia|female)\b/i.test(
      v.name,
    ),
  );
  return (
    female.find((v) => /^en[-_]IN$/i.test(v.lang)) ||
    female[0] ||
    english.find((v) => v.default) ||
    english[0]
  );
}

const recognitionErrors = {
  "not-allowed":
    "Microphone access was denied. Allow it in your browser’s site settings, then try Talk again. You can still type.",
  "service-not-allowed":
    "Speech recognition is blocked in this browser. Try Chrome or Safari, or type below.",
  "audio-capture":
    "No microphone is available. Check your device connection, or type below.",
  network:
    "The speech service could not connect. Check your connection, try Talk again, or type below.",
  "no-speech": "I didn’t hear anything. Tap Talk and try again, or type below.",
  "language-not-supported":
    "English speech recognition is unavailable in this browser. You can type below.",
};

// Keeps browser resources and asynchronous events out of the React view. Every
// operation is invalidated on end/unmount so a late response cannot restart audio.
export class VoiceSession {
  constructor({
    api,
    browser = globalThis,
    onChange = () => {},
    authorization,
  }) {
    this.api = api;
    this.browser = browser;
    this.onChange = onChange;
    // Logout clears localStorage before React unmounts this page. Retain the
    // original authorization only for its best-effort session close request.
    this.closeOptions = authorization
      ? { headers: { Authorization: authorization }, timeout: 5000 }
      : { timeout: 5000 };
    this.state = initial();
    this.generation = 0;
    this.audioGeneration = 0;
    this.audioEnabled = true;
  }
  update(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
  active() {
    return (
      Boolean(this.state.session) &&
      !["ended", "idle", "connecting"].includes(this.state.phase)
    );
  }
  stopListening() {
    this.browser.clearTimeout(this.listenTimer);
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    }
    this.update({ interim: "" });
  }
  stopSpeaking() {
    this.audioGeneration++;
    this.browser.clearTimeout(this.speechTimer);
    this.browser.speechSynthesis?.cancel();
  }
  async start() {
    if (this.state.phase === "connecting" || this.active()) return;
    const generation = ++this.generation;
    this.update({ ...initial(), phase: "connecting" });
    this.request = new AbortController();
    try {
      const { data } = await this.api.post(
        "/api/voice/sessions",
        {},
        { signal: this.request.signal },
      );
      if (generation !== this.generation) {
        this.api
          .delete(`/api/voice/sessions/${data.id}`, this.closeOptions)
          .catch(() => {});
        return;
      }
      this.update({
        session: data,
        phase: "ready",
        transcript: [
          { role: "assistant", text: data.greeting, mode: "greeting" },
        ],
      });
      this.expiry = this.browser.setTimeout(
        () =>
          this.end(
            "The 10-minute session ended. You can start a new conversation.",
          ),
        Math.max(0, new Date(data.expiresAt).getTime() - Date.now()),
      );
      this.speak(data.greeting);
    } catch (error) {
      if (generation === this.generation)
        this.update({
          phase: "error",
          error: this.message(
            error,
            "Could not start voice assistance. Please retry.",
          ),
        });
    }
  }
  message(error, fallback) {
    if ([401, 403].includes(error.response?.status))
      return "Your sign-in needs to be renewed. Sign out and sign in again.";
    return error.response?.data?.error || fallback;
  }
  speak(text) {
    this.stopSpeaking();
    if (!this.audioEnabled || !voiceCapabilities(this.browser).speech) {
      this.update({
        phase: "ready",
        notice: this.audioEnabled
          ? "Speech playback isn’t available. Your reply is shown below."
          : "",
      });
      return;
    }
    const generation = this.generation;
    const audioGeneration = this.audioGeneration;
    const synth = this.browser.speechSynthesis;
    const voice = preferredVoice(synth.getVoices());
    // Short utterances avoid long-paragraph playback stalls in Chromium.
    const chunks = text
      .match(/[^.!?\n]+[.!?]?/g)
      ?.flatMap((part) => part.match(/.{1,200}(?:\s|$)|\S{1,200}/g) || []) || [
      text,
    ];
    let index = 0;
    this.update({
      phase: "speaking",
      voiceName: voice?.name || "Device default English voice",
    });
    const next = () => {
      if (
        generation !== this.generation ||
        audioGeneration !== this.audioGeneration
      )
        return;
      this.browser.clearTimeout(this.speechTimer);
      if (index >= chunks.length) {
        this.update({ phase: "ready" });
        return;
      }
      const utterance = new this.browser.SpeechSynthesisUtterance(
        chunks[index++].trim(),
      );
      utterance.lang = voice?.lang || "en-IN";
      if (voice) utterance.voice = voice;
      utterance.rate = 0.94;
      utterance.pitch = 1.02;
      utterance.volume = 1;
      utterance.onend = next;
      utterance.onerror = () => {
        if (
          generation !== this.generation ||
          audioGeneration !== this.audioGeneration
        )
          return;
        this.stopSpeaking();
        this.update({
          phase: "ready",
          notice:
            "Audio could not play. Read the reply below, or try Replay reply.",
        });
      };
      this.speechTimer = this.browser.setTimeout(
        () => utterance.onerror(),
        30000,
      );
      // Keep a reference: some speech engines otherwise lose their callbacks.
      this.utterance = utterance;
      try {
        synth.speak(utterance);
      } catch {
        utterance.onerror();
      }
    };
    next();
  }
  listen() {
    if (
      !this.active() ||
      this.state.muted ||
      ["thinking", "listening"].includes(this.state.phase)
    )
      return;
    if (!voiceCapabilities(this.browser).recognition) {
      this.update({
        error:
          "Speech recognition isn’t supported here. Use a supported browser over HTTPS, or type below.",
      });
      return;
    }
    this.stopSpeaking();
    this.stopListening();
    const generation = this.generation;
    const Recognition =
      this.browser.SpeechRecognition || this.browser.webkitSpeechRecognition;
    const recognition = new Recognition();
    this.recognition = recognition;
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    let final = "",
      failed = false;
    recognition.onresult = (event) => {
      if (this.recognition !== recognition || generation !== this.generation)
        return;
      let interim = "";
      final = "";
      for (let i = 0; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += text + " ";
        else interim += text + " ";
      }
      this.update({ interim: (final + interim).trim().slice(0, 1500) });
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition || generation !== this.generation)
        return;
      failed = true;
      this.stopListening();
      this.update({
        error:
          recognitionErrors[event.error] ||
          "Speech recognition stopped. Try Talk again, or type below.",
        phase: "ready",
        interim: "",
      });
    };
    recognition.onend = () => {
      if (this.recognition !== recognition || generation !== this.generation)
        return;
      this.recognition = null;
      this.browser.clearTimeout(this.listenTimer);
      this.update({ phase: "ready", interim: "" });
      if (!failed && final.trim()) this.ask(final.trim().slice(0, 1500));
    };
    this.update({ phase: "listening", error: "", notice: "", interim: "" });
    this.listenTimer = this.browser.setTimeout(() => {
      if (this.recognition !== recognition) return;
      this.stopListening();
      this.update({
        phase: "ready",
        notice:
          "Listening paused after 30 seconds. Tap Talk when you’re ready.",
      });
    }, 30000);
    try {
      recognition.start();
    } catch {
      this.stopListening();
      this.update({
        phase: "ready",
        error:
          "The microphone could not start. Check site permissions or type below.",
      });
    }
  }
  finishListening() {
    try {
      this.recognition?.stop();
    } catch {
      this.stopListening();
      this.update({ phase: "ready" });
    }
  }
  toggleMute() {
    if (!this.active()) return;
    const muted = !this.state.muted;
    if (muted) this.stopListening();
    this.update({
      muted,
      ...(this.state.phase === "listening" ? { phase: "ready" } : {}),
    });
  }
  setAudio(enabled) {
    this.audioEnabled = enabled;
    if (!enabled) {
      this.stopSpeaking();
      if (this.state.phase === "speaking") this.update({ phase: "ready" });
    }
  }
  async ask(raw) {
    const message = raw.trim();
    if (
      !this.active() ||
      this.state.phase === "thinking" ||
      !message ||
      message.length > 1500
    )
      return;
    this.stopListening();
    this.stopSpeaking();
    const generation = this.generation;
    this.request = new AbortController();
    this.update({
      phase: "thinking",
      error: "",
      notice: "",
      transcript: [...this.state.transcript, { role: "user", text: message }],
    });
    try {
      const { data } = await this.api.post(
        `/api/voice/sessions/${this.state.session.id}/turns`,
        { message },
        { signal: this.request.signal },
      );
      if (generation !== this.generation) return;
      this.update({
        transcript: [
          ...this.state.transcript,
          {
            role: "assistant",
            text: data.answer,
            mode: data.mode,
            sources: data.sources,
          },
        ],
        notice:
          data.mode === "help_library_fallback"
            ? "The AI service is unavailable. This reply comes from CampusMesh help and your account records."
            : "",
      });
      this.speak(data.answer);
    } catch (error) {
      if (generation !== this.generation) return;
      const message = this.message(
        error,
        "Could not get a reply. Check your connection and try again.",
      );
      if ([401, 403, 410].includes(error.response?.status)) this.end(message);
      else this.update({ phase: "ready", error: message });
    }
  }
  end(notice = "Conversation ended. The microphone is off.") {
    const session = this.state.session;
    this.generation++;
    this.request?.abort();
    this.browser.clearTimeout(this.expiry);
    this.stopListening();
    this.stopSpeaking();
    this.update({
      phase: "ended",
      session: null,
      muted: false,
      notice,
      error: "",
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
