import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Volume2, VolumeX, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { AnnouncementPlayer } from "./announcement-player";

const read = (storage, key, fallback) => {
  try {
    return JSON.parse(storage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (storage, key, value) => {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be blocked. */
  }
};

export default function VoiceWelcomePrompt() {
  const { user, token, api, voicePrompt } = useAuth();
  const { pathname } = useLocation();
  const conversation = pathname === "/voice";
  const player = useRef(null);
  const [state, setState] = useState({ phase: "idle", muted: false });
  const [availability, setAvailability] = useState("checking");

  useEffect(() => {
    const p = new AnnouncementPlayer({ browser: window, onChange: setState });
    player.current = p;
    const prime = (event) => {
      if (event.isTrusted) p.prime();
    };
    document.addEventListener("pointerdown", prime, true);
    document.addEventListener("keydown", prime, true);
    return () => {
      document.removeEventListener("pointerdown", prime, true);
      document.removeEventListener("keydown", prime, true);
      p.dispose();
    };
  }, []);

  useEffect(() => {
    const p = player.current;
    const abort = new AbortController();
    if (!user?.id || !token) {
      p.pause();
      return;
    }
    const scope = `campusmesh:voice:${user.id}`;
    let session = read(sessionStorage, `${scope}:session`, null);
    // Greet after a successful sign-in, never just because a page was refreshed.
    if (!session || (voicePrompt && session.login !== voicePrompt)) {
      session = { since: new Date().toISOString(), login: voicePrompt || null };
      write(sessionStorage, `${scope}:session`, session);
    }
    const muted = read(localStorage, `${scope}:muted`, false) === true;
    p.configure({
      storage: localStorage,
      scope: `${scope}:heard`,
      muted,
      fetchAudio: async (item, signal) => {
        const { data } = await api.post(
          "/api/voice/announcements/audio",
          { kind: item.kind, rentalId: item.rentalId, eventId: item.eventId },
          {
            responseType: "arraybuffer",
            signal,
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        return data;
      },
    });
    let cursor = null;
    let polling = false;
    let configured = false;
    const poll = async () => {
      if (
        polling ||
        abort.signal.aborted ||
        document.hidden ||
        conversation ||
        p.muted ||
        p.queue.length > 70 ||
        !navigator.onLine
      )
        return;
      polling = true;
      try {
        if (!configured) {
          const { data } = await api.get("/api/voice/capabilities", {
            signal: abort.signal,
          });
          if (!data.enabled || !data.aiConfigured) {
            setAvailability("unavailable");
            return;
          }
          configured = true;
          setAvailability("ready");
        }
        if (abort.signal.aborted) return;
        if (session.login)
          p.enqueue([
            {
              id: `welcome:${session.login}`,
              kind: "welcome",
              text: "Welcome to CampusMesh! Borrow, lend, or earn by delivering.",
            },
          ]);
        const { data } = await api.get("/api/voice/announcements", {
          params: { since: session.since, cursor },
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setAvailability("ready");
          p.enqueue(data.updates);
          cursor = data.nextCursor || cursor;
        }
      } catch {
        if (!abort.signal.aborted) setAvailability("offline");
      } finally {
        polling = false;
      }
    };
    const visibility = () => {
      if (document.hidden || conversation || !navigator.onLine) p.pause();
      else {
        p.resume();
        void poll();
      }
    };
    const storage = (event) => {
      if (event.key === `${scope}:muted`) {
        p.setMuted(read(localStorage, event.key, false) === true);
        visibility();
      }
    };
    const pagehide = () => p.pause();
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    window.addEventListener("offline", visibility);
    window.addEventListener("pagehide", pagehide);
    visibility();
    const timer = window.setInterval(poll, 15000);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      p.pause();
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", visibility);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [api, user?.id, token, voicePrompt, conversation]);

  const toggle = () => {
    const muted = !state.muted;
    write(localStorage, `campusmesh:voice:${user.id}:muted`, muted);
    player.current.setMuted(muted);
    if (!muted) player.current.prime();
  };
  const hear = async () => {
    await player.current.prime();
    player.current.retry();
  };
  if (!user || conversation) return null;
  const pending = Boolean(state.item);
  const label = state.muted
    ? "Voice updates off"
    : state.phase === "speaking"
      ? "Speaking your update"
      : state.phase === "loading"
        ? "Preparing your voice update…"
        : state.phase === "error"
          ? "Voice update paused"
          : state.phase === "blocked"
            ? "Voice update ready"
            : availability === "unavailable"
              ? "Voice setup pending"
              : availability === "offline"
                ? "Voice updates will retry when connected"
                : "Voice updates on";
  return (
    <section
      aria-label="Automatic voice updates"
      className="border-b border-mesh-200 bg-mesh-50 text-mesh-900"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <div className="min-w-0 flex-1 basis-48 text-sm leading-6">
          <p role="status" className="font-semibold">
            {label}
          </p>
          {pending && (
            <p className="max-w-prose break-words">{state.item.text}</p>
          )}
          {state.phase === "error" && <p>{state.message}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {["blocked", "error"].includes(state.phase) && !state.muted && (
            <button
              type="button"
              onClick={hear}
              className="min-h-11 rounded-lg bg-mesh-700 px-4 text-white hover:bg-mesh-800 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {state.phase === "error" ? "Retry voice" : "Tap to hear"}
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-pressed={!state.muted}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 hover:bg-mesh-100 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {state.muted ? (
              <VolumeX size={18} aria-hidden="true" />
            ) : (
              <Volume2 size={18} aria-hidden="true" />
            )}
            {state.muted ? "Enable voice" : "Mute updates"}
          </button>
          <Link
            to="/voice"
            className="inline-flex min-h-11 items-center px-2 underline underline-offset-4"
          >
            Talk to assistant
          </Link>
          {pending && (
            <button
              type="button"
              onClick={() => player.current.dismiss()}
              aria-label="Dismiss this voice update"
              className="flex size-11 items-center justify-center rounded-lg hover:bg-mesh-100 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
