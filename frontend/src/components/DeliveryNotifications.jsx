import { paymentAction, paymentNames, paymentNeedsAction } from "../lib/payment-actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Truck, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { useAuth } from "../context/AuthContext";
import { API_BASE_URL } from "../lib/api";
import DeliveryOfferCard from "../features/delivery/components/DeliveryOfferCard";

export default function DeliveryNotifications() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const [offers, setOffers] = useState([]);
  const [wishes, setWishes] = useState([]);
  const [returns, setReturns] = useState([]);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [paymentError, setPaymentError] = useState("");
  const [wishToast, setWishToast] = useState(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [now, setNow] = useState(Date.now());
  const seen = useRef(new Set());
  const panel = useRef(null);
  const load = useCallback(async () => {
    try {
      const [delivery, mine, board, ownerInbox] = await Promise.all([
        api.get("/api/delivery/available"),
        api.get("/api/wishes"),
        api.get("/api/wishes?view=board"),
        api.get("/api/rentals/my-listings-requests"),
      ]);
      const data = delivery.data;
      setReturns((ownerInbox.data.requests || []).filter(request => request.return_actionable || request.actionable));
      const wishList = [
        ...mine.data.requests
          .filter((w) =>
            ["QUOTED", "PAYMENT_PENDING", "IN_DELIVERY"].includes(w.status),
          )
          .map((w) => ({ ...w, to: "/wish-box" })),
        ...board.data.requests
          .filter(
            (w) =>
              (w.courier_id === user.id &&
                !["COMPLETED", "CANCELLED"].includes(w.status)) ||
              (board.data.available && w.status === "OPEN"),
          )
          .map((w) => ({ ...w, to: "/delivery/wishes" })),
      ];
      setWishes(wishList);
      const freshWish = wishList.find(
        (w) =>
          !seen.current.has(`wish:${w.id}:${w.status}:${w.current_quote_id}`),
      );
      wishList.forEach((w) =>
        seen.current.add(`wish:${w.id}:${w.status}:${w.current_quote_id}`),
      );
      if (freshWish) setWishToast(freshWish);
      else
        setWishToast(
          (current) => wishList.find((w) => w.id === current?.id) || null,
        );
      const list = data.deliveries || [];
      setOffers(list);
      setError("");
      const fresh = list.filter(
        (offer) =>
          !seen.current.has(`${offer.offer_id}:${offer.offer_created_at}`),
      );
      list.forEach((offer) =>
        seen.current.add(`${offer.offer_id}:${offer.offer_created_at}`),
      );
      if (fresh.length) setToast(fresh[0]);
      else
        setToast(
          (current) =>
            list.find((offer) => offer.offer_id === current?.offer_id) || null,
        );
    } catch {
      setError("Could not refresh delivery requests.");
    }
  }, [api, user.id]);
  useEffect(() => {
    let active = true;
    const refreshPayments = async () => {
      try {
        const { data } = await api.get('/api/direct-upi/payments');
        if (active) { setPaymentRequests(data.filter(payment => paymentNeedsAction(payment, user.id))); setPaymentError(''); }
      } catch {
        if (active) setPaymentError('Payment notifications could not refresh. Open Payments to retry.');
      }
    };
    refreshPayments();
    const socket = io(API_BASE_URL, { auth: { token: localStorage.getItem('token') } });
    ['connect', 'direct-payment:updated', 'rental:status'].forEach(event => socket.on(event, refreshPayments));
    const timer = setInterval(refreshPayments, 15000);
    window.addEventListener('focus', refreshPayments);
    window.addEventListener('campusmesh:payment-change', refreshPayments);
    return () => { active = false; clearInterval(timer); socket.close(); window.removeEventListener('focus', refreshPayments); window.removeEventListener('campusmesh:payment-change', refreshPayments); };
  }, [api, user.id]);
  useEffect(() => {
    seen.current.clear();
    load();
    const socket = io(API_BASE_URL, {
      auth: { token: localStorage.getItem("token") },
    });
    [
      "connect",
      "delivery:offer",
      "delivery:offer-unavailable",
      "delivery:assigned",
      "delivery:completed",
      "rental:status",
      "rental:request",
      "wish:new",
      "wish:status",
    ].forEach((event) => socket.on(event, load));
    const poll = setInterval(load, 15000);
    window.addEventListener("campusmesh:delivery-change", load);
    window.addEventListener("campusmesh:wish-change", load);
    return () => {
      socket.close();
      clearInterval(poll);
      window.removeEventListener("campusmesh:delivery-change", load);
      window.removeEventListener("campusmesh:wish-change", load);
    };
  }, [load, user.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (
        event.key === "Escape" ||
        (event.type === "pointerdown" && !panel.current?.contains(event.target))
      )
        setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  const respond = async (offer, action) => {
    if (busyId) return;
    setBusyId(offer.delivery_id);
    setError("");
    try {
      await api.post(`/api/delivery/${offer.delivery_id}/${action}`, { offer_id: offer.offer_id });
      setToast(null);
      window.dispatchEvent(new Event("campusmesh:delivery-change"));
      await load();
      if (action === "accept") {
        setOpen(false);
        navigate("/delivery?view=active");
      }
    } catch (caught) {
      await load();
      setError(
        caught.response?.data?.error ||
          "Could not update this request. Please retry.",
      );
    } finally {
      setBusyId("");
    }
  };
  const pending = offers.filter(
    (offer) => new Date(offer.offer_expires_at).getTime() > now,
  );
  return (
    <div ref={panel}>
      <button
        aria-label={`Notifications, ${pending.length + wishes.length + returns.length + paymentRequests.length} pending`}
        aria-expanded={open}
        aria-controls="delivery-notifications"
        onClick={() => {
          setOpen(!open);
          setToast(null);
          setWishToast(null);
        }}
        className="relative grid size-9 place-items-center rounded-lg hover:bg-paper"
      >
        <Bell size={20} />
        {pending.length + wishes.length + returns.length + paymentRequests.length > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-mesh-600 px-1 text-[10px] font-semibold text-white">
            {pending.length + wishes.length + returns.length + paymentRequests.length}
          </span>
        )}
      </button>
      {open && (
        <section
          id="delivery-notifications"
          aria-label="Notifications"
          className="fixed right-3 top-18 z-50 max-h-[calc(100dvh-10rem)] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-ink/15 bg-white shadow-lg"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink/10 bg-white p-4">
            <h2 className="text-sm font-semibold">
              Notifications{" "}
              <span className="ml-1 text-mesh-700">
                {pending.length + wishes.length + returns.length + paymentRequests.length}
              </span>
            </h2>
            <button
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
              className="p-1"
            >
              <X size={18} />
            </button>
          </div>
          <div className="space-y-3 p-3">
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-xs text-red-700"
              >
                {error}{" "}
                <button onClick={load} className="underline">
                  Retry
                </button>
              </p>
            )}
            {paymentError && <Link to="/payouts" onClick={() => setOpen(false)} className="block text-sm text-red-700 underline">{paymentError}</Link>}
            {paymentRequests.map(payment => <Link key={`payment:${payment.id}`} to={`/rent-details/${payment.rental_id}#payments`} onClick={() => setOpen(false)} className="block rounded-lg border border-mesh-200 bg-mesh-50 p-4">
              <b className="text-sm">{paymentAction(payment, user.id).label} · ₹{Number(payment.amount).toFixed(2)}</b>
              <p className="mt-1 text-xs">{paymentNames[payment.kind]} · {payment.title}</p>
            </Link>)}
            {returns.map(request => <Link key={request.id} to={`/rent-details/${request.id}`} onClick={() => setOpen(false)} className="block rounded-lg border border-amber-200 bg-amber-50 p-4">
              <b className="text-sm">{request.return_actionable ? "Return destination needed" : "Rental request needs your response"}</b>
              <p className="mt-1 text-xs">{request.return_actionable
                ? `${request.borrower_name} is returning ${request.listing_title}. Choose where to receive it before couriers are notified.`
                : `${request.borrower_name} requested ${request.listing_title}. Open the request to accept or decline.`}</p>
            </Link>)}
            {wishes.map((w) => (
              <Link
                key={w.id}
                to={w.to}
                onClick={() => {
                  setOpen(false);
                  setWishToast(null);
                }}
                className="block rounded-lg border border-mesh-200 bg-mesh-50 p-4"
              >
                <span className="text-[10px] font-semibold uppercase text-mesh-700">
                  Wish Box ·{" "}
                  {
                    {
                      OPEN: "New errand",
                      CHECKING: "Checking the shop",
                      QUOTED: "Price ready",
                      PAYMENT_PENDING: "Payment pending",
                      IN_DELIVERY: "Paid · In delivery",
                    }[w.status]
                  }
                </span>
                <b className="mt-1 block text-sm">{w.title}</b>
                <span className="mt-2 block text-xs text-ink/60">
                  {w.status === "QUOTED"
                    ? `Review total ₹${(w.amount_paise / 100).toFixed(2)}`
                    : "Open request →"}
                </span>
              </Link>
            ))}
            {pending.map((offer) => (
              <DeliveryOfferCard
                key={offer.offer_id}
                offer={offer}
                now={now}
                busyId={busyId}
                disabled={!!error}
                onAccept={(o) => respond(o, "accept")}
                onDecline={(o) => respond(o, "decline")}
              />
            ))}
            {!pending.length && !wishes.length && !returns.length && !paymentRequests.length && !error && !paymentError && (
              <div className="px-5 py-8 text-center">
                <Truck className="mx-auto text-ink/30" />
                <p className="mt-3 text-sm font-medium">
                  No pending requests
                </p>
                <p className="mt-2 text-xs leading-5 text-ink/60">
                  Enable errand alerts in Wish Box, or go online in the delivery dashboard.
                </p>
              </div>
            )}
          </div>
          <Link
            to="/delivery"
            onClick={() => setOpen(false)}
            className="block border-t border-ink/10 p-4 text-center text-sm font-medium text-mesh-700"
          >
            Open delivery dashboard
          </Link>
        </section>
      )}
      {!open && wishToast && (
        <div
          role="status"
          className="fixed right-3 top-20 z-50 flex w-[min(24rem,calc(100vw-1.5rem))] gap-3 rounded-xl border border-mesh-200 bg-white p-4 shadow-lg"
        >
          <Bell size={18} className="shrink-0 text-mesh-600" />
          <Link
            to={wishToast.to}
            onClick={() => setWishToast(null)}
            className="flex-1"
          >
            <b className="text-sm">Wish Box update</b>
            <p className="mt-1 text-xs">{wishToast.title}</p>
            <span className="mt-2 block text-xs text-mesh-700">
              Open request →
            </span>
          </Link>
          <button
            aria-label="Dismiss Wish Box notification"
            onClick={() => setWishToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {!open &&
        !wishToast &&
        toast &&
        new Date(toast.offer_expires_at).getTime() > now && (
          <div
            role="status"
            className="fixed right-3 top-20 z-50 flex w-[min(24rem,calc(100vw-1.5rem))] items-start gap-3 rounded-xl border border-mesh-200 bg-white p-4 shadow-lg"
          >
            <Bell size={19} className="mt-1 shrink-0 text-mesh-600" />
            <button
              className="flex-1 text-left"
              onClick={() => {
                setOpen(true);
                setToast(null);
              }}
            >
              <b className="text-sm">New delivery request</b>
              <p className="mt-1 text-xs leading-5 text-ink/60">
                {toast.customer_name || "A student"} requested{" "}
                {toast.listing_title || toast.item_description || "a delivery"}.
              </p>
              <span className="mt-2 block text-xs font-semibold text-mesh-700">
                View request · ₹
                {Number(
                  toast.courier_earning ?? toast.delivery_fee ?? 0,
                ).toFixed(0)}
              </span>
            </button>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
              className="p-1"
            >
              <X size={16} />
            </button>
          </div>
        )}
    </div>
  );
}
