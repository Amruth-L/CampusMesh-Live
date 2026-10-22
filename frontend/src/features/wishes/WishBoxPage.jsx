import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, MapPin, ArrowRight, Bell, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  normalizeCampusLocations,
  campusLocationLabel,
} from "../../lib/campus";
import { openRazorpayCheckout } from "../../utils/RazorpayService";
import HandoverCredential from "../../components/HandoverCredential";

const labels = {
  OPEN: "Looking for a student",
  CHECKING: "Checking the shop",
  QUOTED: "Price ready",
  PAYMENT_PENDING: "Payment pending",
  IN_DELIVERY: "Paid · Delivery in progress",
  COMPLETED: "Delivered",
  CANCELLED: "Cancelled",
};
const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0) / 100);
const field =
  "mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-mesh-600";
const errorText = (error) =>
  error.response?.data?.error ||
  error.message ||
  "Something went wrong. Please retry.";

function QuoteForm({ wish, busy, act }) {
  const [form, setForm] = useState({
    amount: "",
    pickup_place: wish.pickup_hint || "",
    note: "",
  });
  return (
    <form
      className="mt-5 space-y-3 border-t border-ink/10 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        act(wish, "quote", form);
      }}
    >
      <p className="text-sm font-semibold">Checked availability and price?</p>
      <label className="block text-xs font-medium">
        Total to pay (₹)
        <input
          required
          type="number"
          min="1"
          max="100000"
          step="0.01"
          className={field}
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
      </label>
      <p className="text-xs leading-5 text-ink/55">
        One final amount, including anything you charge for bringing it. The
        requester reviews this before paying.
      </p>
      <label className="block text-xs font-medium">
        Shop / collection address
        <input
          required
          maxLength={250}
          className={field}
          value={form.pickup_place}
          onChange={(e) => setForm({ ...form, pickup_place: e.target.value })}
        />
      </label>
      <label className="block text-xs font-medium">
        Explain the deal
        <textarea
          maxLength={500}
          className={field}
          rows={2}
          placeholder="What is available, quantity and what the total covers"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
      <button className="brand-button w-full" disabled={busy}>
        Send price to requester <ArrowRight size={15} />
      </button>
    </form>
  );
}

export default function WishBoxPage({ courier = false }) {
  const { api, user } = useAuth();
  const [requests, setRequests] = useState([]),
    [locations, setLocations] = useState([]);
  const [available, setAvailable] = useState(false),
    [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    details: "",
    pickup_hint: "",
    drop_location_id: "",
    drop_details: "",
  });
  const [tab, setTab] = useState("active");
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(
        `/api/wishes${courier ? "?view=board" : ""}`,
      );
      setRequests(data.requests);
      setAvailable(data.available);
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [api, courier]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    window.addEventListener("campusmesh:wish-change", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("campusmesh:wish-change", load);
    };
  }, [load]);
  useEffect(() => {
    if (!courier)
      api
        .get("/api/campus/locations")
        .then(({ data }) => setLocations(normalizeCampusLocations(data)))
        .catch((e) => setError(errorText(e)));
  }, [api, courier]);
  const refresh = async () => {
    await load();
    window.dispatchEvent(new Event("campusmesh:wish-change"));
    window.dispatchEvent(new Event("campusmesh:delivery-change"));
  };
  const act = async (wish, action, body = {}) => {
    if (busy) return;
    setBusy(wish.id);
    setNotice("");
    try {
      await api.post(`/api/wishes/${wish.id}/${action}`, body);
      setNotice(
        {
          claim: "Request taken. Check the shop and send your price.",
          quote: "Price sent. Wait for the requester to agree and pay.",
          decline: "Price declined. Your request is open for another student.",
          withdraw: "Request released for another student.",
          cancel: "Request cancelled.",
          "check-payment":
            "Payment confirmed. Your student can now collect the item.",
        }[action] || "Request updated.",
      );
      await refresh();
    } catch (e) {
      setNotice(errorText(e));
      await load();
    } finally {
      setBusy("");
    }
  };
  const pay = async (wish) => {
    if (busy) return;
    setBusy(wish.id);
    setNotice("");
    try {
      const { data } = await api.post(`/api/wishes/${wish.id}/order`, {
        quote_id: wish.current_quote_id,
      });
      await load();
      if (data.test_mode)
        setNotice(
          "Test checkout is enabled. This payment will not move real money.",
        );
      await openRazorpayCheckout({
        key: data.razorpay_key,
        amount: data.amount,
        currency: data.currency,
        order_id: data.order_id,
        description: `Wish Box · ${wish.title}`,
        prefill: user,
        handler: async (response) => {
          try {
            await api.post(`/api/wishes/${wish.id}/verify-payment`, response);
            setNotice(
              "Payment confirmed. Your student can collect and deliver your item.",
            );
            await refresh();
          } catch (e) {
            setNotice(`${errorText(e)} Use “Check payment” before retrying.`);
          } finally {
            setBusy("");
          }
        },
        modalDismissHandler: () => {
          setBusy("");
          setNotice(
            "Checkout closed. Your agreed price is saved. Check payment if you were charged, or retry checkout.",
          );
          load();
        },
      });
    } catch (e) {
      setNotice(errorText(e));
      setBusy("");
      await load();
    }
  };
  const create = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy("new");
    setNotice("");
    try {
      await api.post("/api/wishes", form);
      setForm({ ...form, title: "", details: "", pickup_hint: "" });
      setNotice("Request posted. Available students will see it in Wish Box.");
      await refresh();
    } catch (err) {
      setNotice(errorText(err));
    } finally {
      setBusy("");
    }
  };
  const toggle = async () => {
    if (busy) return;
    setBusy("availability");
    try {
      await api.put("/api/wishes/availability", { available: !available });
      setAvailable(!available);
      await refresh();
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const active = requests.filter(
    (w) => !["COMPLETED", "CANCELLED"].includes(w.status),
  );
  const displayed =
    tab === "history"
      ? requests.filter((w) => ["COMPLETED", "CANCELLED"].includes(w.status))
      : [...active].sort(
          (a, b) =>
            Number(b.courier_id === user.id) - Number(a.courier_id === user.id),
        );
  const own = active.filter((w) => w.courier_id === user.id);
  const completedValue = requests
    .filter((w) => w.status === "COMPLETED" && w.courier_id === user.id)
    .reduce((sum, w) => sum + Number(w.amount_paise || 0), 0);
  return (
    <main className="page-shell pb-28">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-mesh-700">
            <Sparkles size={15} /> CAMPUS ERRANDS
          </span>
          <h1 className="page-title">
            {courier ? "Wish Box errands" : "Wish Box"}
          </h1>
          <p className="page-copy max-w-xl">
            {courier
              ? "Coming to campus? Help someone get what they need on your way."
              : "Need something from outside? Ask a student heading to campus to bring it."}
          </p>
        </div>
        <Link
          className="secondary-button text-xs"
          to={courier ? "/wish-box" : "/delivery/wishes"}
        >
          {courier ? "My requests" : "Help with an errand"}{" "}
          <ArrowRight size={14} />
        </Link>
      </header>
      {courier ? (
        <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button
            role="switch"
            aria-checked={available}
            onClick={toggle}
            disabled={Boolean(busy)}
            className={`panel col-span-2 sm:col-span-1 p-5 text-left ${available ? "border-mesh-400 bg-mesh-50" : ""}`}
          >
            <Bell size={18} className="text-mesh-600" />
            <strong className="mt-3 block text-sm">
              {available ? "Available for errands" : "Turn on errand alerts"}
            </strong>
            <span className="mt-1 block text-xs text-ink/55">
              In-app alerts · No campus route needed
            </span>
          </button>
          <div className="panel p-5">
            <span className="text-xs text-ink/55">Your current requests</span>
            <strong className="mt-3 block text-2xl">{own.length}</strong>
          </div>
          <div className="panel p-5">
            <span className="text-xs text-ink/55">Completed deal value</span>
            <strong className="mt-3 block text-2xl">
              {money(completedValue)}
            </strong>
            <p className="mt-1 text-xs text-ink/50">
              Includes item costs; not net earnings.
            </p>
          </div>
        </div>
      ) : (
        <div className="my-6 grid grid-cols-3 gap-3 rounded-xl bg-mesh-50 p-4 text-xs leading-5 text-mesh-800">
          {[
            "1. Write what you need",
            "2. Review the student’s price",
            "3. Pay, then receive it",
          ].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
      {(notice || error) && (
        <div
          role="status"
          className={`my-5 rounded-lg p-4 text-sm ${error ? "bg-red-50 text-red-700" : "bg-mesh-50 text-mesh-800"}`}
        >
          {error || notice}
          <button className="ml-3 underline" onClick={load}>
            Refresh
          </button>
        </div>
      )}
      <div
        className={`grid items-start gap-7 ${courier ? "" : "lg:grid-cols-[350px_minmax(0,1fr)]"}`}
      >
        {!courier && (
          <form
            onSubmit={create}
            className={`panel space-y-4 p-5 ${active.length ? "order-2 lg:order-1" : ""}`}
          >
            <h2 className="text-lg font-semibold">What do you need?</h2>
            <label className="block text-xs font-medium">
              Request title
              <input
                required
                maxLength={120}
                className={field}
                placeholder="E.g. Collect my order from the pharmacy"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="block text-xs font-medium">
              Details
              <textarea
                required
                maxLength={1500}
                rows={4}
                className={field}
                placeholder="Exact item, quantity and any instructions. You’ll agree on the price before paying."
                value={form.details}
                onChange={(e) => setForm({ ...form, details: e.target.value })}
              />
            </label>
            <label className="block text-xs font-medium">
              Preferred shop / pickup (optional)
              <input
                maxLength={250}
                className={field}
                value={form.pickup_hint}
                onChange={(e) =>
                  setForm({ ...form, pickup_hint: e.target.value })
                }
              />
            </label>
            <label className="block text-xs font-medium">
              Campus drop-off
              <select
                required
                className={field}
                value={form.drop_location_id}
                onChange={(e) =>
                  setForm({ ...form, drop_location_id: e.target.value })
                }
              >
                <option value="">Choose a location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {campusLocationLabel(l)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Room / meeting instructions (optional)
              <input
                maxLength={250}
                className={field}
                value={form.drop_details}
                onChange={(e) =>
                  setForm({ ...form, drop_details: e.target.value })
                }
              />
            </label>
            <button disabled={Boolean(busy)} className="brand-button w-full">
              {busy === "new" ? "Posting…" : "Place request"}{" "}
              <ArrowRight size={16} />
            </button>
            <p className="text-xs leading-5 text-ink/50">
              Request details are visible to campus members browsing errands. No
              payment is needed to post.
            </p>
          </form>
        )}
        <section
          className={`min-w-0 ${active.length ? "order-1 lg:order-2" : ""}`}
        >
          <nav className="mb-5 flex items-center gap-5 border-b border-ink/10">
            {[
              ["active", courier ? "Open & current" : "My requests"],
              ["history", "History"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`border-b-2 pb-3 text-sm font-medium ${tab === id ? "border-mesh-600 text-mesh-700" : "border-transparent text-ink/50"}`}
              >
                {label}
                {id === "active" ? ` (${active.length})` : ""}
              </button>
            ))}
            <button onClick={load} className="ml-auto pb-3 text-xs text-ink/50">
              Refresh
            </button>
          </nav>
          {loading ? (
            <p className="panel p-8 text-sm text-ink/50">Loading requests…</p>
          ) : !displayed.length ? (
            <div className="panel p-10 text-center">
              <Sparkles className="mx-auto text-mesh-600" />
              <h2 className="mt-4 font-semibold">
                {tab === "history"
                  ? "No past requests yet"
                  : courier
                    ? "No errands right now"
                    : "Your next campus favour starts here"}
              </h2>
              <p className="mt-2 text-sm text-ink/55">
                {courier
                  ? "Keep errand alerts on to hear about new requests."
                  : "Post what you need and review the price when a student responds."}
              </p>
            </div>
          ) : (
            <div className={`grid gap-4 ${courier ? "xl:grid-cols-2" : ""}`}>
              {displayed.map((w) => {
                const assigned = w.courier_id === user.id;
                return (
                  <article key={w.id} className="panel p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${w.status === "QUOTED" ? "bg-mesh-100 text-mesh-800" : "bg-paper text-ink/60"}`}
                      >
                        {labels[w.status]}
                      </span>
                      <time className="text-[11px] text-ink/40">
                        {new Date(w.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </time>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold">{w.title}</h2>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink/65">
                      {w.details}
                    </p>
                    <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-ink/55">
                      <MapPin size={14} className="mt-0.5 shrink-0" />
                      {[
                        w.drop_building,
                        w.drop_floor,
                        w.drop_room,
                        w.drop_details,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {courier && w.route_note && <p className={`mt-3 rounded-lg p-3 text-xs leading-5 ${w.campus_route_fit ? 'bg-mesh-50 text-mesh-800' : 'bg-paper text-ink/55'}`}>{w.campus_route_fit && <b>Suggested for your campus route. </b>}{w.route_note}</p>}
                    {w.pickup_hint && (
                      <p className="mt-2 text-xs text-ink/60">
                        Preferred pickup: {w.pickup_hint}
                      </p>
                    )}
                    <p className="mt-3 text-xs font-medium">
                      {courier
                        ? `Requested by ${w.requester_name}`
                        : w.courier_name
                          ? `${w.courier_name} is helping you`
                          : "Waiting for an available student"}
                    </p>
                    {w.claim_expires_at && (
                      <p className="mt-2 text-[11px] text-ink/50">
                        {w.status === "QUOTED"
                          ? "Price valid"
                          : "Shop check reserved"}{" "}
                        until{" "}
                        {new Date(w.claim_expires_at).toLocaleTimeString(
                          "en-IN",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                        . Unconfirmed requests reopen automatically.
                      </p>
                    )}
                    {w.amount_paise && (
                      <div className="mt-4 rounded-lg bg-mesh-50 p-4">
                        <span className="text-xs text-mesh-800">
                          {["QUOTED", "PAYMENT_PENDING"].includes(w.status)
                            ? "Proposed total"
                            : "Agreed total"}
                        </span>
                        <strong className="mt-1 block text-2xl font-semibold">
                          {money(w.amount_paise)}
                        </strong>
                        <p className="mt-2 text-xs text-ink/65">
                          From {w.pickup_place}
                        </p>
                        {w.quote_note && (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-ink/65">
                            {w.quote_note}
                          </p>
                        )}
                      </div>
                    )}
                    {courier && w.status === "OPEN" && (
                      <button
                        disabled={Boolean(busy) || own.length > 0}
                        className="brand-button mt-4 w-full"
                        onClick={() => act(w, "claim")}
                      >
                        Take request & check price <ArrowRight size={15} />
                      </button>
                    )}
                    {courier && assigned && w.status === "CHECKING" && (
                      <QuoteForm wish={w} busy={Boolean(busy)} act={act} />
                    )}
                    {!courier &&
                      ["QUOTED", "PAYMENT_PENDING"].includes(w.status) && (
                        <div className="mt-4 space-y-3">
                          <p className="text-xs leading-5 text-ink/55">
                            {w.status === "QUOTED"
                              ? "Review the item and total above. Agreeing saves this deal and opens checkout."
                              : "This deal is saved. If checkout was interrupted, check payment before retrying."}
                          </p>
                          <button
                            disabled={Boolean(busy)}
                            className="brand-button w-full"
                            onClick={() => pay(w)}
                          >
                            {busy === w.id
                              ? "Opening / checking payment…"
                              : w.status === "QUOTED"
                                ? `Agree & pay ${money(w.amount_paise)}`
                                : "Retry saved payment"}
                          </button>
                          {w.status === "PAYMENT_PENDING" && (
                            <button
                              disabled={Boolean(busy)}
                              className="secondary-button w-full"
                              onClick={() => act(w, "check-payment")}
                            >
                              Check payment
                            </button>
                          )}
                          {w.status === "QUOTED" && (
                            <button
                              disabled={Boolean(busy)}
                              className="secondary-button w-full"
                              onClick={() => act(w, "decline")}
                            >
                              Decline price & reopen request
                            </button>
                          )}
                        </div>
                      )}
                    {courier &&
                      assigned &&
                      ["QUOTED", "PAYMENT_PENDING"].includes(w.status) && (
                        <p className="mt-4 rounded-lg border border-ink/10 p-3 text-xs leading-5">
                          Wait for confirmed payment before buying or collecting
                          the item.
                        </p>
                      )}
                    {w.status === "IN_DELIVERY" && (
                      <div className="mt-4 space-y-3">
                        <p className="flex items-center gap-2 text-sm font-medium text-mesh-700">
                          <CheckCircle2 size={16} />
                          {String(w.delivery_status || "")
                            .replaceAll("_", " ")
                            .toLowerCase()}
                        </p>
                        {courier ? (
                          <Link
                            className="brand-button w-full"
                            to="/delivery?view=active"
                          >
                            Continue delivery <ArrowRight size={15} />
                          </Link>
                        ) : w.delivery_status === "ARRIVED_AT_DESTINATION" ? (
                          <HandoverCredential
                            deliveryId={w.delivery_id}
                            stage="DELIVERY"
                            title="Confirm you received your item"
                          />
                        ) : (
                          <p className="text-xs leading-5 text-ink/55">
                            Your handover code unlocks when the student arrives.
                            Share it only after receiving the correct item.
                          </p>
                        )}
                      </div>
                    )}
                    {["OPEN", "CHECKING", "QUOTED"].includes(w.status) &&
                      (!courier || assigned) && (
                        <button
                          disabled={Boolean(busy)}
                          className="mt-4 text-xs text-ink/50 underline underline-offset-2"
                          onClick={() =>
                            act(w, courier ? "withdraw" : "cancel")
                          }
                        >
                          {courier ? "Release this request" : "Cancel request"}
                        </button>
                      )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
