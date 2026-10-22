import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  PackageOpen,
  ShoppingBag,
  Trash2,
  Truck,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listingFallback } from "../../lib/assets";
const money = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateValue = (value) => new Date(value).toISOString().slice(0, 10);
export default function Cart() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/cart");
      setItems(data);
      setSelected(data.map((item) => item.id));
    } catch (error) {
      setNotice(error.response?.data?.error || "Could not load your cart.");
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  const update = async (item, patch) => {
    try {
      const { data } = await api.put(`/api/cart/${item.id}`, {
        start_date: patch.start_date || dateValue(item.start_date),
        end_date: patch.end_date || dateValue(item.end_date),
        delivery_requested: patch.delivery_requested ?? item.delivery_requested,
        drop_location_id: patch.drop_location_id ?? item.drop_location_id,
      });
      setItems((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, ...data.cartItem } : row,
        ),
      );
    } catch (error) {
      setNotice(error.response?.data?.error || "Could not update this rental.");
    }
  };
  const remove = async (id) => {
    await api.delete(`/api/cart/${id}`);
    setItems((current) => current.filter((item) => item.id !== id));
    setSelected((current) => current.filter((itemId) => itemId !== id));
    window.dispatchEvent(new Event("cart-updated"));
  };
  const chosen = useMemo(
    () => items.filter((item) => selected.includes(item.id)),
    [items, selected],
  );
  const breakdown = useMemo(() => {
    const rentalTotal = chosen.reduce(
      (sum, item) => sum + Number(item.subtotal || 0),
      0,
    );
    const depositTotal = chosen.reduce(
      (sum, item) => sum + Number(item.deposit || 0),
      0,
    );
    const deliveryTotal = chosen.reduce(
      (sum, item) =>
        sum + Number(item.delivery_requested ? item.delivery_charge : 0),
      0,
    );
    const platformFee = chosen.reduce(
      (sum, item) => sum + Number(item.platform_fee || 0),
      0,
    );
    return {
      rentalTotal,
      depositTotal,
      deliveryTotal,
      platformFee,
      bookingTotal: rentalTotal + deliveryTotal + platformFee,
      grandTotal: rentalTotal + deliveryTotal + platformFee + depositTotal,
      selectedCount: chosen.length,
    };
  }, [chosen]);
  const checkout = () =>
    navigate("/checkout", {
      state: {
        cartItems: chosen.map((item) => ({
          ...item,
          deliveryOpted: Boolean(item.delivery_requested),
        })),
        selected_item_ids: chosen.map((item) => item.item_id),
        breakdown,
      },
    });
  if (loading)
    return (
      <main className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-12">
        <div className="h-[28rem] animate-pulse rounded-3xl bg-ink/5" />
      </main>
    );
  return (
    <main className="min-h-screen bg-paper pb-20">
      <header className="border-b border-ink/10">
        <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-9">
          <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 flex items-center gap-1">
            <ShoppingBag size={14} /> Rental cart
          </span>
          <h1 className="mt-3 font-display text-5xl font-semibold">
            Review your dates.
          </h1>
          <p className="mt-3 text-sm text-ink/50">
            Select rentals, adjust their range, and confirm the exact payable
            amount.
          </p>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-6">
        {notice && (
          <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
            {notice}
          </p>
        )}
        {!items.length ? (
          <div className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] py-20 text-center">
            <PackageOpen className="mx-auto text-ink/20" />
            <h2 className="mt-3 text-xl font-extrabold">Your cart is empty</h2>
            <p className="mt-1 text-sm text-ink/45">
              Choose dates for a marketplace item to add it here.
            </p>
            <Link to="/marketplace" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 mt-5">
              Browse marketplace
            </Link>
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
            <section className="space-y-4">
              <label className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] flex items-center gap-3 p-4 text-sm font-bold">
                <input
                  className="size-4 accent-emerald-600"
                  type="checkbox"
                  checked={selected.length === items.length}
                  onChange={() =>
                    setSelected(
                      selected.length === items.length
                        ? []
                        : items.map((item) => item.id),
                    )
                  }
                />
                Select all{" "}
                <span className="ml-auto text-xs text-ink/40">
                  {selected.length}/{items.length} selected
                </span>
              </label>
              {items.map((item) => {
                const active = selected.includes(item.id);
                return (
                  <article
                    key={item.id}
                    className={`rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] grid gap-4 p-4 sm:grid-cols-[110px_1fr] ${active ? "" : "opacity-55"}`}
                  >
                    <div className="relative">
                      <img
                        className="aspect-square w-full rounded-2xl object-cover"
                        src={item.image_url || listingFallback}
                        alt=""
                      />
                      <label className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-white shadow">
                        <input
                          className="size-4 accent-emerald-600"
                          type="checkbox"
                          checked={active}
                          onChange={() =>
                            setSelected((current) =>
                              active
                                ? current.filter((id) => id !== item.id)
                                : [...current, item.id],
                            )
                          }
                        />
                      </label>
                    </div>
                    <div>
                      <div className="flex items-start gap-3">
                        <div>
                          <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">
                            {item.category || "Rental"}
                          </span>
                          <h2 className="font-extrabold">{item.title}</h2>
                          <p className="text-xs text-ink/45">
                            Owner: {item.owner_name}
                          </p>
                        </div>
                        <button
                          className="ml-auto rounded-lg p-2 text-red-600 hover:bg-red-50"
                          onClick={() => remove(item.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label>
                          <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 mb-1 flex items-center gap-1">
                            <CalendarDays size={12} /> Start
                          </span>
                          <input
                            className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                            type="date"
                            min={new Date().toISOString().slice(0, 10)}
                            value={dateValue(item.start_date)}
                            onChange={(event) =>
                              update(item, { start_date: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 mb-1 block">End</span>
                          <input
                            className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                            type="date"
                            min={dateValue(item.start_date)}
                            value={dateValue(item.end_date)}
                            onChange={(event) =>
                              update(item, { end_date: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      {item.delivery_requested && (
                        <p className="mt-3 flex items-center gap-2 rounded-xl bg-mesh-50 p-3 text-xs font-bold text-mesh-800">
                          <Truck size={15} /> Campus delivery configured (+{money(item.delivery_charge)})
                        </p>
                      )}
                      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                        <span>
                          <i className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 block">Duration</i>
                          <b>{item.days} days</b>
                        </span>
                        <span>
                          <i className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 block">Rate</i>
                          <b>{money(item.price_per_day)}/day</b>
                        </span>
                        <span className="text-right">
                          <i className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 block">Subtotal</i>
                          <b className="text-mesh-700">
                            {money(item.subtotal)}
                          </b>
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
            <aside className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] sticky top-24 p-5">
              <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">Order summary</span>
              <h2 className="mt-1 text-xl font-extrabold">
                {chosen.length} selected rental{chosen.length === 1 ? "" : "s"}
              </h2>
              <div className="mt-5 space-y-3 text-sm">
                {[
                  ["Rental subtotal", breakdown.rentalTotal],
                  ["Platform fee", breakdown.platformFee],
                  ["Campus delivery", breakdown.deliveryTotal],
                ].map(([label, value]) => (
                  <p key={label} className="flex justify-between text-ink/55">
                    <span>{label}</span>
                    <b className="text-ink">{money(value)}</b>
                  </p>
                ))}
                <p className="flex justify-between border-t border-ink/10 pt-4 text-lg font-extrabold">
                  <span>Pay now</span>
                  <span>{money(breakdown.bookingTotal)}</span>
                </p>
                <div className="rounded-xl bg-mesh-50 p-3 text-xs leading-5 text-mesh-800">
                  <Check className="mb-1" size={16} />
                  <b>{money(breakdown.depositTotal)} refundable deposits</b>
                  <p className="text-ink/50">
                    Collected only after owner approval.
                  </p>
                </div>
              </div>
              <button
                disabled={!chosen.length}
                onClick={checkout}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 mt-5 w-full disabled:opacity-40"
              >
                Continue to checkout
              </button>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

