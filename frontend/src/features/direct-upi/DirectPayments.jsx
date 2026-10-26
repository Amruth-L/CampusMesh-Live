import { groupPayments, paymentAction, paymentNames } from "../../lib/payment-actions";
import { io } from 'socket.io-client';
import { API_BASE_URL } from '../../lib/api';
import ReturnSettlementProgress from './ReturnSettlementProgress';
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../../context/auth-context";
const money = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(n || 0),
  );
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
          <h2 className="text-base font-bold text-mesh-800">Your UPI account</h2>
          <p className="mt-3 font-semibold">{saved.payee_name}</p>
          <p className="mt-1 break-all">{saved.upi_id}</p>
        </div>
        <button className="secondary-button" onClick={() => { setEditing(true); setConfirm(false); setMessage(""); }}>Edit</button>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink/75">For earnings and refunds.</p>
      {message && <p role="status" className="mt-2 text-sm text-mesh-800">{message}</p>}
      <details className="mt-3 text-sm text-ink/70">
        <summary className="cursor-pointer font-semibold">About this account</summary>
        <p className="mt-2 leading-6">Saving a UPI ID does not transfer money or verify bank ownership. Unpaid requests use your latest details; reported receipts keep the account paid.</p>
      </details>
      {!compact && <div className="mt-4 flex flex-wrap gap-3 border-t border-ink/10 pt-4">
        <Link to="/lend" className="secondary-button text-sm">Listing requests</Link>
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
      window.dispatchEvent(new Event("campusmesh:payment-change"));
      await reload();
    } catch (e) {
      setError(e.response?.data?.error || "Could not update payment.");
    } finally {
      setBusy(false);
    }
  }
  const action = paymentAction(p, user.id);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); setConfirm(false); }, [p.status]);
  return (
    <article id={`payment-${p.id}`} className="scroll-mt-40 rounded-xl border border-ink/15 bg-white p-4 sm:p-5">
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">{paymentNames[p.kind] || 'Payment'} <span className="font-normal text-ink/70">· {p.title}</span></h3>
          <strong className="mt-1 block text-2xl font-bold tabular-nums">{money(p.amount)}</strong>
          <p className="mt-1 text-sm text-ink/75">{payer ? 'To' : 'From'} {payer ? p.recipient_name : p.payer_name}</p>
          <p role="status" className={`mt-1 text-xs font-semibold ${p.status === 'DISPUTED' ? 'text-red-700' : 'text-mesh-800'}`}>{action.status}</p>
        </div>
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={`payment-action-${p.id}`} className={`${action.priority === 0 ? 'brand-button' : 'secondary-button'} w-full shrink-0 text-sm sm:w-auto`}>
          {expanded ? 'Close' : action.label}
        </button>
      </div>
      {expanded && <div id={`payment-action-${p.id}`} className="mt-4 border-t border-ink/10 pt-4">
        {payer && p.status === 'PENDING' && <>
          {changed && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">UPI account changed. Already paid? Choose the account you paid below; do not pay again.</p>}
          <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
            <div className="flex flex-col items-start gap-2">
              <a href={p.uri} className="brand-button w-full text-sm">Open UPI app</a>
              <QRCodeSVG value={p.uri} size={170} title={`Pay ${money(p.amount)} to ${p.payee_name}`} marginSize={2} />
              <p className="w-full break-all text-xs text-ink/75">{p.payee_name}<br />{p.upi_id}</p>
            </div>
            <div className="space-y-3 text-sm">
              <p>Check the name and amount in your UPI app. After paying, add the reference below.</p>
              {changed && <label className="grid gap-2 font-semibold">Account you paid
                <select value={paidRevision} onChange={e => { setPaidRevision(e.target.value); setConfirm(false); }} className="w-full rounded-lg border border-ink/25 bg-white p-3">
                  <option value="">Choose account</option>
                  {versions.map(v => <option key={v.revision} value={v.revision}>{v.revision === p.recipient_revision ? 'Current' : 'Previous'}: {v.upi_id} · {v.payee_name}</option>)}
                </select>
              </label>}
              <label className="grid gap-2 font-semibold">UPI reference (UTR)
                <input value={reference} onChange={e => setReference(e.target.value)} inputMode="numeric" maxLength={12} placeholder="12-digit reference" className="w-full rounded-lg border border-ink/25 p-3" />
              </label>
              <label className="flex items-start gap-2"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-1" />I sent {money(p.amount)} to {changed ? 'the selected account' : p.payee_name}.</label>
              <button disabled={busy || !confirm || !/^\d{12}$/.test(reference) || (changed && !paidRevision)} onClick={() => act('report')} className="brand-button disabled:opacity-50">{busy ? 'Sending…' : 'Payment sent'}</button>
            </div>
          </div>
        </>}
        {!payer && ['REPORTED', 'DISPUTED'].includes(p.status) && <div className="space-y-3 text-sm">
          <p>Reference: <strong>{p.reference}</strong></p>
          <p>Confirm only after {money(p.amount)} reaches your bank.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-1" />I checked my bank or UPI history.</label>
          <div className="flex flex-wrap gap-3">
            <button disabled={busy || !confirm} onClick={() => act('confirm')} className="brand-button disabled:opacity-50">{busy ? 'Updating…' : `Received ${money(p.amount)}`}</button>
            {p.status === 'REPORTED' && <button disabled={busy || !confirm} onClick={() => act('dispute')} className="secondary-button disabled:opacity-50">Not received</button>}
          </div>
        </div>}
        {p.status === 'REPORTED' && payer && <p className="text-sm">Waiting for {p.recipient_name} to confirm. Do not pay again.</p>}
        {!payer && p.status === 'PENDING' && <p className="text-sm">{p.payer_name} has not reported payment yet.</p>}
        {p.status === 'DISPUTED' && <p className="mt-3 text-sm">Check with the other person or <Link to="/support" className="underline">get help</Link>. Do not send another payment.</p>}
        {p.status === 'CONFIRMED' && <p className="text-sm">Confirmed by recipient · {new Date(p.confirmed_at).toLocaleString()}<br />Reference: {p.reference || '—'}. Not bank-verified by CampusMesh.</p>}
        <Link className="mt-4 inline-block text-sm font-semibold text-mesh-800 underline" to={`/rent-details/${p.rental_id}`}>Rental details</Link>
      </div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
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
    socket.on('rental:status',load);
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
      window.dispatchEvent(new Event("campusmesh:payment-change"));
      await load();
      await onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || "Could not update rental.");
    } finally {
      setBusy(false);
    }
  }
  const { active, history } = groupPayments(items, user.id);
  const refresh = async () => { await load(); await onChange?.(); };
  const returning = rental && !deliveryId && (rental.status?.startsWith('RETURN_') || ['REFUND_PENDING', 'REFUNDED'].includes(rental.deposit_status) || rental.status === 'COMPLETED');
  return (
    <section id="payments" className="scroll-mt-36 space-y-3" aria-label="Direct UPI payments">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{rental || deliveryId ? 'Payments' : 'Payment requests'}</h2>
        <button className="min-h-11 px-2 text-sm font-semibold text-mesh-800 underline" onClick={load}>Refresh</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!loaded && !error && <p role="status" className="text-sm text-ink/70">Loading payments…</p>}
      <p role="status" className="sr-only">{loaded ? `${active.length} pending payment requests` : ''}</p>
      {active.map(p => <PaymentCard key={p.id} payment={p} reload={refresh} />)}
      {rental?.owner_response === 'PENDING' && <div className="rounded-xl border border-ink/15 bg-white p-4">
        <p className="text-sm">{user.id === rental.owner_id ? 'Accept this request to ask for payment.' : 'Waiting for owner acceptance. No payment due yet.'}</p>
        {user.id === rental.owner_id && <div className="mt-3 flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => run('ACCEPTED')} className="brand-button disabled:opacity-50">Accept request</button>
          <button disabled={busy} onClick={() => run('REJECTED')} className="secondary-button disabled:opacity-50">Decline</button>
        </div>}
      </div>}
      {rental?.return_workflow?.requested && Number(rental.deposit_amount) > 0 && !rental.return_workflow.refund_account_ready && user.id === rental.borrower_id && <div className="space-y-3">
        <p className="text-sm font-semibold">Add your UPI ID for your {money(rental.deposit_amount)} refund.</p>
        <UpiProfile compact onSaved={refresh} />
      </div>}
      {rental?.deposit_status === 'REFUND_PENDING' && !items.some(p => p.kind === 'DEPOSIT_REFUND') && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h3 className="font-bold">Refund · {money(rental.deposit_amount)}</h3>
        <p className="mt-1 text-sm">{rental.return_workflow?.refund_account_ready ? 'Preparing your refund request…' : 'Waiting for the renter’s UPI ID.'}</p>
      </div>}
      {loaded && !active.length && rental?.owner_response !== 'PENDING' && rental?.deposit_status !== 'REFUND_PENDING' && <p className="rounded-xl border border-ink/15 bg-white p-4 text-sm font-semibold">No payment due.</p>}
      {deliveryId && loaded && !items.length && <Link to="/payouts#upi-account" className="inline-block text-sm font-semibold text-mesh-800 underline">Set up UPI to receive delivery fees</Link>}
      {history.length > 0 && <details className="border-y border-ink/10 py-3">
        <summary className="cursor-pointer text-sm font-semibold">Payment history ({history.length})</summary>
        <div className="mt-3 space-y-3">{history.map(p => <PaymentCard key={p.id} payment={p} reload={refresh} />)}</div>
      </details>}
      {returning && <ReturnSettlementProgress rental={rental} refund={items.find(p => p.kind === 'DEPOSIT_REFUND')} />}
      <div className="flex flex-wrap items-start justify-between gap-3 pt-1 text-xs text-ink/75">
        <details className="max-w-xl">
          <summary className="cursor-pointer font-semibold">How UPI payments work</summary>
          <p className="mt-2 leading-5">Pay each person directly in your UPI app, then enter the reference. The recipient checks their bank and confirms receipt. Rent and deposits go to the owner, delivery fees to the courier, and refunds to the renter. CampusMesh does not hold or split these payments.</p>
        </details>
        {(rental || deliveryId) && <Link to="/payouts" className="font-semibold text-mesh-800 underline">All payments</Link>}
      </div>
    </section>
  );
}
export default function DirectDashboard() {
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 pb-28 sm:px-6 lg:pb-12">
      <h1 className="text-3xl font-bold">Payments</h1>
      <DirectPayments />
      <details id="upi-account" className="scroll-mt-36 border-t border-ink/15 pt-4" open={window.location.hash === '#upi-account' || undefined}>
        <summary className="cursor-pointer text-sm font-semibold">Receiving UPI account</summary>
        <div className="mt-3"><UpiProfile compact /></div>
      </details>
    </main>
  );
}
