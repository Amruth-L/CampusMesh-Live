import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
export default function DirectCheckout() {
  const { api } = useAuth(),
    { state } = useLocation();
  const [results, setResults] = useState({}),
    [busy, setBusy] = useState(false);
  const [items,setItems] = useState([]), [loading,setLoading]=useState(true), [error,setError]=useState('');
  useEffect(()=>{let cancelled=false;api.get('/api/cart').then(({data})=>{
    if(!cancelled)setItems(data.filter(item=>state?.cartItems?.some(selected=>selected.id===item.id)));
  }).catch(()=>{if(!cancelled)setError('Could not refresh prices. Return to cart and retry.');}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[api,state]);
  async function submit() {
    if (busy) return;
    setBusy(true);
    for (const item of items) {
      if (results[item.id]?.id) continue;
      try {
        const { data } = await api.post("/api/rentals/book", {
          listing_id: item.item_id,
          start_date: item.start_date.slice(0, 10),
          end_date: item.end_date.slice(0, 10),
          delivery_requested: !!item.delivery_requested,
          drop_location_id: item.drop_location_id,
        });
        setResults((old) => ({ ...old, [item.id]: { id: data.rental.id } }));
        // Remove only the successfully submitted item; other requests remain recoverable.
        await api.delete(`/api/cart/${item.id}`).catch(() => {});
        window.dispatchEvent(new Event("cart-updated"));
      } catch (e) {
        setResults((old) => ({
          ...old,
          [item.id]: {
            error:
              e.response?.data?.error || "Request failed. Retry this item.",
          },
        }));
      }
    }
    setBusy(false);
  }
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-5 py-8">
      <h1 className="text-3xl font-bold">Request your rentals</h1>
      <p>
        Each lender reviews their request before payment. Pay rental fees and
        deposits directly after acceptance. Delivery fees are paid separately
        after handover. There is no combined cart charge or platform fee.
      </p>
      {loading && <p role="status">Refreshing quotes…</p>}
      {error && <p role="alert">{error}</p>}
      {items.map((item) => (
        <article key={item.id} className="border-b border-ink/15 py-4">
          <h2 className="font-bold">{item.title}</h2>
          <p className="mt-1 text-sm">
            {item.start_date.slice(0, 10)} to {item.end_date.slice(0, 10)} ·
            Rental ₹{Number(item.subtotal).toFixed(2)}
          </p>
          {results[item.id]?.id && (
            <Link
              className="mt-2 inline-block font-semibold text-mesh-800 underline"
              to={`/rent-details/${results[item.id].id}`}
            >
              Request sent — view rental
            </Link>
          )}
          {results[item.id]?.error && (
            <p role="alert" className="mt-2 text-red-700">
              {results[item.id].error}
            </p>
          )}
        </article>
      ))}
      {items.length > 0 ? (
        <button
          disabled={busy || items.every((i) => results[i.id]?.id)}
          onClick={submit}
          className="brand-button disabled:opacity-50"
        >
          {busy ? "Sending requests…" : "Send rental requests — no payment now"}
        </button>
      ) : (
        <Link to="/cart" className="secondary-button">
          Return to cart
        </Link>
      )}
      <Link to="/account/rentals" className="block font-semibold underline">
        My rentals
      </Link>
    </main>
  );
}
