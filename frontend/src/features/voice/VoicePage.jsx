import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Headphones, Mic, MicOff, PhoneOff, Send } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { VoiceSession, voiceCapabilities } from "./voice-session";

const phaseLabels = {
  idle: "Ready when you are",
  connecting: "Starting your session…",
  ready: "Ready",
  listening: "Listening…",
  thinking: "Finding your answer…",
  speaking: "Assistant speaking",
  ended: "Session ended",
  error: "Could not connect",
};

export default function VoicePage() {
  const { api, user, token } = useAuth();
  const [state, setState] = useState({
    phase: "idle",
    transcript: [],
    muted: false,
  });
  const [capabilities, setCapabilities] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [audio, setAudio] = useState(true);
  const controller = useRef(null);
  const bottom = useRef(null);
  const browser = voiceCapabilities(window);

  useEffect(() => {
    const session = new VoiceSession({
      api,
      browser: window,
      onChange: setState,
      authorization: token ? `Bearer ${token}` : undefined,
    });
    controller.current = session;
    const hidden = () => {
      if (document.hidden && session.active())
        session.end(
          "Session ended when you left this tab. Start again when you’re ready.",
        );
    };
    const offline = () =>
      session.end(
        "Your connection was lost. Reconnect and start a new session.",
      );
    const pagehide = () => session.end();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", pagehide);
    return () => {
      session.dispose();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [api, user?.id, token]);

  useEffect(() => {
    const request = new AbortController();
    api
      .get("/api/voice/capabilities", { signal: request.signal })
      .then(({ data }) => setCapabilities(data))
      .catch((error) => {
        if (!request.signal.aborted)
          setLoadError(
            error.response?.data?.error ||
              "Could not check voice availability. Reload this page to retry.",
          );
      });
    return () => request.abort();
  }, [api]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [state.transcript.length]);

  const active = Boolean(state.session) || state.phase === "connecting";
  const busy = state.phase !== "listening";
  const start = () => {
    controller.current.setAudio(audio);
    controller.current.start();
  };
  const submit = (event) => {
    event.preventDefault();
    if (!text.trim() || busy || !active) return;
    controller.current.ask(text);
    setText("");
  };
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 pb-28 sm:px-6 lg:py-12">
      <Link
        to="/support"
        className="text-sm font-semibold text-mesh-700 underline underline-offset-4"
      >
        Text help
      </Link>
      <div className="mt-6 max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          Talk to CampusMesh
        </h1>
        <p className="mt-3 leading-7 text-ink/70">
          Ask about rentals, returns or deliveries.
        </p>
      </div>
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section
          className="min-w-0 overflow-hidden rounded-2xl border border-ink/10 bg-white"
          aria-label="Voice conversation"
        >
          <div className="border-b border-ink/10 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-mesh-50 text-mesh-700">
                <Headphones size={24} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p role="status" className="font-bold">
                  {state.muted && state.phase === "listening"
                    ? "Microphone muted — you can still type"
                    : phaseLabels[state.phase]}
                </p>
                <p className="mt-1 text-xs leading-5 text-ink/60">
                  {capabilities
                    ? capabilities.aiConfigured
                      ? "Powered by Deepgram Voice Agent"
                      : "Deepgram setup is pending"
                    : "Checking availability…"}
                </p>
              </div>
            </div>
            {!active ? (
              <button
                onClick={start}
                disabled={
                  !capabilities?.enabled ||
                  !capabilities?.aiConfigured ||
                  !browser.supported
                }
                className="brand-button mt-5 min-h-12 w-full sm:w-auto"
              >
                {state.phase === "idle"
                  ? "Start talking"
                  : "Start a new session"}
              </button>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={() => controller.current.toggleMute()}
                  aria-pressed={state.muted}
                  className="secondary-button min-h-12"
                >
                  {state.muted ? (
                    <MicOff size={18} aria-hidden="true" />
                  ) : (
                    <Mic size={18} aria-hidden="true" />
                  )}
                  {state.muted ? "Unmute mic" : "Mute mic"}
                </button>
                <button
                  onClick={() => controller.current.end()}
                  className="secondary-button min-h-12"
                >
                  <PhoneOff size={18} aria-hidden="true" />
                  End session
                </button>
              </div>
            )}
            {active && (
              <p className="mt-3 text-xs leading-5 text-ink/60">
                Speak naturally and interrupt when you need to. Sessions last up
                to 10 minutes; muting keeps the session connected.
              </p>
            )}
            {loadError && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {loadError}
              </p>
            )}
            {capabilities &&
              (!capabilities.enabled || !capabilities.aiConfigured) && (
                <p role="alert" className="mt-4 text-sm text-ink/70">
                  Deepgram voice is not ready yet. You can use{" "}
                  <Link to="/support" className="underline">
                    text Support
                  </Link>
                  .
                </p>
              )}
            {state.error && (
              <p role="alert" className="mt-4 text-sm leading-6 text-red-700">
                {state.error}
              </p>
            )}
            {state.notice && (
              <p role="status" className="mt-4 text-sm leading-6 text-ink/70">
                {state.notice}
              </p>
            )}
            {!browser.supported && (
              <p className="mt-4 text-sm leading-6 text-ink/65">
                This browser cannot start microphone audio here. Use a current
                browser over HTTPS, or open text Support.
              </p>
            )}
          </div>
          <div
            role="log"
            aria-label="Conversation transcript"
            aria-live="off"
            className="max-h-[45vh] min-h-48 space-y-5 overflow-y-auto p-5 sm:p-6"
          >
            {!state.transcript.length && (
              <p className="text-sm leading-7 text-ink/60">
                Tap Start talking and allow your microphone.
              </p>
            )}
            {state.transcript.map((turn, i) => (
              <div
                key={i}
                className={
                  turn.role === "user"
                    ? "ml-6 border-l-2 border-ink/20 pl-4"
                    : "mr-2"
                }
              >
                <p className="text-xs font-bold text-mesh-700">
                  {turn.role === "user" ? "You" : "CampusMesh assistant"}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">
                  {turn.text}
                </p>
              </div>
            ))}
            <div ref={bottom} />
          </div>
          <form onSubmit={submit} className="border-t border-ink/10 p-5 sm:p-6">
            <label
              htmlFor="voice-question"
              className="mb-2 block text-sm font-semibold"
            >
              Or type your question
            </label>
            <div className="flex gap-2">
              <input
                id="voice-question"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1500}
                disabled={!active || busy}
                placeholder="How do I return an item?"
                className="min-w-0 flex-1 rounded-lg border border-ink/20 px-3 py-3 text-sm focus:outline-2 focus:outline-mesh-600"
              />
              <button
                type="submit"
                aria-label="Send question"
                disabled={!active || busy || !text.trim()}
                className="brand-button min-h-12 px-4"
              >
                <Send size={18} aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
        <aside className="min-w-0 space-y-6 text-sm leading-6">
          <div>
            <h2 className="font-bold">Your voice settings</h2>
            <label className="mt-3 flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={audio}
                disabled={!browser.supported}
                onChange={(e) => {
                  setAudio(e.target.checked);
                  controller.current.setAudio(e.target.checked);
                }}
                className="h-4 w-4 accent-mesh-600"
              />
              Read replies aloud
            </label>
            <p className="mt-2 text-xs leading-5 text-ink/60">
              Deepgram Thalia · female English voice with a relaxed speaking
              pace.
            </p>
          </div>
          <details className="border-t border-ink/10 pt-5">
            <summary className="cursor-pointer font-bold">Privacy & session details</summary>
            <p className="mt-2 text-ink/65">
              This is a browser conversation, not a telephone call or identity
              check. The assistant can explain your next step; it cannot make
              payments or change orders.
            </p>
            <p className="mt-3 text-ink/65">
              Microphone audio and a limited snapshot of your own rentals are
              sent through our server to Deepgram and its managed AI service.
              CampusMesh doesn’t save voice recordings or this transcript to
              your account.
            </p>
            <p className="mt-3 text-ink/65">
              Never share passwords, sign-in codes or UPI PINs. Leaving this
              page or tab ends the session.
            </p>
          </details>
          <Link
            to="/support"
            className="inline-flex min-h-11 items-center font-semibold text-mesh-700 underline underline-offset-4"
          >
            Use text help
          </Link>
        </aside>
      </div>
    </main>
  );
}
