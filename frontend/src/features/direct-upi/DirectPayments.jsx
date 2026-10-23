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
  REPORTED: "Awaiting recipient confirmation",
  CONFIRMED: "Receipt confirmed by recipient",
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
        "UPI details saved. Unpaid payment requests and their QR codes now use your updated account. Reported and confirmed receipts keep the account actually paid.",
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
  if (loading) return <p role="status">Loading your receiving UPI details…</p>;
  if (loadError) return <p role="alert" className="text-red-700">{message} <button className="underline" onClick={() => window.location.reload()}>Reload</button></p>;
  if (saved && !editing) return (
    <section className="rounded-xl border border-mesh-200 bg-white p-5 sm:p-6" aria-label="Saved receiving UPI account">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-mesh-800" role="status">Receiving UPI details saved</h2>
          <p className="mt-3 font-semibold">{saved.payee_name}</p>
          <p className="mt-1 break-all">{saved.upi_id}</p>
        </div>
        <button className="secondary-button" onClick={() => { setEditing(true); setConfirm(false); setMessage(""); }}>Edit UPI details</button>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink/75">Setup is complete. No payment has been made by saving these details. The payer must authorise a transfer in their UPI app, and you confirm receipt after checking your bank.</p>
      <p className="mt-2 text-sm text-ink/75">CampusMesh has not verified this UPI account with your bank.</p>
      {!compact && <div className="mt-5 border-t border-ink/15 pt-5">
        <h3 className="font-bold">Next: open a rental or delivery</h3>
        <p className="mt-2 text-sm leading-6">To receive rent, publish your own item and accept another student's request in the lending dashboard. The renter will then see your payment QR in Rental details. Delivery fees appear after verified handover.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/add-listing" className="brand-button">List an item</Link>
          <Link to="/lend" className="secondary-button">Lending requests</Link>
          <Link to="/account/rentals" className="secondary-button">My rentals</Link>
          <Link to="/delivery" className="secondary-button">Delivery dashboard</Link>
        </div>
      </div>}
    </section>
  );
  return (
    <section className="rounded-xl border border-ink/15 bg-white p-5 sm:p-6">
      <h2 className="text-xl font-bold">Your receiving UPI account</h2>
      <p className="mt-2 text-sm leading-6 text-ink/75">
        Use your own UPI ID for rental earnings, delivery fees and deposit
        refunds. CampusMesh saves these details but does not verify account
        ownership with your bank.
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
          This is my UPI account. I checked the ID and receiving name in my UPI
          app.
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
      <p className="mt-1 text-sm">Receiving account name: {p.payee_name}</p>
      {p.status==='PENDING' && changed && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">The recipient updated their UPI details. This QR uses their latest account. If you already paid, do not pay again; select the account you actually paid when reporting below.</p>}
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
              Check the recipient name and exact amount in your UPI app before
              authorising. If this link is unsupported, pay using the displayed
              UPI ID.
            </p>
            {changed && <label className="grid gap-2 font-semibold">
              Account you actually paid
              <select value={paidRevision} onChange={e=>{setPaidRevision(e.target.value);setConfirm(false);}} className="w-full rounded-lg border border-ink/25 bg-white p-3">
                <option value="">Select the UPI ID on your transaction</option>
                {versions.map(v=><option key={v.revision} value={v.revision}>{v.revision===p.recipient_revision?'Current':'Previous'}: {v.upi_id} · {v.payee_name}</option>)}
              </select>
            </label>}
            <label className="grid gap-2 font-semibold">
              UPI transaction reference
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
              {p.kind === "DEPOSIT_REFUND" ? "Report deposit refund sent" : "Report payment sent"}
            </button>
          </div>
        </div>
      )}
      {!payer && ["REPORTED", "DISPUTED"].includes(p.status) && (
        <div className="mt-4 space-y-3 text-sm">
          <p>
            Reported reference: <strong>{p.reference}</strong>. Check the
            amount, reference and actual credit in your bank or UPI app. A
            screenshot alone is not proof.
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
          The recipient must confirm receipt. Do not send another payment.
        </p>
      )}
      {p.status === "DISPUTED" && (
        <p className="mt-3 text-sm">
          Compare the transaction with the recipient and contact{" "}
          <Link to="/support" className="underline">
            support
          </Link>
          . No automatic retry or refund has been made.
        </p>
      )}
      {p.status === "CONFIRMED" && (
        <p className="mt-3 text-sm text-ink/70">
          Manually confirmed {new Date(p.confirmed_at).toLocaleString()}.
          CampusMesh has not independently verified this bank transaction.
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
        <h2 className="text-xl font-bold">Direct UPI payments</h2>
        <button className="secondary-button" onClick={load}>
          Refresh payments
        </button>
      </div>
      <p className="text-sm leading-6 text-ink/75">
        Pay each recipient separately. Receipt is confirmed manually by that
        recipient. CampusMesh does not collect, split or hold this money. No
        platform fee is charged for these rentals.
      </p>
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
                Accept rental request
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
          Deposit refund receipt confirmed by the renter.
        </p>
      )}
      {rental?.delivery_requested && (
        <p className="text-sm">
          Outbound delivery: {money(rental.delivery_fee)}, paid separately after
          verified handover. A courier return has its own fee.
        </p>
      )}
      {rental?.return_workflow?.requested && Number(rental.deposit_amount)>0 && !rental.return_workflow.refund_account_ready && user.id===rental.borrower_id && (
        <div className="space-y-3">
          <p className="text-sm font-semibold">Add your receiving UPI account here for the {money(rental.deposit_amount)} deposit refund. This does not pay anyone or approve the item condition.</p>
          <UpiProfile compact onSaved={async () => { await load(); await onChange?.(); }} />
        </div>
      )}
      {rental?.deposit_status === "REFUND_PENDING" && !items.some(p => p.kind === "DEPOSIT_REFUND") && (
        <div className="rounded-xl bg-amber-50 p-4 text-amber-950">
          <p>Deposit refund: {money(rental.deposit_amount)}.</p>
          <p className="mt-2 text-sm leading-6">{rental.return_workflow?.refund_account_ready
            ? 'The receiving account is ready. Refresh payments to load the refund request. The lender sends the refund and the renter confirms bank receipt.'
            : user.id===rental.borrower_id
              ? 'Save your own receiving UPI details in the form above. Your refund request will appear automatically after the owner approves the item condition.'
              : 'Waiting for the renter to add their receiving UPI details on this rental page. Their refund request will appear automatically; you cannot enter bank details on their behalf.'}</p>
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
          <h3 className="font-bold">{deliveryId ? "Set up your receiving UPI account" : "No payment is due yet"}</h3>
          <p className="mt-2 text-sm leading-6 text-ink/75">{deliveryId ? "Save your receiving UPI ID in Payments, then refresh payments here so the borrower can pay your delivery fee." : "A rental payment QR appears after the lender accepts your request. Saving a UPI ID does not create an order or move money."}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link to="/marketplace" className="secondary-button">Browse items to rent</Link>
            <Link to="/account/rentals" className="secondary-button">Open my rental requests</Link>
          </div>
        </div>
      )}
      <Link
        to="/payouts"
        className="inline-block font-semibold text-mesh-800 underline"
      >
        Manage receiving UPI details and all payments
      </Link>
    </section>
  );
}
export default function DirectDashboard() {
  return (
    <main className="mx-auto max-w-5xl space-y-7 px-5 py-8">
      <h1 className="text-3xl font-bold">Payments & receipts</h1>
      <p>
        Rental fees and deposits go to the lender. Delivery fees go to the
        courier after handover. Refunds go back to the renter.
      </p>
      <UpiProfile />
      <DirectPayments />
    </main>
  );
}
