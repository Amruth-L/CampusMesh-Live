import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPin,
  PackageCheck,
  Truck,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listingImage } from "../../lib/assets";
import { campusLocationLabel, normalizeCampusLocations } from "../../lib/campus";

const dayMs = 86400000;
const iso = (date) =>
  date
    ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
        .toISOString()
        .slice(0, 10)
    : "";
const fromIso = (value) => (value ? new Date(`${value}T00:00:00`) : null);
const money = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function DateRangeCalendar({ value, onChange, blocked = [] }) {
  const [month, setMonth] = useState(() => new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array(first.getDay()).fill(null),
    ...Array.from(
      { length: days },
      (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1),
    ),
  ];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isBlocked = (date) =>
    blocked.some(
      (range) =>
        date >= fromIso(range.start_date || range.start) &&
        date <= fromIso(range.end_date || range.end),
    );
  const select = (date) => {
    if (!value?.from || value.to || date < value.from)
      onChange({ from: date, to: null });
    else onChange({ from: value.from, to: date });
  };
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          className="rounded-lg p-2 hover:bg-mesh-50"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft size={18} />
        </button>
        <strong className="text-sm">
          {month.toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric",
          })}
        </strong>
        <button
          type="button"
          className="rounded-lg p-2 hover:bg-mesh-50"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
          <span
            key={`${day}-${i}`}
            className="py-1 text-[10px] font-extrabold text-ink/35"
          >
            {day}
          </span>
        ))}
        {cells.map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />;
          const disabled = date < today || isBlocked(date);
          const chosen =
            (value?.from && iso(date) === iso(value.from)) ||
            (value?.to && iso(date) === iso(value.to));
          const between =
            value?.from && value?.to && date > value.from && date < value.to;
          return (
            <button
              type="button"
              key={iso(date)}
              disabled={disabled}
              onClick={() => select(date)}
              className={`aspect-square rounded-xl text-xs font-bold transition ${chosen ? "bg-mesh-600 text-white shadow-sm" : between ? "bg-mesh-100 text-mesh-800" : "hover:bg-mesh-50"} disabled:cursor-not-allowed disabled:text-ink/20 disabled:line-through`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-4 text-[11px] text-ink/45">
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-mesh-600" />
          Selected
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-ink/15" />
          Unavailable
        </span>
      </div>
    </div>
  );
}

export default function RentalDialog({ listing, onClose }) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: null, to: null });
  const [blocked, setBlocked] = useState([]);
  const [locations, setLocations] = useState([]);
  const [deliveryMode, setDeliveryMode] = useState("SELF_PICKUP");
  const [dropLocation, setDropLocation] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!listing) return;
    Promise.allSettled([
      api.get(`/listings/${listing.id}/availability`),
      api.get("/api/campus/locations"),
    ]).then(([availability, campus]) => {
      if (availability.status === "fulfilled")
        setBlocked(
          availability.value.data.blocked_ranges ||
            availability.value.data ||
            [],
        );
      if (campus.status === "fulfilled")
        setLocations(normalizeCampusLocations(campus.value.data));
    });
  }, [api, listing]);
  const pricing = useMemo(() => {
    const days =
      range.from && range.to
        ? Math.floor((range.to - range.from) / dayMs) + 1
        : 0;
    const rate = Number(
      listing?.rent_price ?? listing?.rentPrice ?? listing?.price ?? 0,
    );
    const rental = rate * days;
    const deposit = Number(listing?.deposit || 0);
    const delivery =
      deliveryMode === "DELIVERY" ? Number(listing?.delivery_charge || 20) : 0;
    const platform = days ? Math.max(5, Math.round(rental * 0.05)) : 0;
    return {
      days,
      rate,
      rental,
      deposit,
      delivery,
      platform,
      total: rental + deposit + delivery + platform,
    };
  }, [deliveryMode, listing, range]);
  if (!listing) return null;
  const valid =
    range.from && range.to && (deliveryMode === "SELF_PICKUP" || dropLocation);
  const payload = {
    item_id: listing.id,
    listing_id: listing.id,
    start_date: iso(range.from),
    end_date: iso(range.to),
    delivery_mode: deliveryMode,
    delivery_requested: deliveryMode === "DELIVERY",
    drop_location_id: dropLocation || null,
    pricing,
  };
  const addToCart = async () => {
    if (!valid)
      return setNotice("Choose your dates and delivery details first.");
    setSaving(true);
    try {
      await api.post("/api/cart/add", payload);
      window.dispatchEvent(new Event("cart-updated"));
      setNotice("Added to cart. Your dates are reserved at checkout.");
    } catch (error) {
      setNotice(
        error.response?.data?.error || "Could not add this item to cart.",
      );
    } finally {
      setSaving(false);
    }
  };
  const rentNow = () => {
    if (!valid)
      return setNotice("Choose your dates and delivery details first.");
    navigate(
      `/rent-summary/${listing.id}?start_date=${payload.start_date}&end_date=${payload.end_date}`,
      { state: payload },
    );
  };
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-3 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(event) =>
          event.target === event.currentTarget && onClose()
        }
      >
        <motion.section
          role="dialog"
          aria-modal="true"
          className="max-h-[calc(100vh-1.5rem)] w-full max-w-5xl overflow-y-auto overscroll-contain rounded-[28px] bg-paper shadow-2xl"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 340, damping: 30 }}
        >
          <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4 sm:px-7">
            <div>
              <p className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">Configure rental</p>
              <h2 className="mt-1 text-xl font-extrabold">
                Choose dates and handover
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-ink/10 bg-white p-2 hover:bg-mesh-50"
            >
              <X size={19} />
            </button>
          </div>
          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <div className="mb-5 flex gap-4">
                <img
                  className="size-24 rounded-2xl object-cover"
                  src={listingImage(listing)}
                  alt=""
                />
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-mesh-900/10 bg-white/80 px-3 py-1 text-xs font-bold text-mesh-700">
                    {listing.category || "Campus item"}
                  </span>
                  <h3 className="mt-2 text-lg font-extrabold">
                    {listing.title}
                  </h3>
                  <p className="mt-1 text-sm text-ink/50">
                    {money(pricing.rate)} / day · Deposit{" "}
                    {money(pricing.deposit)}
                  </p>
                </div>
              </div>
              <DateRangeCalendar
                value={range}
                onChange={setRange}
                blocked={blocked}
              />
            </div>
            <div className="space-y-4">
              <div className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] p-4">
                <p className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 mb-3">Handover method</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeliveryMode("SELF_PICKUP")}
                    className={`rounded-2xl border p-3 text-left transition ${deliveryMode === "SELF_PICKUP" ? "border-mesh-500 bg-mesh-50" : "border-ink/10 bg-white"}`}
                  >
                    <PackageCheck size={19} />
                    <b className="mt-2 block text-sm">Self pickup</b>
                    <small className="text-ink/45">Meet the owner</small>
                  </button>
                  <button
                    type="button"
                    disabled={
                      !listing.delivery_available && !listing.deliveryAvailable
                    }
                    onClick={() => setDeliveryMode("DELIVERY")}
                    className={`rounded-2xl border p-3 text-left transition disabled:opacity-35 ${deliveryMode === "DELIVERY" ? "border-mesh-500 bg-mesh-50" : "border-ink/10 bg-white"}`}
                  >
                    <Truck size={19} />
                    <b className="mt-2 block text-sm">Campus delivery</b>
                    <small className="text-ink/45">
                      Secure courier handover
                    </small>
                  </button>
                </div>
                {deliveryMode === "DELIVERY" && (
                  <label className="mt-4 block">
                    <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 mb-1.5 flex items-center gap-1">
                      <MapPin size={13} /> Drop location
                    </span>
                    <select
                      className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                      value={dropLocation}
                      onChange={(e) => setDropLocation(e.target.value)}
                    >
                      <option value="">Choose campus location</option>
                      {locations.length ? locations.map((location) => (
                        <option key={location.id || location.name} value={location.id || location.name}>
                          {campusLocationLabel(location)}
                        </option>
                      )) : <option value="" disabled>No campus locations available</option>}
                    </select>
                  </label>
                )}
              </div>
              <div className="rounded-2xl bg-ink p-5 text-white">
                <div className="mb-4 flex items-center gap-2">
                  <CalendarDays size={18} />
                  <b>
                    {pricing.days
                      ? `${pricing.days} rental day${pricing.days > 1 ? "s" : ""}`
                      : "Select a date range"}
                  </b>
                </div>
                {[
                  ["Rental", pricing.rental],
                  ["Refundable deposit", pricing.deposit],
                  ["Delivery", pricing.delivery],
                  ["Platform fee", pricing.platform],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between py-1.5 text-sm text-white/65"
                  >
                    <span>{label}</span>
                    <span>{money(value)}</span>
                  </div>
                ))}
                <div className="mt-3 flex justify-between border-t border-white/15 pt-4 text-lg font-extrabold">
                  <span>Total</span>
                  <span>{money(pricing.total)}</span>
                </div>
              </div>
              {notice && (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl bg-mesh-50 p-3 text-sm font-semibold text-mesh-800"
                >
                  {notice}
                </motion.p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={addToCart}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-mesh-900/15 bg-white px-5 text-sm font-bold text-ink transition hover:-translate-y-0.5 hover:border-mesh-500 hover:bg-mesh-50"
                >
                  {saving ? "Adding…" : "Add to cart"}
                </button>
                <button type="button" onClick={rentNow} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50">
                  Rent now
                </button>
              </div>
            </div>
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}
