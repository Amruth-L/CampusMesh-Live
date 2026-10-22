import TrustDetails from "../intelligence/TrustDetails";
import { matchesRentalFilter, rentalProgress } from "../../lib/rental-status";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { io } from "socket.io-client";
import {
  AlertCircle,
  Bookmark,
  Check,
  ChevronRight,
  CirclePlus,
  Clock3,
  History,
  ListChecks,
  MapPin,
  Package,
  Pencil,
  Settings,
  Trash2,
  Truck,
} from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listingFallback } from "../../lib/assets";
import { API_BASE_URL } from "../../lib/api";
import HandoverCredential from "../../components/HandoverCredential";

const tabs = [
  ["rentals", "My rentals", Package],
  ["listings", "My listings", ListChecks],
  ["saved", "Saved", Bookmark],
  ["history", "History", History],
  ["settings", "Settings", Settings],
];
const statusStyle = (status) =>
  ({
    BOOKING_PAYMENT_PENDING: "bg-amber-50 text-amber-700",
    BOOKING_REQUESTED: "bg-blue-50 text-blue-700",
    RENTAL_PAYMENT_COMPLETED: "bg-blue-50 text-blue-700",
    OWNER_PENDING: "bg-amber-50 text-amber-700",
    DEPOSIT_PENDING: "bg-amber-50 text-amber-700",
    ACTIVE: "bg-mesh-50 text-mesh-700",
    COMPLETED: "bg-slate-100 text-slate-700",
    CANCELLED: "bg-red-50 text-red-700",
  })[status] || "bg-violet-50 text-violet-700";
const friendlyStatus = (status) =>
  String(status || "Requested")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());

function Empty({ icon: Icon, title, copy, action }) {
  return (
    <div className="rounded-xl border border-mesh-900/10 bg-white  grid min-h-64 place-items-center p-8 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-mesh-50 text-mesh-700">
          <Icon />
        </span>
        <h2 className="mt-4 text-lg font-semibold">{title}</h2>
        <p className="mt-1 max-w-md text-sm text-ink/50">{copy}</p>
        {action}
      </div>
    </div>
  );
}

function RentalsTab({ rentals }) {
  const [filter, setFilter] = useState("All");
  const filtered =
    filter === "All"
      ? rentals
      : rentals.filter((item) => matchesRentalFilter(item.status, filter));
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {["All", "Requested", "Active", "Completed"].map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${filter === item ? "bg-ink text-white" : "border border-ink/10 bg-white text-ink/55"}`}
          >
            {item}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <Empty
          icon={Clock3}
          title="No rentals in this view"
          copy="Your rentals appear here."
          action={
            <Link to="/marketplace" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 mt-5">
              Browse marketplace
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((rental) => (
            <motion.article
              layout
              key={rental.id}
              className="rounded-xl border border-mesh-900/10 bg-white  overflow-hidden"
            >
              <div className="grid gap-5 p-5 md:grid-cols-[92px_1fr_auto]">
                <img
                  className="size-23 rounded-2xl object-cover"
                  src={
                    rental.image_url || rental.listing_image || listingFallback
                  }
                  alt=""
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">
                      {rental.listing_title || rental.title || "Campus rental"}
                    </h2>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusStyle(rental.status)}`}
                    >
                      {rentalProgress(rental).awaitingOwner ? "Awaiting owner approval" : friendlyStatus(rental.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink/50">
                    {rental.start_date?.slice(0, 10)} →{" "}
                    {rental.end_date?.slice(0, 10)} · Owner:{" "}
                    {rental.owner_name || "Verified student"}
                  </p>
                  <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${["PAID", "RENTAL_PAID", "FULLY_PAID"].includes(String(rental.payment_status || "").toUpperCase()) ? "bg-mesh-50 text-mesh-700" : "bg-amber-50 text-amber-700"}`}>
                    {["PAID", "RENTAL_PAID", "FULLY_PAID"].includes(String(rental.payment_status || "").toUpperCase()) ? "Payment received" : "Payment pending"}
                  </span>
                  <RentalProgress rental={rental} />
                </div>
                <div className="flex items-center gap-2 md:flex-col md:items-end">
                  <strong className="text-mesh-700">
                    ₹
                    {Number(
                      rental.booking_amount || rental.total_price || 0,
                    ).toLocaleString("en-IN")}
                  </strong>
                  <Link
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-mesh-900/15 bg-white px-5 text-sm font-bold text-ink transition hover:-translate-y-0.5 hover:border-mesh-500 hover:bg-mesh-50 h-9 px-3"
                    to={`/rent-details/${rental.id}`}
                  >
                    Details <ChevronRight size={14} />
                  </Link>
                </div>
              </div>
              {rental.delivery_id && (
                <div className="flex items-center justify-between border-t border-ink/10 bg-mesh-50/55 px-5 py-3 text-xs">
                  <span className="font-bold text-mesh-800">
                    Courier tracking available
                  </span>
                  <Link
                    to={`/delivery/${rental.delivery_id}/track`}
                    className="font-semibold text-mesh-700"
                  >
                    Track delivery →
                  </Link>
                </div>
              )}
            </motion.article>
          ))}
        </div>
      )}
    </div>
  );
}

function RentalProgress({ rental }) {
  const { steps, message } = rentalProgress(rental);
  return (
    <div className="mt-4">
      <ol aria-label="Rental progress" className="flex flex-wrap gap-x-4 gap-y-3 text-xs font-semibold">
        {steps.map((step, index) => (
          <li key={step.id} aria-current={step.state === "current" ? "step" : undefined} className={`flex items-center gap-1.5 ${step.state === "complete" ? "text-mesh-700" : step.state === "current" ? "text-amber-800" : "text-ink/55"}`}>
            <span aria-hidden="true" className={`grid size-5 place-items-center rounded-full border ${step.state === "complete" ? "border-mesh-600 bg-mesh-600 text-white" : step.state === "current" ? "border-amber-500 bg-amber-50 text-amber-800" : "border-ink/20 bg-white"}`}>
              {step.state === "complete" ? <Check size={12} strokeWidth={3} /> : index + 1}
            </span>
            <span>{step.label}<span className="sr-only"> — {step.state === "complete" ? "complete" : step.state === "current" ? "awaiting action" : "pending"}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-5 text-ink/70">{message}</p>
    </div>
  );
}


const ownerStatusLabel = (request) => {
  if (request.return_actionable) return "Confirm return destination";
  if (request.actionable) return "Needs your response";
  if (request.status === "DEPOSIT_PENDING") return "Deposit pending";
  if (request.status === "MATCHING_COURIER") return "Finding courier";
  if (request.status === "NO_COURIER_AVAILABLE") return "Waiting for courier";
  if (request.delivery?.status === "COURIER_ASSIGNED") return "Courier assigned";
  if (request.delivery?.status === "ARRIVED_AT_PICKUP") return "Pickup verification";
  if (request.delivery?.status === "ARRIVED_AT_DESTINATION") return "Delivery verification";
  if (request.delivery?.status === "COMPLETED" || request.phase === "COMPLETED") return "Completed";
  return friendlyStatus(request.status);
};

const formatDate = (value) => value
  ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  : "—";

function ConnectionBadge({ state }) {
  const live = state === "live";
  const reconnecting = state === "reconnecting";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${live ? "border-mesh-200 bg-mesh-50 text-mesh-800" : reconnecting ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`}>
      <i className={`size-1.5 rounded-full ${live ? "bg-mesh-500" : reconnecting ? "bg-amber-500" : "bg-red-500"}`} />
      {live ? "Live" : reconnecting ? "Reconnecting" : "Backend disconnected"}
    </span>
  );
}

function OwnerRequestQueue({ requests, summary, loading, connection, error, responding, onRespond, selectedListingId, onClearFilter }) {
  const [requestFilter, setRequestFilter] = useState("pending");
  const pending = requests.filter((request) => request.actionable || request.return_actionable);
  const visible = selectedListingId
    ? requests.filter((request) => request.listing_id === selectedListingId)
    : requestFilter === "pending" ? pending : requests;

  return (
    <section id="incoming-rental-requests" className="mb-6 scroll-mt-44 rounded-xl border border-mesh-900/10 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-medium text-ink/65">Owner inbox</span>
          <h2 className="mt-1 text-xl font-semibold">Incoming rental requests</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink/65">Requests appear after the rental payment is confirmed. Accept a paid request to continue with the deposit and handover.</p>
        </div>
        <ConnectionBadge state={connection} />
      </div>

      <div className="mt-5 flex gap-2">{[['pending', `Needs response (${summary.pending || 0})`], ['all', `All requests (${summary.total || 0})`]].map(([id,label]) => <button key={id} onClick={() => setRequestFilter(id)} aria-pressed={requestFilter === id} className={`rounded-lg px-3 py-2 text-xs font-medium ${requestFilter === id ? 'bg-ink text-white' : 'bg-paper text-ink/60'}`}>{label}</button>)}</div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}. Existing requests are still shown.</span>
        </div>
      )}
      {selectedListingId && (
        <button onClick={onClearFilter} className="mt-4 text-xs font-semibold text-mesh-700 hover:text-mesh-900">
          Showing requests for one listing · Show all
        </button>
      )}
      {loading && requests.length === 0 ? (
        <div className="mt-5 h-28 animate-pulse rounded-2xl bg-ink/5" />
      ) : visible.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-ink/15 bg-paper/60 p-6 text-center">
          <Check className="mx-auto text-mesh-600" size={22} />
          <p className="mt-2 text-sm font-semibold">No requests in this view</p>
          <p className="mt-1 text-sm text-ink/60">Accept and Reject become available once the renter’s payment is verified. Unpaid checkout attempts are not submitted requests.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {visible.map((request) => (
            <article key={request.id} className={`rounded-2xl border p-4 ${request.actionable ? "border-amber-200 bg-amber-50/45" : "border-ink/10 bg-paper/35"}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <img src={request.listing_image || listingFallback} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{request.listing_title || "Campus rental"}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${request.actionable ? "bg-amber-100 text-amber-800" : "bg-white text-ink/55"}`}>{ownerStatusLabel(request)}</span>
                    {request.delivery_requested && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">Delivery requested</span>}
                  </div>
                  <p className="mt-1 text-sm text-ink/60">Requested by <strong className="text-ink">{request.borrower_name || "Verified student"}</strong>{request.borrower_hostel ? ` · ${request.borrower_hostel}` : ""}</p>
                  <TrustDetails rentalId={request.id}/>
                  <div className="mt-3 grid gap-2 text-xs text-ink/55 sm:grid-cols-2">
                    <span><b className="text-ink/75">Dates:</b> {formatDate(request.start_date)} → {formatDate(request.end_date)} · {request.rental_days || 0} days</span>
                    <span><b className="text-ink/75">Booking:</b> ₹{Number(request.booking_amount || 0).toLocaleString("en-IN")} · <b className="text-ink/75">Deposit:</b> ₹{Number(request.deposit_amount || 0).toLocaleString("en-IN")}</span>
                    {request.delivery_requested && <span className="flex items-start gap-1"><MapPin size={14} className="mt-0.5 shrink-0 text-mesh-600" /><span><b className="text-ink/75">Route:</b> {request.delivery?.pickup?.label || "Pickup location"} → {request.delivery?.destination?.label || request.drop_location_label || "Drop location"}</span></span>}
                    {request.delivery?.courier && <span className="flex items-center gap-1"><Truck size={14} className="text-mesh-600" /> Courier: <b className="text-ink/75">{request.delivery.courier.name}</b></span>}
                  </div>
                  <p className="mt-3 text-xs font-semibold text-mesh-800">Next: {request.next_action}</p>
                  {request.delivery?.task_type !== "RENTAL_RETURN" && request.delivery?.status === "ARRIVED_AT_PICKUP" && request.delivery?.id && (
                    <HandoverCredential deliveryId={request.delivery.id} stage="PICKUP" title="Show pickup QR & OTP to the courier" />
                  )}
                </div>
                <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
                  {request.actionable && <>
                    <button onClick={() => onRespond(request.id, "ACCEPTED")} disabled={!!responding[request.id]} className="min-h-11 rounded-xl bg-mesh-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-mesh-700 disabled:opacity-50">{responding[request.id] === "ACCEPTED" ? "Accepting…" : "Accept request"}</button>
                    <button onClick={() => onRespond(request.id, "REJECTED")} disabled={!!responding[request.id]} className="min-h-11 rounded-xl border border-red-200 bg-white px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50">{responding[request.id] === "REJECTED" ? "Rejecting…" : "Reject"}</button>
                  </>}
                  <Link to={`/rent-details/${request.id}`} className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-center text-xs font-semibold text-ink/65 transition hover:border-mesh-300 hover:bg-mesh-50">{request.return_actionable ? "Choose return destination" : "Details"}</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ListingsTab({ listings, onDelete, onToggle, onFocusRequests }) {
  return (
    <div>
      {listings.length === 0 ? (
        <Empty
          icon={CirclePlus}
          title="List your first item"
          copy="Share something useful."
          action={
            <Link to="/add-listing" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 mt-5">
              Create listing
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {listings.map((item) => (
            <article className="min-w-0 rounded-xl border border-mesh-900/10 bg-white flex gap-3 p-4" key={item.id}>
              <img
                className="size-16 shrink-0 rounded-lg object-cover sm:size-24"
                src={item.image_url || listingFallback}
                alt=""
              />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-ink/65">{item.category}</span>
                    <h2 className="truncate font-semibold">{item.title}</h2>
                  </div>
                  <span
                    className={`h-fit shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${item.is_active === false ? "bg-slate-100 text-slate-600" : "bg-mesh-50 text-mesh-700"}`}
                  >
                    {item.is_active === false ? "Paused" : "Active"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/50">
                  ₹{Number(item.rent_price || item.price || 0)}/day ·{" "}
                  <button type="button" onClick={() => onFocusRequests(item.id)} className="font-semibold text-mesh-700 underline-offset-2 hover:underline">
                    {item.request_count || 0} requests
                  </button>
                </p>
                <div className="mt-3 flex gap-2">
                  <Link
                    to={`/edit-listing/${item.id}`}
                    className="rounded-lg border border-ink/10 p-2 hover:bg-mesh-50"
                  >
                    <Pencil size={15} />
                  </Link>
                  <button
                    onClick={() => onToggle(item)}
                    className="rounded-lg border border-ink/10 px-3 text-xs font-bold hover:bg-mesh-50"
                  >
                    {item.is_active === false ? "Activate" : "Pause"}
                  </button>
                  <button
                    onClick={() => onDelete(item.id)}
                    className="ml-auto rounded-lg p-2 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SavedTab({ items, onRemove, onRent }) {
  return items.length === 0 ? (
    <Empty
      icon={Bookmark}
      title="Nothing saved yet"
      copy="Saved items appear here."
      action={
        <Link to="/marketplace" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 mt-5">
          Explore items
        </Link>
      }
    />
  ) : (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-mesh-900/10 bg-white  overflow-hidden">
          <img
            className="aspect-[16/9] w-full object-cover"
            src={item.image_url || listingFallback}
            alt=""
          />
          <div className="p-4">
            <span className="text-xs font-medium text-ink/65">{item.category}</span>
            <h2 className="mt-1 font-semibold">{item.title}</h2>
            <p className="mt-1 text-sm text-ink/50">
              ₹{Number(item.rent_price || item.price || 0)}/day
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => onRent(item)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 flex-1"
              >
                Rent now
              </button>
              <button
                onClick={() => onRemove(item.id)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-mesh-900/15 bg-white px-5 text-sm font-bold text-ink transition hover:-translate-y-0.5 hover:border-mesh-500 hover:bg-mesh-50 px-3"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}


function HistoryTab({ api }) {
  const [role, setRole] = useState("ALL");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (role !== "ALL") {
        if (role === "COMPLETED") params.set("status", "COMPLETED");
        else params.set("role", role);
      }
      const response = await api.get(`/api/activity/history?${params.toString()}`);
      setRecords(response.data?.records || []);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Could not load your activity history.");
    } finally {
      setLoading(false);
    }
  }, [api, role]);
  useEffect(() => { load(); }, [load]);

  const amountFor = (record) => {
    if (record.role === "OWNER") return ["Income", record.amounts.ownerEarning];
    if (record.role === "COURIER") return ["Payout", record.amounts.courierPayout];
    return ["Paid", record.amounts.renterPaid];
  };
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-xs font-medium text-ink/65">Activity ledger</span>
          <h2 className="mt-1 font-display text-3xl font-semibold">Your rental history</h2>
          <p className="mt-1 text-sm text-ink/50">One timeline for things you rented, listed, or delivered.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink/45"><span className="size-2 rounded-full bg-mesh-500" /> Live from CampusMesh</div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {["ALL", "RENTER", "OWNER", "COURIER", "COMPLETED"].map((filter) => (
          <button key={filter} onClick={() => setRole(filter)} className={`rounded-full px-3.5 py-2 text-xs font-semibold ${role === filter ? "bg-ink text-white" : "border border-ink/10 bg-white text-ink/55 hover:bg-mesh-50"}`}>
            {filter === "ALL" ? "All" : filter[0] + filter.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {error && <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"><AlertCircle size={15} /> {error}</div>}
      {loading ? (
        <div className="grid gap-3"><div className="h-40 animate-pulse rounded-3xl bg-ink/5" /><div className="h-40 animate-pulse rounded-3xl bg-ink/5" /></div>
      ) : records.length === 0 ? (
        <Empty icon={History} title="No activity in this view" copy="Completed rentals and delivery milestones will be kept here automatically." />
      ) : (
        <div className="space-y-4">
          {records.map((record) => {
            const [amountLabel, amount] = amountFor(record);
            return (
              <article key={record.id} className="overflow-hidden rounded-xl border border-mesh-900/10 bg-white ">
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
                  <img src={record.item.image || listingFallback} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{record.item.title}</h3>
                      <span className="rounded-full bg-mesh-50 px-2.5 py-1 text-[10px] font-semibold uppercase text-mesh-700">{record.role}</span>
                      <span className="rounded-full bg-paper px-2.5 py-1 text-[10px] font-semibold text-ink/55">{friendlyStatus(record.status)}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink/50">Owner: {record.participants.owner.name} · Renter: {record.participants.renter.name}{record.participants.courier ? ` · Courier: ${record.participants.courier.name}` : ""}</p>
                    <div className="mt-3 grid gap-2 text-xs text-ink/55 sm:grid-cols-3">
                      <span><b className="text-ink/75">{amountLabel}:</b> ₹{Number(amount || 0).toLocaleString("en-IN")}</span>
                      <span><b className="text-ink/75">Deposit:</b> ₹{Number(record.amounts.depositAmount || 0).toLocaleString("en-IN")}</span>
                      <span><b className="text-ink/75">Updated:</b> {formatDate(record.completed_at || record.created_at)}</span>
                    </div>
                  </div>
                </div>
                {record.events?.length > 0 && <div className="border-t border-ink/10 bg-paper/45 px-5 py-4"><p className="mb-3 text-[10px] font-semibold uppercase tracking-[.16em] text-mesh-600">Timeline</p><div className="grid gap-2 sm:grid-cols-2">{record.events.map((event) => <div key={event.id} className="flex items-center gap-2 text-xs text-ink/60"><span className="size-2 shrink-0 rounded-full bg-mesh-500" /><span className="font-bold text-ink/75">{event.label}</span><span className="truncate">· {formatDate(event.at)}</span></div>)}</div></div>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsTab({ user, save }) {
  const [form, setForm] = useState({
    name: user?.name || "",
    username: user?.username || "",
    email: user?.email || "",
    phone_number: user?.phone_number || "",
    department: user?.department || "",
    hostel: user?.hostel || "",
    bio: user?.bio || "",
  });
  const [state, setState] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return setState("Your name is required.");
    setState("saving");
    try {
      await save(form);
      setState("saved");
      setTimeout(() => setState(""), 1800);
    } catch (error) {
      setState(error.response?.data?.error || error.response?.data?.message || "Could not save your profile.");
    }
  };
  return (
    <form onSubmit={submit} className="rounded-xl border border-mesh-900/10 bg-white  max-w-3xl p-6 sm:p-8">
      <Link to="/payouts" className="mb-6 inline-flex text-sm font-semibold text-mesh-700 underline">Manage bank payouts</Link>
      <div className="mb-7 flex items-center gap-4">
        <span className="grid size-13 place-items-center rounded-full bg-mesh-600 font-semibold text-white">
          {user?.name?.slice(0, 1) || "C"}
        </span>
        <div>
          <h2 className="font-semibold">Profile</h2>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {[
          ["name", "Full name"],
          ["username", "Username"],
          ["email", "Campus email"],
          ["phone_number", "Phone number"],
          ["department", "Department"],
          ["hostel", "Hostel / block"],
        ].map(([name, label]) => (
          <label key={name}>
            <span className="text-xs font-medium text-ink/65 mb-1.5 block">{label}</span>
            <input
              className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              value={form[name]}
              type={name === "email" ? "email" : "text"}
              readOnly={name === "email"}
              onChange={(e) => setForm({ ...form, [name]: e.target.value })}
            />
            {name === "email" && <span className="mt-1.5 block text-xs text-ink/55">Your verified sign-in email cannot be edited here.</span>}
          </label>
        ))}
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-ink/65 mb-1.5 block">Short bio</span>
          <textarea
            rows="4"
            className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100 resize-none"
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </label>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <button className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50" disabled={state === "saving"}>
          {state === "saving" ? "Saving…" : "Save changes"}
        </button>
        {state === "saved" && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-1 text-sm font-bold text-mesh-700"
          >
            <Check size={16} /> Saved
          </motion.span>
        )}
        {state && !["saving", "saved"].includes(state) && (
          <span className="text-sm font-semibold text-red-600">{state}</span>
        )}
      </div>
    </form>
  );
}

export default function AccountPage({ workspace }) {
  const { tab = "rentals" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, api, updateProfile } = useAuth();
  const lending = workspace === "lend" || tab === "listings";
  const active = lending ? "listings" : tabs.some(([id]) => id === tab) ? tab : "rentals";
  const paymentConfirmation = location.state?.paymentConfirmation;
  const [data, setData] = useState({ rentals: [], listings: [], saved: [] });
  const [ownerRequests, setOwnerRequests] = useState([]);
  const [ownerSummary, setOwnerSummary] = useState({ pending: 0, active: 0, completed: 0, total: 0 });
  const [ownerLoading, setOwnerLoading] = useState(true);
  const [ownerError, setOwnerError] = useState("");
  const [ownerConnection, setOwnerConnection] = useState("reconnecting");
  const [responding, setResponding] = useState({});
  const [selectedListingId, setSelectedListingId] = useState("");
  const [lendingView, setLendingView] = useState("requests");
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState({});
  const [actionError, setActionError] = useState("");
  const loadOwnerRequests = useCallback(async () => {
    try {
      const response = await api.get("/api/rentals/my-listings-requests");
      const payload = response.data;
      const requests = Array.isArray(payload) ? payload : payload.requests || [];
      const pending = requests.filter((request) => request.actionable || ["OWNER_PENDING", "RENTAL_PAYMENT_COMPLETED"].includes(request.status)).length;
      setOwnerRequests(requests);
      setOwnerSummary(payload.summary || { pending, active: 0, completed: 0, total: requests.length });
      setOwnerError("");
    } catch (error) {
      setOwnerConnection("offline");
      setOwnerError(error.response?.data?.error || "Could not load incoming rental requests");
    } finally {
      setOwnerLoading(false);
    }
  }, [api]);
  const load = useCallback(async () => {
    setLoading(true);
    const [rentals, listings, saved] = await Promise.allSettled([
      api.get("/api/rentals/my-rentals"),
      api.get("/listings/mine"),
      api.get("/api/wishlist"),
    ]);
    setLoadErrors(Object.fromEntries([['rentals', rentals], ['listings', listings], ['saved', saved]]
      .filter(([, result]) => result.status === 'rejected')
      .map(([key]) => [key, `We couldn’t load your ${key}. Please retry.`])));
    setData((current) => ({
      rentals: rentals.status === "fulfilled" ? rentals.value.data : current.rentals,
      listings: listings.status === "fulfilled" ? listings.value.data : current.listings,
      saved: saved.status === "fulfilled" ? saved.value.data : current.saved,
    }));
    setLoading(false);
  }, [api]);
  useEffect(() => {
    load();
    loadOwnerRequests();
  }, [load, loadOwnerRequests]);
  useEffect(() => {
    const socket = io(API_BASE_URL, { auth: { token: localStorage.getItem("token") }, reconnectionAttempts: 5 });
    socket.on("connect", () => setOwnerConnection("live"));
    socket.on("disconnect", () => setOwnerConnection("reconnecting"));
    socket.on("connect_error", () => setOwnerConnection("offline"));
    const refresh = () => { loadOwnerRequests(); load(); };
    ["rental:request", "rental:status", "delivery:assigned", "delivery:status"].forEach((event) => socket.on(event, refresh));
    return () => socket.close();
  }, [loadOwnerRequests, load]);
  useEffect(() => {
    const interval = setInterval(loadOwnerRequests, ownerSummary.pending > 0 || ownerConnection !== "live" ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [loadOwnerRequests, ownerSummary.pending, ownerConnection]);
  const respondToRequest = useCallback(async (rentalId, response) => {
    setResponding((current) => ({ ...current, [rentalId]: response }));
    try {
      await api.post("/api/rentals/respond", { rental_id: rentalId, response });
      await loadOwnerRequests();
      setOwnerError("");
    } catch (error) {
      setOwnerError(error.response?.data?.error || "Could not update this rental request");
    } finally {
      setResponding((current) => ({ ...current, [rentalId]: null }));
    }
  }, [api, loadOwnerRequests]);
  const focusRequests = useCallback((listingId = "") => {
    setSelectedListingId(listingId);
    setLendingView("requests");
    navigate("/lend");
    window.setTimeout(() => document.getElementById("incoming-rental-requests")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [navigate]);
  const removeSaved = useCallback(async (id) => {
    setActionError("");
    try { await api.delete(`/api/wishlist/${id}`); }
    catch { setActionError("Could not remove the saved item. Please try again."); return; }
    setData((old) => ({
      ...old,
      saved: old.saved.filter((item) => item.id !== id),
    }));
  }, [api]);
  const deleteListing = useCallback(async (id) => {
    if (!window.confirm("Delete this listing?")) return;
    setActionError("");
    try { await api.delete(`/listings/${id}`); }
    catch (error) { setActionError(error.response?.data?.error || "Could not delete this listing."); return; }
    setData((old) => ({
      ...old,
      listings: old.listings.filter((item) => item.id !== id),
    }));
  }, [api]);
  const toggleListing = useCallback(async (item) => {
    const updated = { ...item, is_active: item.is_active === false };
    setActionError("");
    try { await api.put(`/listings/${item.id}`, { is_active: updated.is_active }); }
    catch (error) { setActionError(error.response?.data?.error || "Could not update this listing."); return; }
    setData((old) => ({
      ...old,
      listings: old.listings.map((row) => (row.id === item.id ? updated : row)),
    }));
  }, [api]);
  const content = useMemo(
    () =>
      ({
        rentals: <RentalsTab rentals={data.rentals} />,
        listings: (
          <>
            <nav aria-label="Lending sections" className="mb-5 flex gap-6 border-b border-ink/10">{[['requests', 'Rental requests'], ['items', 'My items']].map(([id, label]) => <button key={id} onClick={() => setLendingView(id)} aria-current={lendingView === id ? 'page' : undefined} className={`border-b-2 pb-3 text-sm font-semibold ${lendingView === id ? 'border-mesh-600 text-mesh-700' : 'border-transparent text-ink/55'}`}>{label}</button>)}</nav>
            {lendingView === 'requests' ? <OwnerRequestQueue
              requests={ownerRequests}
              summary={ownerSummary}
              loading={ownerLoading}
              connection={ownerConnection}
              error={ownerError}
              responding={responding}
              onRespond={respondToRequest}
              selectedListingId={selectedListingId}
              onClearFilter={() => setSelectedListingId("")}
            /> : <ListingsTab
              listings={data.listings}
              onDelete={deleteListing}
              onToggle={toggleListing}
              onFocusRequests={focusRequests}
            />}
          </>
        ),
        history: <HistoryTab api={api} />,
        saved: (
          <SavedTab
            items={data.saved}
            onRemove={removeSaved}
            onRent={(item) => navigate(`/marketplace?rent=${item.id}`)}
          />
        ),
        settings: <SettingsTab user={user} save={updateProfile} />,
      })[active],
    [active, lendingView, data, user, ownerRequests, ownerSummary, ownerLoading, ownerConnection, ownerError, responding, selectedListingId, api, respondToRequest, focusRequests, removeSaved, deleteListing, toggleListing, navigate, updateProfile],
  );
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-8 sm:py-12">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-title">{lending ? 'Lending dashboard' : active === 'settings' ? 'Account settings' : active === 'saved' ? 'Saved items' : active === 'history' ? 'Rental history' : 'My rentals'}</h1><p className="page-copy">{lending ? 'Manage your items, respond to requests, and arrange handovers.' : 'Track your requests, pickups, and returns.'}</p></div><Link to={lending ? '/add-listing' : '/marketplace'} className="brand-button text-sm"><CirclePlus size={17}/>{lending ? 'List an item' : 'Browse items'}</Link></header>
        <div className="mb-7 grid grid-cols-3 gap-3">
          {(lending ? [['Listed items', loading || loadErrors.listings ? '—' : data.listings.length], ['Pending requests', ownerLoading || ownerError ? '—' : ownerSummary.pending], ['Active rentals', ownerLoading || ownerError ? '—' : ownerSummary.active]] : [['Total rentals', loading || loadErrors.rentals ? '—' : data.rentals.length], ['Active rentals', loading || loadErrors.rentals ? '—' : data.rentals.filter(r => matchesRentalFilter(r.status, 'Active')).length], ['Saved items', loading || loadErrors.saved ? '—' : data.saved.length]]).map(([label,value]) => <div key={label} className="panel p-4 sm:p-5"><span className="text-xs text-ink/60">{label}</span><strong className="mt-3 block text-3xl font-semibold tracking-tight">{value}</strong></div>)}
        </div>
        {actionError && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{actionError}</p>}
        {paymentConfirmation && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 flex items-start gap-3 rounded-2xl border border-mesh-200 bg-mesh-50 p-4 text-sm"
            role="status"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mesh-600 text-white"><Check size={17} /></span>
            <div>
              <p className="font-semibold text-mesh-800">Payment received</p>
              <p className="mt-1 text-mesh-700">{paymentConfirmation.message || "Your rental request is now visible below."}</p>
            </div>
          </motion.div>
        )}
        <div className={lending ? "" : "grid items-start gap-6 lg:grid-cols-[200px_1fr]"}>
          {!lending && <aside className="rounded-xl border border-mesh-900/10 bg-white  p-2">
            <nav className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
              {tabs.filter(([id]) => id !== "listings").map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => navigate(`/account/${id}`)}
                  className={`relative isolate flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold ${active === id ? "text-mesh-800" : "text-ink/50 hover:bg-mesh-50"}`}
                >
                  {active === id && (
                    <motion.span
                      layoutId="account-tab"
                      className="absolute inset-0 -z-10 rounded-xl bg-mesh-100"
                    />
                  )}
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </nav>
          </aside>}
          <section>
            {loading ? (
              <div className="grid gap-4">
                <div className="h-36 animate-pulse rounded-3xl bg-ink/5" />
                <div className="h-36 animate-pulse rounded-3xl bg-ink/5" />
              </div>
            ) : (
              loadErrors[active] ? <div role="alert" className="rounded-2xl border border-red-200 bg-white p-8 text-center">
                <AlertCircle className="mx-auto text-red-500" /><h2 className="mt-4 font-semibold">Something didn’t load.</h2>
                <p className="mt-2 text-sm text-ink/65">{loadErrors[active]}</p><button onClick={load} className="brand-button mt-5">Try again</button>
              </div> : content
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
