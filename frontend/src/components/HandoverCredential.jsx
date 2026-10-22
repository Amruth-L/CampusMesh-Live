import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { KeyRound, RefreshCw } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function HandoverCredential({ deliveryId, stage, title }) {
  const { api } = useAuth();
  const [credential, setCredential] = useState();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setCredential(undefined); setError(""); }, [deliveryId, stage]);
  useEffect(() => {
    if (!credential) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [credential]);
  const expired = credential && new Date(credential.expiresAt).getTime() <= now;
  const issue = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.get(
        `/api/delivery/${deliveryId}/handover/${stage}`,
      );
      setCredential(data);
      setNow(Date.now());
    } catch (e) {
      setError(e.response?.data?.error || "Credential is not available yet.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-ink/10 bg-white p-4 text-center">
      <KeyRound size={19} />
      <b className="block">{title}</b>
      <p className="text-xs leading-5 text-ink/60">Share this handover code only when the courier is with you and the item is ready. Never share an account verification or password reset code.</p>
      {credential && !expired ? (
        <>
          <QRCodeSVG
            className="mx-auto"
            value={JSON.stringify(credential.qr)}
            size={150}
            level="M"
          />
          <div className="my-3 text-3xl font-black tracking-[.22em]">
            {credential.otp}
          </div>
          <small className="block text-ink/50">
            Single-use · expires{" "}
            {new Date(credential.expiresAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
          <button
            className="mx-auto mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white transition hover:bg-mesh-700 disabled:opacity-50"
            onClick={issue}
            disabled={busy}
          >
            <RefreshCw size={13} /> {busy ? "Generating…" : "Generate a new code"}
          </button>
        </>
      ) : (
        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white transition hover:bg-mesh-700 disabled:opacity-50"
          onClick={issue}
          disabled={busy}
        >
          {busy ? "Generating…" : expired ? "Code expired · Get a new code" : "Show secure QR & OTP"}
        </button>
      )}
      {error && (
        <small role="alert" className="mt-2 block text-red-600">
          {error}
        </small>
      )}
    </div>
  );
}
