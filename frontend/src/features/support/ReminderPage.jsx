import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Phone, Play, Volume2, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
const field =
  "mt-2 w-full rounded-lg border border-ink/15 px-3 py-3 text-sm outline-none focus:border-mesh-600";
export default function ReminderPage() {
  const { api } = useAuth();
  const [params] = useSearchParams();
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => synth.removeEventListener("voiceschanged", refresh);
  }, []);
  const [data, setData] = useState(null),
    [form, setForm] = useState({
      phone_e164: "",
      reminders_enabled: false,
      recommendations_enabled: false,
      welcome_enabled: false,
      login_calls_enabled: false,
      booking_enabled: false,
    }),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [code, setCode] = useState(""),
    [verificationRetry, setVerificationRetry] = useState(0);
  const isAuthkey = data?.status.provider === "authkey";
  const voiceVerification = data?.status.phoneVerificationChannel === "voice";
  const recommendationsAvailable =
    !isAuthkey && data?.status.recommendationsAvailable !== false;
  const supportsInteractiveCalls =
    !isAuthkey && data?.status.supportsInteractiveCalls !== false;
  useEffect(() => {
    if (verificationRetry <= 0) return;
    const timer = window.setTimeout(
      () => setVerificationRetry((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [verificationRetry]);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/calls");
      setData(data);
      setForm({
        phone_e164: data.preferences.phone_e164 || "",
        reminders_enabled: data.preferences.reminders_enabled,
        recommendations_enabled:
          data.status.provider !== "authkey" &&
          data.status.recommendationsAvailable !== false &&
          data.preferences.recommendations_enabled,
        welcome_enabled:
          Boolean(data.preferences.welcome_enabled) &&
          !data.preferences.login_calls_enabled,
        login_calls_enabled: Boolean(data.preferences.login_calls_enabled),
        booking_enabled: data.preferences.booking_enabled,
      });
    } catch (e) {
      setNotice(e.response?.data?.error || "Could not load reminder settings.");
    }
  }, [api]);
  useEffect(() => {
    load();
    return () => window.speechSynthesis?.cancel();
  }, [load]);
  const action = async (type, e) => {
    e?.preventDefault();
    setBusy(type);
    setNotice("");
    try {
      if (type === "save") {
        await api.put("/api/calls/preferences", {
          ...form,
          recommendations_enabled:
            recommendationsAvailable && form.recommendations_enabled,
        });
        await load();
        setNotice(
          data?.status.mode === "preview"
            ? "Preferences saved. No calls are placed in preview mode."
            : "Preferences saved. You can turn any type of call off at any time.",
        );
      } else if (type === "preview") {
        const { data } = await api.get("/api/calls/preview");
        setPreview(data);
      } else {
        const { data } = await api.post(
          "/api/calls/verify-phone",
          type === "confirm" ? { code } : {},
        );
        if (data.verified) {
          setCode("");
          setNotice(
            "Phone verified. Your enabled sign-in greetings, welcome and rental calls can now run automatically during calling hours.",
          );
        } else {
          setVerificationRetry(Number(data.retryAfter) || 0);
          setNotice(
            data.channel === "voice" || voiceVerification
              ? "Answer the verification call and enter the code you hear below."
              : "Verification code sent by SMS. Enter it below.",
          );
        }
        await load();
      }
    } catch (e) {
      setNotice(e.response?.data?.error || "Could not complete this action.");
    } finally {
      setBusy("");
    }
  };
  const listen = (text) => {
    if (!window.speechSynthesis) {
      setNotice(
        "Audio preview is not supported in this browser. Read the script below.",
      );
      return;
    }
    const available = window.speechSynthesis.getVoices();
    // SpeechSynthesis has no gender field; prefer known female English voices.
    const female = (available.length ? available : voices).filter(
      (v) =>
        /^en[-_]/i.test(v.lang) &&
        /\b(veena|aditi|raveena|samantha|victoria|karen|moira|tessa|serena|susan|zira|aria|jenny|sonia|female)\b/i.test(
          v.name,
        ),
    );
    const voice = female.find((v) => /^en[-_]IN$/i.test(v.lang)) || female[0];
    if (!voice) {
      setNotice(
        "A female English voice is not available in this browser yet. Enable one in your device’s speech settings, then refresh to hear the preview.",
      );
      return;
    }
    setNotice("");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 0.85;
    utterance.onerror = () =>
      setNotice("The voice preview could not play. Please try again.");
    window.speechSynthesis.speak(utterance);
  };
  return (
    <main className="page-shell pb-28">
      <header>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-mesh-700">
          Stay on track
        </p>
        <h1 className="page-title">Reminder calls</h1>
        <p className="page-copy">
          Choose which updates you want to hear. English first.
        </p>
      </header>
      {params.get("welcome") === "1" && (
        <section className="panel mt-6 p-5">
          <h2 className="font-semibold">You’re signed in</h2>
          <p className="mt-2 text-sm leading-6 text-ink/60">
            Your call preferences are saved. Verify your saved number once
            when calling is available. Enabled greetings and rental updates
            then run automatically during calling hours. Check the setup status
            below to see whether your number is ready.
            You can continue to explore CampusMesh while setup is pending.
          </p>
          <Link
            to="/choose-mode"
            className="mt-3 inline-block text-sm font-semibold text-mesh-700"
          >
            Continue to CampusMesh →
          </Link>
        </section>
      )}
      {notice && (
        <p
          role="status"
          className="my-5 rounded-lg bg-mesh-50 p-4 text-sm text-mesh-800"
        >
          {notice}
        </p>
      )}
      {!data ? (
        <p className="mt-8 text-sm">Loading settings…</p>
      ) : (
        <>
          <div
            className={`my-6 flex items-start gap-3 rounded-xl border p-4 ${data.accountReadiness?.state === "blocked" ? "border-amber-200 bg-amber-50" : "border-mesh-200 bg-mesh-50"}`}
          >
            <Phone size={20} className="mt-0.5 shrink-0 text-mesh-600" />
            <div>
              <h2 className="text-sm font-semibold">
                {data.accountReadiness?.title || "Your automatic call setup"}
              </h2>
              {data.accountReadiness?.reasons?.length ? (
                <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-ink/80">
                  {data.accountReadiness.reasons.map((reason) => (
                    <li key={reason.code}>{reason.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm leading-6 text-ink/70">
                  Automatic calls are enabled for your saved preferences. Each
                  rental must also meet the booking or reminder conditions
                  below.
                </p>
              )}
            </div>
          </div>
          {isAuthkey && data.status.activationPending && (
            <p className="mb-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-ink/80">
              Calling setup is pending. CampusMesh is waiting for Authkey
              activation and calling credits. Once connected, you can verify
              your own number here; the project owner will not need to add each
              student’s number manually.
            </p>
          )}
          {!isAuthkey && data.status.trialMode && (
            <p className="mb-5 rounded-xl bg-paper p-4 text-sm leading-6 text-ink/65">
              Twilio trial: automatic calls work only for approved test
              recipients. Your number must first be verified in the Twilio
              console and linked to your CampusMesh account by the project
              owner. Trial minutes and expiry apply.
            </p>
          )}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <form
              onSubmit={(e) => action("save", e)}
              className="panel space-y-5 p-5 sm:p-6"
            >
              <h2 className="text-lg font-semibold">Your preferences</h2>
              <label className="block text-xs font-medium">
                Phone number with country code
                <input
                  type="tel"
                  className={field}
                  placeholder="+91…"
                  value={form.phone_e164}
                  onChange={(e) =>
                    setForm({ ...form, phone_e164: e.target.value })
                  }
                />
              </label>
              <p className="text-xs text-ink/55">
                {data.preferences.phone_verified_at &&
                form.phone_e164 === data.preferences.phone_e164
                  ? "Phone number verified"
                  : "Phone verification is required before live calls."}
              </p>
              {[
                [
                  "login_calls_enabled",
                  "Call me after sign-in",
                  "Automatic English greetings after successful sign-ins, once your saved number is verified and calling is available. No call button is needed. Calls run 9 am–7 pm India time, at least 30 minutes apart and at most three times a day across all call types. This replaces the one-time welcome call.",
                ],
                [
                  "booking_enabled",
                  "Booking confirmations",
                  "One thank-you call per fully paid rental, with pickup or delivery guidance and the return date. Nighttime bookings wait until 9 am. Unpaid, cancelled, and demo orders never trigger calls.",
                ],
                [
                  "welcome_enabled",
                  "One-time welcome call",
                  "One welcome after your first successful sign-in and phone verification. Later sign-ins never trigger another. Available during your first seven days. Choose this instead of sign-in greetings if you want just one welcome.",
                ],
                [
                  "reminders_enabled",
                  "Due-date reminders",
                  "Reminders four days before, the day before, on the due date, and once the next day if overdue. Calls stop when you return the item or an extension changes the due date.",
                ],
                [
                  "recommendations_enabled",
                  "Item recommendations",
                  recommendationsAvailable
                    ? "Occasional suggestions based on real campus demand and your interests. This is optional and separate from rental reminders."
                    : isAuthkey
                      ? "Unavailable with this calling setup. Authkey startup credits cover transactional updates, not promotional recommendations."
                      : "Item recommendation calls are unavailable with the current calling setup.",
                ],
              ].map(([key, title, description]) => (
                <label
                  key={key}
                  className={`flex items-start gap-3 rounded-xl border border-ink/10 p-4 ${key === "recommendations_enabled" && !recommendationsAvailable ? "bg-paper" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-green-700"
                    checked={form[key]}
                    disabled={
                      key === "recommendations_enabled" &&
                      !recommendationsAvailable
                    }
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setForm((current) => ({
                        ...current,
                        [key]: checked,
                        ...(checked && key === "login_calls_enabled"
                          ? { welcome_enabled: false }
                          : {}),
                        ...(checked && key === "welcome_enabled"
                          ? { login_calls_enabled: false }
                          : {}),
                      }));
                    }}
                  />
                  <span>
                    <strong className="block text-sm">{title}</strong>
                    <span className="mt-2 block text-xs leading-5 text-ink/55">
                      {description}
                    </span>
                  </span>
                </label>
              ))}
              <p className="text-xs leading-5 text-ink/55">
                Enabling a switch opts you in to that type of automated
                CampusMesh call. Calls use your verified number.{" "}
                {supportsInteractiveCalls
                  ? "Disable any switch here and save, or press 9 during a call to stop all automated calls, including sign-in greetings."
                  : "To stop a call type, disable its switch and save. To stop all calls, turn off every switch, including sign-in greetings."}
              </p>
              <button disabled={!!busy} className="brand-button w-full">
                {busy === "save" ? "Saving…" : "Save preferences"}
              </button>
              {data.status.phoneVerificationConfigured &&
                !data.preferences.phone_verified_at && (
                  <div className="border-t border-ink/10 pt-4">
                    <p className="mb-3 text-xs leading-5 text-ink/65">
                      {voiceVerification
                        ? "Verify your number once by entering the code from an automated call. Enabled sign-in greetings, welcome and rental calls then run automatically; no manual registration with the calling provider is needed."
                        : "Verify your number once using an SMS code. Your enabled sign-in greetings, welcome and rental calls then run automatically during calling hours."}
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        !!busy ||
                        verificationRetry > 0 ||
                        !form.phone_e164 ||
                        form.phone_e164 !== data.preferences.phone_e164
                      }
                      onClick={() => action("verify")}
                    >
                      {verificationRetry > 0
                        ? `Resend in ${verificationRetry}s`
                        : voiceVerification
                          ? "Call me with a verification code"
                          : "Send SMS verification code"}
                    </button>
                    {form.phone_e164 !== data.preferences.phone_e164 && (
                      <p className="mt-2 text-xs text-ink/55">
                        Save your mobile number before requesting a verification
                        code.
                      </p>
                    )}
                    <label className="mt-3 block text-xs">
                      Verification code
                      <input
                        className={field}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={8}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="brand-button mt-3"
                      disabled={
                        !!busy ||
                        !code ||
                        form.phone_e164 !== data.preferences.phone_e164
                      }
                      onClick={() => action("confirm")}
                    >
                      Verify phone
                    </button>
                  </div>
                )}
              {!data.status.phoneVerificationConfigured &&
                !data.preferences.phone_verified_at && (
                  <p className="border-t border-ink/10 pt-4 text-xs leading-5 text-ink/65">
                    Phone verification setup is pending. You can save your
                    preferences now; calls will start only after the service is
                    connected and your number is verified.
                  </p>
                )}
            </form>
            <section className="space-y-4">
              <div className="panel p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <Volume2 size={20} className="text-mesh-600" />
                  <h2 className="text-lg font-semibold">Hear a preview</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink/60">
                  Listen to the script using a soft English browser voice.
                  Audio stays in this browser and never dials a phone. The live
                  call’s voice depends on the calling provider.
                </p>
                <button
                  className="secondary-button mt-4"
                  onClick={() => action("preview")}
                  disabled={!!busy}
                >
                  <Play size={15} />
                  {busy === "preview" ? "Preparing…" : "Generate call preview"}
                </button>
                {preview && (
                  <div className="mt-5 space-y-4">
                    {(preview.previews.length
                      ? preview.previews
                      : [preview.sample]
                    )
                      .concat(
                        preview.previews.some((p) => p.kind === "SIGN_IN_GREETING")
                          ? []
                          : [preview.signInSample],
                      )
                      .concat(
                        preview.previews.some((p) => p.kind === "WELCOME")
                          ? []
                          : [preview.welcomeSample],
                      )
                      .concat(
                        preview.previews.some(
                          (p) => p.kind === "BOOKING_CONFIRMATION",
                        )
                          ? []
                          : [preview.bookingSample],
                      )
                      .filter(Boolean)
                      .filter(
                        (p) =>
                          recommendationsAvailable ||
                          p.kind !== "RECOMMENDATION",
                      )
                      .map((p, i) => (
                        <article key={i} className="rounded-lg bg-paper p-4">
                          <span className="text-xs font-semibold text-mesh-700">
                            {p.kind === "BOOKING_CONFIRMATION"
                              ? p.example
                                ? "Booking call example"
                                : "Your booking confirmation"
                              : p.kind === "SIGN_IN_GREETING"
                                ? p.example
                                  ? "Sign-in greeting example"
                                  : "Your sign-in greeting"
                                : p.kind === "WELCOME"
                                  ? p.example
                                    ? "Welcome call example"
                                    : "Your welcome call"
                                  : p.example
                                    ? "Example only"
                                    : p.kind === "DUE_REMINDER"
                                      ? "Your rental reminder"
                                      : "Item recommendation"}
                          </span>
                          <p className="mt-3 text-sm leading-6">{p.script}</p>
                          <button
                            className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-mesh-700"
                            onClick={() => listen(p.script)}
                          >
                            <Volume2 size={15} />
                            Listen in browser
                          </button>
                        </article>
                      ))}
                    <p className="text-xs leading-5 text-ink/50">
                      {preview.note}
                    </p>
                  </div>
                )}
              </div>
              <div className="panel p-5">
                <ShieldCheck className="text-mesh-600" size={20} />
                <h2 className="mt-3 text-sm font-semibold">
                  Designed to be useful, not noisy
                </h2>
                <p className="mt-3 text-xs leading-6 text-ink/60">
                  {data.status.window}. {data.status.limits} Due-date reminders
                  take priority. Bookings and payments require action in the
                  app.
                </p>
                <Link
                  to="/support"
                  className="mt-4 inline-block text-xs font-semibold text-mesh-700"
                >
                  Ask a support question →
                </Link>
              </div>
            </section>
          </div>
          <section className="panel mt-6 p-5">
            <h2 className="font-semibold">Call history</h2>
            {!data.calls.length ? (
              <p className="mt-3 text-sm text-ink/55">
                No calls have been placed.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {data.calls.map((c) => (
                  <article
                    key={c.id}
                    className="rounded-lg border border-ink/10 p-3"
                  >
                    <div className="flex flex-wrap justify-between gap-2 text-xs">
                      <b>
                        {c.kind === "BOOKING_CONFIRMATION"
                          ? "Booking confirmation"
                          : c.kind === "SIGN_IN_GREETING"
                            ? "Sign-in greeting"
                            : c.kind === "WELCOME"
                              ? "Welcome call"
                              : c.kind === "DUE_REMINDER"
                                ? "Due-date reminder"
                                : "Recommendation"}
                      </b>
                      <span>
                        {c.provider === "authkey" && c.status === "SENT"
                          ? "Submitted to calling service"
                          : c.status.toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ink/55">
                      {new Date(c.created_at).toLocaleString("en-IN")}
                      {c.outcome ? ` · ${c.outcome}` : ""}
                    </p>
                    {c.last_error && (
                      <p className="mt-2 text-xs text-ink/55">{c.last_error}</p>
                    )}
                    {c.provider === "authkey" && c.status === "SENT" && (
                      <p className="mt-2 text-xs text-ink/55">
                        The service accepted this call. Answer and playback
                        have not been confirmed.
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
