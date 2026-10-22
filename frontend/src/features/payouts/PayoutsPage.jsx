import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  Building2,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import BankOnboardingForm from './BankOnboardingForm';
const money = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(n || 0),
  );
const labels = {
  AWAITING_SETUP: "Awaiting payout setup",
  AWAITING_FUNDING: "Awaiting fee payment",
  READY: "Ready for transfer",
  SUBMITTING: "Confirming transfer",
  PENDING: "Provider processing",
  TRANSFERRED: "Awaiting bank settlement",
  SETTLED: "Bank settlement confirmed",
  FAILED: "Transfer failed",
  REVIEW_REQUIRED: "Needs support review",
  REVERSED: "Transfer reversed",
};
const accountLabels = {
  NOT_STARTED: "Set up bank payouts",
  REQUESTED: "Bank details needed",
  PENDING: "Verification pending",
  ACTIVE: "Bank account verified",
  NEEDS_ATTENTION: "Verification needs attention",
};
async function request(path = "", method = "GET", body, signal) {
  const response = await fetch(`${API_BASE_URL}/api/payouts${path}`, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Could not load payouts. Please retry.");
  return data;
}
export default function PayoutsPage() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const [bank, setBank] = useState({
    beneficiary_name: "",
    account_number: "",
    ifsc: "",
    confirm: false,
  });
  const load = useCallback(async (signal) => {
    try {
      setData(await request("", "GET", undefined, signal));
      setError("");
      setLoadError(false);
    } catch (err) {
      if (err.name !== "AbortError") { setError(err.message); setLoadError(true); }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function action(key, path, method = "POST", body) {
    setBusy(key);
    setError("");
    setLoadError(false);
    setNotice("");
    try {
      const result = await request(path, method, body);
      if (key === "bank")
        setBank({
          beneficiary_name: "",
          account_number: "",
          ifsc: "",
          confirm: false,
        });
      setNotice(
        key === 'onboard'
          ? result.status === 'ACTIVE' ? 'Your bank account is verified. Eligible earnings can now be processed.' : 'Details submitted. Razorpay is checking your bank account. Refresh verification to check progress.'
          : key === "setup"
          ? "Setup requested. Contact CampusMesh support to complete the provider’s recipient verification."
          : "Latest provider status loaded.",
      );
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy("");
    }
  }
  const service = data?.service,
    account = data?.account;
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Bank payouts
          </h1>
          <p className="mt-3 max-w-xl text-base text-ink/65">
            Add your bank account and track your rental and delivery earnings.
          </p>
        </div>
        <button
          disabled={
            Boolean(busy) ||
            !data?.service.configured ||
            !data?.account.canRefresh
          }
          className="secondary-button gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => action("refresh", "/account/refresh")}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {busy === "refresh" ? "Checking…" : "Refresh verification"}
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-800"
        >
          {error}
          {loadError && <button
            className="ml-3 font-semibold underline"
            onClick={() => load()}
          >
            Retry loading
          </button>}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-mesh-50 p-4 text-base text-mesh-900"
        >
          {notice}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="py-12 text-ink/60">
          Loading payout records…
        </p>
      )}
      {data && (
        <>
          <section
            aria-label="Payout service status"
            className="rounded-xl border border-ink/15 bg-white p-5 sm:p-6"
          >
            <div className="flex items-start gap-3">
              <Building2
                className="mt-1 shrink-0 text-mesh-700"
                size={22}
                aria-hidden="true"
              />
              <div>
                <h2 className="text-lg font-semibold">
                  {!service.configured ? 'Bank payouts unavailable' : accountLabels[account.status]}
                </h2>
                <p className="mt-2 text-base text-ink/70">
                  {!service.configured ? service.message
                    : account.needsReview ? 'Your account needs support review before payouts can continue.'
                    : account.canOnboard ? 'Complete the form below to connect your bank account.'
                    : account.status === 'ACTIVE' ? 'Your recipient account is ready for eligible payouts.'
                    : account.status === 'NEEDS_ATTENTION' ? 'Razorpay needs more information. Contact payout support to resolve the verification issue.'
                    : 'Your details have been submitted. Razorpay must verify the bank account before earnings can be transferred.'}
                </p>
                <p className={`mt-2 text-sm font-semibold ${service.mode === 'live' ? 'text-mesh-800' : 'text-amber-900'}`}>
                  {service.mode === 'live' ? 'Live collection keys configured · bank payouts require separate approval' : service.mode === 'test' ? 'Test mode · no real money moves' : 'Payment service not configured'}
                </p>
                {account.bankLast4 && (
                  <p className="mt-2 text-base font-medium">
                    {account.beneficiaryName} · Account ending{" "}
                    {account.bankLast4}
                  </p>
                )}
                {account.verifiedAt && (
                  <p className="mt-1 text-sm text-ink/60">
                    Last verified{" "}
                    {new Date(account.verifiedAt).toLocaleString("en-IN")}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              {account.status === "NOT_STARTED" && !service.configured && (
                <button
                  className="inline-flex min-h-12 items-center justify-center rounded-lg bg-mesh-700 px-5 text-base font-semibold text-white hover:bg-mesh-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(busy)}
                  onClick={() => action("setup", "/setup")}
                >
                  {busy === "setup"
                    ? "Sending request…"
                    : "Request payout setup"}
                </button>
              )}
              <Link className="secondary-button" to="/support">
                Get payout support
              </Link>
            </div>
          </section>
          {service.configured && account.canOnboard && (
            <BankOnboardingForm busy={Boolean(busy)} retry={account.setupRetry}
              onSubmit={(body) => action('onboard', '/account/onboard', 'POST', body)} />
          )}
          <section aria-labelledby="payout-flow-title" className="space-y-3">
            <h2 id="payout-flow-title" className="text-lg font-semibold">How money reaches your bank</h2>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink/75">
              <li>The renter pays CampusMesh through Razorpay. The payment must be confirmed as captured.</li>
              <li>Your rental earnings become eligible after you confirm the return. Delivery earnings become eligible after verified handover. The refundable deposit is kept separate.</li>
              <li>Razorpay Route transfers eligible earnings to your verified recipient account, then settles them to your bank on its settlement schedule. We show “Bank settlement confirmed” only after provider confirmation.</li>
            </ol>
          </section>
          {service.mode === "test" && (
            <p className="text-base font-medium text-amber-800">
              Test records only. These amounts do not represent money in a bank
              account.
            </p>
          )}
          <dl className="grid gap-5 border-y border-ink/10 py-6 sm:grid-cols-3">
            {[
              [
                service.mode === "live"
                  ? "Bank settlement confirmed"
                  : "Simulated settlement",
                data.totals.settled,
              ],
              ["Transfer processing", data.totals.processing],
              ["Awaiting setup or review", data.totals.awaiting],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-ink/65">{label}</dt>
                <dd className="mt-2 text-3xl font-semibold tabular-nums text-ink">
                  {money(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-ink/60">
            Totals cover the current payment mode. Historical records and other
            payment modes are listed separately below.
          </p>
          {account.bankEditable && service.configured && (
            <section className="rounded-xl border border-ink/15 bg-white p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Update payout bank</h2>
              <p id="bank-hint" className="mt-2 text-sm leading-6 text-ink/65">
                Enter an account you own. The provider verifies changes before
                further payouts. Bank changes are blocked while a transfer is
                awaiting confirmation.
              </p>
              <form
                className="mt-5 grid gap-5 sm:grid-cols-2"
                aria-describedby="bank-hint"
                onSubmit={(e) => {
                  e.preventDefault();
                  action("bank", "/account/bank", "PUT", bank);
                }}
              >
                {[
                  ["beneficiary_name", "Account-holder name", "text"],
                  ["account_number", "Bank account number", "password"],
                  ["ifsc", "IFSC code", "text"],
                ].map(([field, label, type]) => (
                  <label key={field} className="block text-base font-medium">
                    {label}
                    <input
                      required
                      autoComplete="off"
                      type={type}
                      inputMode={
                        field === "account_number" ? "numeric" : "text"
                      }
                      maxLength={
                        field === "beneficiary_name"
                          ? 120
                          : field === "account_number"
                            ? 18
                            : 11
                      }
                      minLength={field === "account_number" ? 9 : 2}
                      className="mt-2 h-12 w-full rounded-lg border border-ink/20 px-3 text-base focus:border-mesh-600 focus:outline-none focus:ring-2 focus:ring-mesh-200"
                      value={bank[field]}
                      onChange={(e) =>
                        setBank({ ...bank, [field]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label className="flex items-start gap-3 text-base sm:col-span-2">
                  <input
                    type="checkbox"
                    required
                    checked={bank.confirm}
                    onChange={(e) =>
                      setBank({ ...bank, confirm: e.target.checked })
                    }
                    className="mt-1 size-4 accent-mesh-700"
                  />
                  <span>I own this account and checked the details.</span>
                </label>
                <button
                  className="inline-flex min-h-12 items-center justify-center justify-self-start rounded-lg bg-mesh-700 px-5 text-base font-semibold text-white hover:bg-mesh-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(busy)}
                >
                  {busy === "bank" ? "Submitting…" : "Submit for verification"}
                </button>
              </form>
            </section>
          )}
          <section>
            <div className="mb-4">
              <h2 className="text-xl font-semibold">Payout activity</h2>
              <p className="mt-2 text-sm leading-6 text-ink/65">
                {data.policy}
              </p>
            </div>
            {!data.items.length ? (
              <div className="rounded-xl border border-ink/15 bg-white px-5 py-10">
                <ArrowDownToLine
                  className="mb-3 text-mesh-700"
                  aria-hidden="true"
                />
                <h3 className="text-lg font-semibold">
                  No eligible payouts yet
                </h3>
                <p className="mt-2 text-base text-ink/65">
                  Verified deliveries and completed, inspected rentals appear
                  here. Booking payment alone does not mark money as paid to
                  you.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-ink/10">
                {data.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-4 py-5 sm:flex-row sm:justify-between"
                  >
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-semibold">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-sm text-ink/65">
                        {item.kind === "LENDER"
                          ? "Rental earnings"
                          : item.kind === "WISH_REIMBURSEMENT"
                            ? "Wish Box reimbursement · includes item costs"
                            : "Delivery earnings"}{" "}
                        ·{" "}
                        {item.gateway_mode === "legacy"
                          ? "Historical record · needs review"
                          : `${item.gateway_mode} mode`}
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-sm font-medium">
                        {item.status === "SETTLED" && (
                          <CheckCircle2 size={16} aria-hidden="true" />
                        )}
                        {labels[item.status]}
                      </p>
                      {item.reason && (
                        <p className="mt-1 max-w-xl text-sm text-ink/65">
                          {item.reason}
                        </p>
                      )}
                      {item.gateway_transfer_id && (
                        <p className="mt-2 break-all text-sm text-ink/55">
                          Transfer reference: {item.gateway_transfer_id}
                        </p>
                      )}
                      {item.settlement_id && (
                        <p className="mt-1 break-all text-sm text-ink/55">
                          Settlement reference: {item.settlement_id}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 sm:text-right">
                      <p className="text-xl font-semibold tabular-nums">
                        {money(item.amount)}
                      </p>
                      {item.gateway_mode === service.mode &&
                        [
                          "SUBMITTING",
                          "PENDING",
                          "TRANSFERRED",
                          "REVIEW_REQUIRED",
                          "FAILED",
                        ].includes(item.status) && (
                          <button
                            disabled={Boolean(busy) || !service.configured}
                            className="mt-3 text-sm font-semibold text-mesh-700 underline"
                            onClick={() =>
                              action(item.id, `/${item.id}/refresh`)
                            }
                          >
                            {busy === item.id
                              ? "Checking…"
                              : "Check transfer status"}
                          </button>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
