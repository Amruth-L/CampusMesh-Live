import { io } from 'socket.io-client';
import { API_BASE_URL } from '../../lib/api';
import ReturnSettlementProgress from './ReturnSettlementProgress';
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../../context/AuthContext";
const money = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(n || 0),
  );
const names = {
  RENTAL: "Rental fee",
  DEPOSIT: "Refundable deposit",
  DELIVERY: "Delivery fee",
  RETURN_DELIVERY: "Return delivery fee",
  DEPOSIT_REFUND: "Deposit refund",
};
const states = {
  PENDING: "Awaiting payment",
  REPORTED: "Waiting for receipt confirmation",
  CONFIRMED: "Receipt confirmed",
  DISPUTED: "Receipt disputed — do not pay again",
};
export function UpiProfile({ compact = false, onSaved } = {}) {
  const { api } = useAuth();
  const [upi, setUpi] = useState(""),
    [name, setName] = useState(""),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(null),
    [editing, setEditing] = useState(false),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .get("/api/direct-upi/profile")
      .then(({ data }) => {
        if (active && data) {
          setUpi(data.upi_id);
          setName(data.payee_name);
          setSaved(data);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
          setMessage("Could not load your UPI details. Reload before editing.");
        }
      }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
    };
  }, [api]);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const { data } = await api.put("/api/direct-upi/profile", {
        upi_id: upi,
        payee_name: name,
        confirm,
      });
      setMessage(
        "UPI updated for unpaid requests. Existing receipts are unchanged.",
      );
      setSaved(data);
      window.dispatchEvent(new Event("campusmesh:upi-saved"));
      setEditing(false);
      setConfirm(false);
      await onSaved?.();
    } catch (e) {
      setMessage(e.response?.data?.error || "Could not save UPI details.");
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p role="status">Loading UPI account…</p>;
  if (loadError) return <p role="alert" className="text-red-700">{message} <button className="underline" onClick={() => window.location.reload()}>Reload</button></p>;
  if (saved && !editing) return (
    <section className="rounded-xl border border-mesh-200 bg-white p-5 sm:p-6" aria-label="Saved receiving UPI account">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-mesh-800" role="status">Your UPI account</h2>
          <p className="mt-3 font-semibold">{saved.payee_name}</p>
          <p className="mt-1 break-all">{saved.upi_id}</p>
        </div>
        <button className="secondary-button" onClick={() => { setEditing(true); setConfirm(false); setMessage(""); }}>Edit</button>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink/75">For rent, delivery earnings and deposit refunds. Confirm receipts after checking your bank.</p>
      {message && <p role="status" className="mt-2 text-sm text-mesh-800">{message}</p>}
      <details className="mt-3 text-sm text-ink/70">
        <summary className="cursor-pointer font-semibold">About this account</summary>
        <p className="mt-2 leading-6">Saving a UPI ID does not transfer money or verify bank ownership. Unpaid requests use your latest details; reported receipts keep the account paid.</p>
      </details>
      {!compact && <div className="mt-4 flex flex-wrap gap-3 border-t border-ink/10 pt-4">
        <Link to="/lend" className="secondary-button text-sm">Lending requests</Link>
        <Link to="/delivery" className="secondary-button text-sm">My deliveries</Link>
      </div>}
    </section>
  );
  return (
    <section className="rounded-xl border border-ink/15 bg-white p-5 sm:p-6">
      <h2 className="text-xl font-bold">Add your UPI account</h2>
      <p className="mt-2 text-sm leading-6 text-ink/75">
        Receive earnings and refunds here. Use your own UPI ID; bank ownership is not verified by CampusMesh.
      </p>
      <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">
          Account holder name
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => { setName(e.target.value); setConfirm(false); setMessage(""); }}
            className="rounded-lg border border-ink/25 p-3"
            autoComplete="name"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          UPI ID
          <input
            required
            value={upi}
            maxLength={193}
            onChange={(e) => { setUpi(e.target.value); setConfirm(false); setMessage(""); }}
            className="rounded-lg border border-ink/25 p-3"
            placeholder="name@bank"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label className="flex items-start gap-3 text-sm sm:col-span-2">
          <input
            type="checkbox"
            required
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
            className="mt-1"
          />
          I checked this UPI ID and name in my UPI app. This account is mine.
        </label>
        <button disabled={busy || !confirm} className="brand-button disabled:opacity-50">
          {busy ? "Saving…" : saved ? "Save changes" : "Save UPI details"}
        </button>
        {saved && <button type="button" className="secondary-button" disabled={busy} onClick={() => { setName(saved.payee_name); setUpi(saved.upi_id); setEditing(false); setMessage(""); }}>Cancel editing</button>}
      </form>
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
function PaymentCard({ payment: p, reload }) {
  const { api, user } = useAuth();
  const [reference, setReference] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const payer = p.payer_id === user.id;
  const [paidRevision,setPaidRevision] = useState("");
  const versions=p.recipient_versions || [];
  const changed=versions.length>1;
  useEffect(()=>{setPaidRevision("");setConfirm(false);},[p.recipient_revision]);
  async function act(action) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/direct-upi/payments/${p.id}/${action}`, {
        reference,
        confirm,
        recipient_revision: changed ? Number(paidRevision) : p.recipient_revision || 1,
      });
      setConfirm(false);
      await reload();
    } catch (e) {
      setError(e.response?.data?.error || "Could not update payment.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="rounded-xl border border-ink/15 bg-white p-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="font-bold">
            {names[p.kind]} · {p.title}
          </h3>
          <p className="mt-1 text-sm text-ink/75">
            {payer ? "Pay to" : "From"}{" "}
            {payer ? p.recipient_name : p.payer_name}
          </p>
        </div>
        <strong className="text-xl">{money(p.amount)}</strong>
      </div>
      <p role="status" className="mt-3 font-semibold text-mesh-800">
        {states[p.status]}
      </p>
      <p className="mt-2 text-sm">
        Recipient UPI:{" "}
        <span className="break-all font-semibold">{p.upi_id}</span>
      </p>
      <p className="mt-1 text-sm">Account name: {p.payee_name}</p>
      {p.status==='PENDING' && changed && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">UPI details changed. Already paid? Select the account you paid below; do not pay again.</p>}
      <Link
        className="mt-2 inline-block text-sm font-semibold underline"
        to={`/rent-details/${p.rental_id}`}
      >
        Rental details
      </Link>
      {payer && p.status === "PENDING" && (
        <div className="mt-5 grid gap-5 sm:grid-cols-[180px_1fr]">
          <div>
            <QRCodeSVG
              value={p.uri}
              size={170}
              title={`Pay ${money(p.amount)} to ${p.payee_name}`}
              marginSize={2}
            />
            <a href={p.uri} className="secondary-button mt-3 w-full text-sm">
              Open UPI app
            </a>
          </div>
          <div className="space-y-3 text-sm">
            <p>
              Check the name and amount before paying. If the QR or link fails, use the UPI ID above.
            </p>
            {changed && <label className="grid gap-2 font-semibold">
              Account you actually paid
              <select value={paidRevision} onChange={e=>{setPaidRevision(e.target.value);setConfirm(false);}} className="w-full rounded-lg border border-ink/25 bg-white p-3">
                <option value="">Select the UPI ID on your transaction</option>
                {versions.map(v=><option key={v.revision} value={v.revision}>{v.revision===p.recipient_revision?'Current':'Previous'}: {v.upi_id} · {v.payee_name}</option>)}
              </select>
            </label>}
            <label className="grid gap-2 font-semibold">
              Transaction reference (UTR)
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                inputMode="numeric"
                maxLength={12}
                placeholder="12-digit reference"
                className="w-full rounded-lg border border-ink/25 p-3"
              />
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                className="mt-1"
              />
              I sent this exact amount to {changed ? "the account selected above" : "the displayed recipient"}.
            </label>
            <button
              disabled={busy || !confirm || !/^\d{12}$/.test(reference) || (changed && !paidRevision)}
              onClick={() => act("report")}
              className="brand-button disabled:opacity-50"
            >
              {p.kind === "DEPOSIT_REFUND" ? "I sent the refund" : "I sent the payment"}
            </button>
          </div>
        </div>
      )}
      {!payer && ["REPORTED", "DISPUTED"].includes(p.status) && (
        <div className="mt-4 space-y-3 text-sm">
          <p>
            Reference: <strong>{p.reference}</strong>. Confirm only after this amount reaches your bank; a screenshot is not proof.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              className="mt-1"
            />
            I checked my bank or UPI transaction history.
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy || !confirm}
              onClick={() => act("confirm")}
              className="brand-button disabled:opacity-50"
            >
              {p.kind === "DEPOSIT_REFUND" ? "Confirm refund received: " : "I received "}{money(p.amount)}
            </button>
            {p.status === "REPORTED" && (
              <button
                disabled={busy || !confirm}
                onClick={() => act("dispute")}
                className="secondary-button disabled:opacity-50"
              >
                Payment not received
              </button>
            )}
          </div>
        </div>
      )}
      {p.status === "REPORTED" && payer && (
        <p className="mt-3 text-sm">
          Waiting for the recipient. Do not pay again.
        </p>
      )}
      {p.status === "DISPUTED" && (
        <p className="mt-3 text-sm">
          Check with the recipient or contact{" "}
          <Link to="/support" className="underline">
            support
          </Link>
          . No retry or refund has been made.
        </p>
      )}
      {p.status === "CONFIRMED" && (
        <p className="mt-3 text-sm text-ink/70">
          Confirmed by recipient · {new Date(p.confirmed_at).toLocaleString()}. Not bank-verified by CampusMesh.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </article>
  );
}
export function DirectPayments({ rental = null, deliveryId = null, onChange }) {
  const { api, user } = useAuth();
  const rentalId = rental?.id;
  const [items, setItems] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/direct-upi/payments", {
        params: rentalId ? { rental_id: rentalId } : {},
      });
      setItems(deliveryId ? data.filter(p => p.delivery_id === deliveryId) : data);
      setError("");
      setLoaded(true);
    } catch (e) {
      setError(e.response?.data?.error || "Could not load direct payments.");
    }
  }, [api, rentalId, deliveryId]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    const socket=io(API_BASE_URL,{auth:{token:localStorage.getItem('token')},reconnectionAttempts:3});
    socket.on('direct-payment:updated',load);
    socket.on('connect',load);
    window.addEventListener('focus',load);
    window.addEventListener('campusmesh:upi-saved',load);
    return () => {
      clearInterval(timer);socket.close();
      window.removeEventListener('focus',load);
      window.removeEventListener('campusmesh:upi-saved',load);
    };
  }, [load]);
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      if (action === "prepare")
        await api.post(`/api/direct-upi/rentals/${rental.id}/prepare`);
      else
        await api.post("/api/rentals/respond", {
          rental_id: rental.id,
          response: action,
        });
      await load();
      await onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || "Could not update rental.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="Direct UPI payments">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{rental || deliveryId ? "Payments" : "Payment activity"}</h2>
        <button className="secondary-button" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="text-sm leading-6 text-ink/75">
        Pay directly by UPI. The recipient confirms receipt.
      </p>
      <details className="text-sm text-ink/70">
        <summary className="cursor-pointer font-semibold">How payments work</summary>
        <p className="mt-2 max-w-2xl leading-6">Pay rent and deposits to the lender, delivery fees to the courier, and refunds to the renter. Each is a separate transfer. CampusMesh does not hold or split money and charges no platform fee for these rentals.</p>
      </details>
      {rental?.owner_response === "PENDING" && (
        <div className="rounded-xl bg-mesh-50 p-4">
          <p>No payment is due until the lender accepts.</p>
          {user.id === rental.owner_id && (
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                disabled={busy}
                onClick={() => run("ACCEPTED")}
                className="brand-button"
              >
                Accept request
              </button>
              <button
                disabled={busy}
                onClick={() => run("REJECTED")}
                className="secondary-button"
              >
                Decline request
              </button>
            </div>
          )}
        </div>
      )}
      {rental && !deliveryId && (rental.status?.startsWith('RETURN_') || ['REFUND_PENDING', 'REFUNDED'].includes(rental.deposit_status) || rental.status === 'COMPLETED') && (
        <ReturnSettlementProgress rental={rental} refund={items.find(p => p.kind === 'DEPOSIT_REFUND')} />
      )}
      {rental?.deposit_status === "REFUNDED" && (
        <p className="rounded-xl bg-mesh-50 p-4 font-semibold text-mesh-900">
          Renter confirmed the deposit refund.
        </p>
      )}
      {rental?.delivery_requested && (
        <p className="text-sm">
          Delivery: {money(rental.delivery_fee)}, due after handover. Return delivery is charged separately.
        </p>
      )}
      {rental?.return_workflow?.requested && Number(rental.deposit_amount)>0 && !rental.return_workflow.refund_account_ready && user.id===rental.borrower_id && (
        <div className="space-y-3">
          <p className="text-sm font-semibold">Add your UPI ID to receive your {money(rental.deposit_amount)} deposit refund.</p>
          <UpiProfile compact onSaved={async () => { await load(); await onChange?.(); }} />
        </div>
      )}
      {rental?.deposit_status === "REFUND_PENDING" && !items.some(p => p.kind === "DEPOSIT_REFUND") && (
        <div className="rounded-xl bg-amber-50 p-4 text-amber-950">
          <p>Deposit refund: {money(rental.deposit_amount)}.</p>
          <p className="mt-2 text-sm leading-6">{rental.return_workflow?.refund_account_ready
            ? 'UPI account ready. Refresh to view the refund request.'
            : user.id===rental.borrower_id
              ? 'Add your UPI ID above. The refund appears after the owner checks the returned item.'
              : 'Waiting for the renter to add their UPI ID. The refund request will appear automatically.'}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {items.map((p) => (
        <PaymentCard
          key={p.id}
          payment={p}
          reload={async () => {
            await load();
            await onChange?.();
          }}
        />
      ))}
      {loaded && !items.length && !rental?.return_workflow?.requested && rental?.deposit_status !== "REFUND_PENDING" && (
        <div className="border-y border-ink/15 py-5">
          <h3 className="font-bold">{deliveryId ? "Add your UPI account" : "No payment is due yet"}</h3>
          <p className="mt-2 text-sm leading-6 text-ink/75">{deliveryId ? "Add your UPI ID in Payments. The delivery fee appears after verified handover." : "Payment requests appear after lender acceptance."}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link to={deliveryId ? "/payouts" : "/account/rentals"} className="secondary-button">{deliveryId ? "Add UPI details" : "My rentals"}</Link>
          </div>
        </div>
      )}
      {(rental || deliveryId) && <Link
        to="/payouts"
        className="inline-block text-sm font-semibold text-mesh-800 underline"
      >
        All payments & UPI account
      </Link>}
    </section>
  );
}
export default function DirectDashboard() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-7 pb-28 sm:px-6 lg:pb-12">
      <div>
        <h1 className="text-3xl font-bold">Payments</h1>
        <p className="mt-2 text-sm text-ink/70">Manage your UPI account and track payments.</p>
      </div>
      <UpiProfile />
      <DirectPayments />
    </main>
  );
}
