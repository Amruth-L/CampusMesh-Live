import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  Package,
  Printer,
  RotateCcw,
  Truck,
} from "lucide-react";
import { Link } from "react-router-dom";

const formatCurrency = (val) => "₹" + Number(val || 0).toFixed(2);
const formatDateTime = (val) => {
  if (!val) return "—";
  const d = new Date(val);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const taskTypeConfig = {
  WISH_DELIVERY: { label: "Wish Box errand", tone: "border-mesh-200 bg-mesh-50 text-mesh-800", icon: Package },
  RENTAL_OUTBOUND: {
    label: "Rental Delivery",
    tone: "border-sky-200 bg-sky-50 text-sky-800",
    icon: Package,
  },
  RENTAL_RETURN: {
    label: "Rental Return",
    tone: "border-purple-200 bg-purple-50 text-purple-800",
    icon: RotateCcw,
  },
  XEROX_DELIVERY: {
    label: "Xerox Printout",
    tone: "border-amber-200 bg-amber-50 text-amber-800",
    icon: Printer,
  },
};

export default function CompletedDeliveries({ deliveries = [] }) {
  const [copiedId, setCopiedId] = useState("");
  const [filter, setFilter] = useState("ALL");

  const completedList = deliveries.filter(
    (item) => item.status === "COMPLETED" || item.status === "DELIVERED",
  );

  const filtered =
    filter === "ALL"
      ? completedList
      : completedList.filter((item) => item.task_type === filter);

  const totalEarnings = completedList.reduce(
    (acc, curr) => acc + Number(curr.courier_earning || 0),
    0,
  );

  const copyId = (id) => {
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(""), 1500);
  };

  return (
    <section className="panel p-5">
      {/* Section Header */}
      <div className="flex flex-col gap-4 border-b border-ink/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-mesh-50 text-mesh-700">
              <CheckCircle2 size={18} />
            </span>
            <span className="text-xs font-medium text-ink/65">
              Courier History
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-ink">
            Completed Deliveries
          </h2>
          <p className="mt-1 text-xs text-ink/50">
            Completed trips and the amount earned from each delivery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-2xl border border-mesh-200 bg-mesh-50/70 px-4 py-2 text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-mesh-800/60">
              Total Courier Earnings
            </span>
            <b className="text-xl font-semibold text-mesh-800">
              {formatCurrency(totalEarnings)}
            </b>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-paper px-4 py-2 text-right">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink/40">
              Successful
            </span>
            <b className="text-xl font-semibold text-ink">{completedList.length}</b>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      {completedList.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["ALL", "All Completed (" + completedList.length + ")"],
            ["RENTAL_OUTBOUND", "Rental Outbound"],
            ["RENTAL_RETURN", "Returns"],
            ["XEROX_DELIVERY", "Xerox Print"],
            ["WISH_DELIVERY", "Wish Box"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                filter === key
                  ? "bg-ink text-white shadow-sm"
                  : "border border-ink/10 bg-paper text-ink/60 hover:bg-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Empty State */}
      {filtered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-ink/15 bg-paper/40 p-10 text-center">
          <Truck className="mx-auto text-ink/20" size={32} />
          <h3 className="mt-3 font-semibold text-ink">No completed deliveries yet</h3>
          <p className="mt-1 max-w-sm mx-auto text-xs leading-5 text-ink/50">
            Complete your first delivery to see its earnings here.
          </p>
        </div>
      ) : (
        /* Deliveries List */
        <div className="mt-5 space-y-4">
          {filtered.map((item) => {
            const config = taskTypeConfig[item.task_type] || {
              label: "Delivery",
              tone: "border-ink/15 bg-paper text-ink/70",
              icon: Package,
            };
            const TaskIcon = config.icon;
            const completedTime =
              item.completed_at || item.delivered_at || item.updated_at;

            return (
              <article
                key={item.id}
                className="overflow-hidden rounded-2xl border border-ink/10 bg-white transition hover:border-mesh-300 hover:shadow-[0_8px_30px_rgba(35,58,40,.06)]"
              >
                <div className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-start">
                  <div className="flex items-start gap-4">
                    {/* Item Thumbnail */}
                    {item.listing_image ? (
                      <img
                        src={item.listing_image}
                        alt=""
                        className="size-16 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-mesh-50 text-mesh-700">
                        <TaskIcon size={24} />
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-ink">
                          {item.listing_title ||
                            item.item_description ||
                            "Campus Delivery"}
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${config.tone}`}
                        >
                          <TaskIcon size={12} />
                          {config.label}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-mesh-200 bg-mesh-50 px-2.5 py-0.5 text-[10px] font-semibold text-mesh-800">
                          <CheckCircle2 size={12} className="text-mesh-600" />
                          Delivered
                        </span>
                      </div>

                      {/* Route details */}
                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                        <div className="rounded-xl bg-paper p-2.5">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                            Pickup Point
                          </span>
                          <p className="mt-1 flex items-start gap-1.5 font-bold text-ink">
                            <MapPin size={14} className="mt-0.5 shrink-0 text-mesh-600" />
                            <span>{item.pickup_location || "Campus Pickup"}</span>
                          </p>
                          {item.seller_name && (
                            <span className="mt-1 block text-[11px] text-ink/50">
                              From: {item.seller_name}
                              {item.seller_hostel ? ` (${item.seller_hostel})` : ""}
                            </span>
                          )}
                        </div>

                        <div className="rounded-xl bg-paper p-2.5">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                            Drop-off Destination
                          </span>
                          <p className="mt-1 flex items-start gap-1.5 font-bold text-ink">
                            <MapPin size={14} className="mt-0.5 shrink-0 text-mesh-600" />
                            <span>{item.drop_location || "Campus Drop"}</span>
                          </p>
                          {item.customer_name && (
                            <span className="mt-1 block text-[11px] text-ink/50">
                              To: {item.customer_name}
                              {item.customer_hostel ? ` (${item.customer_hostel})` : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Time & Delivery ID */}
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-ink/50">
                        <span className="flex items-center gap-1">
                          <Clock size={13} className="text-mesh-600" />
                          Completed: <b>{formatDateTime(completedTime)}</b>
                        </span>
                        <button
                          onClick={() => copyId(item.id)}
                          className="flex items-center gap-1 hover:text-ink"
                        >
                          <Copy size={12} />
                          {copiedId === item.id ? "Copied ID!" : `ID: ${item.id.slice(0, 8)}…`}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Earnings & Actions on Right */}
                  <div className="flex shrink-0 flex-row items-center justify-between border-t border-ink/5 pt-3 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
                    <div className="text-left sm:text-right">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-mesh-700">
                        {item.task_type === "WISH_DELIVERY" ? "Deal value (includes item cost)" : "Delivery earning"}
                      </span>
                      <strong className="block text-2xl font-semibold text-mesh-700">
                        {item.task_type === "WISH_DELIVERY" ? formatCurrency(item.agreed_amount) : `+${formatCurrency(item.courier_earning)}`}
                      </strong>
                    </div>

                    <Link
                      to={item.task_type === "WISH_DELIVERY" ? "/delivery/wishes" : `/delivery/${item.id}/track`}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-ink/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 transition hover:border-mesh-500 hover:bg-mesh-50 hover:text-mesh-800"
                    >
                      <ExternalLink size={13} />
                      View details
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
