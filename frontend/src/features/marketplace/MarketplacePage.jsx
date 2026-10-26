import listingCategories from '../../../../shared/listing-options.json';
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Heart,
  MapPin,
  ArrowRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
import { listingImage } from "../../lib/assets";
import RecommendationStrip from "../intelligence/RecommendationStrip";
import RentalDialog from "./RentalDialog";
import { rentalCategories } from "../../lib/categories";

const categories = ['All',...listingCategories];
const price = (listing) =>
  Number(listing.rent_price ?? listing.rentPrice ?? listing.price ?? 0);

export default function MarketplacePage() {
  const { api } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [listings, setListings] = useState([]);
  const [saved, setSaved] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(() => categories.includes(searchParams.get("category")) ? searchParams.get("category") : "All");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setLoading(true);
    setLoadError("");
    Promise.allSettled([api.get("/listings"), api.get("/api/wishlist")]).then(
      ([items, wishlist]) => {
        if (items.status === "fulfilled") setListings(items.value.data);
        else setLoadError("We couldn’t load the marketplace. Please try again.");
        if (wishlist.status === "fulfilled")
          setSaved(wishlist.value.data.map((item) => String(item.id)));
        setLoading(false);
      },
    );
  }, [api, reload]);
  useEffect(() => {
    const rentId = searchParams.get("rent");
    if (!rentId || !listings.length) return;
    const listing = listings.find((item) => String(item.id) === rentId);
    if (listing) {
      setSelected(listing);
      setSearchParams({}, { replace: true });
    }
  }, [listings, searchParams, setSearchParams]);
  const visible = useMemo(
    () =>
      listings
        .filter(
          (item) =>
            (category === "All" || item.category === category) &&
            `${item.title} ${item.description}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "popular"
            ? Number(b.paid_rentals_30d || 0) - Number(a.paid_rentals_30d || 0) || Number(b.viewers_7d || 0) - Number(a.viewers_7d || 0)
            : sort === "price-low"
            ? price(a) - price(b)
            : sort === "price-high"
              ? price(b) - price(a)
              : new Date(b.created_at || 0) - new Date(a.created_at || 0),
        ),
    [category, listings, query, sort],
  );
  const toggleSaved = async (id) => {
    try {
      const { data } = await api.post("/api/wishlist/toggle", { item_id: id });
      setSaved((items) =>
        data.saved
          ? [...new Set([...items, String(id)])]
          : items.filter((item) => item !== String(id)),
      );
      setNotice(data.saved ? "Saved for later" : "Removed from saved");
      setTimeout(() => setNotice(""), 1800);
    } catch (error) {
      setNotice(error.response?.data?.error || "Could not update saved items");
    }
  };
  return (
    <main className="min-h-screen bg-paper pb-20">
      <div className="page-shell">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-title">Rent on campus</h1><p className="page-copy">Find what you need, choose your dates, and request a rental.</p></div><Link to="/account/rentals" className="secondary-button">My rentals <ArrowRight size={16}/></Link></header>
        <div className="rounded-xl border border-mesh-900/10 bg-white  mb-7 grid gap-3 p-3 md:grid-cols-[1fr_auto_auto]">
          <label className="relative">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/35"
              size={18}
            />
            <input
              className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100 pl-11"
              aria-label="Search items"
              placeholder="Search books, cameras, calculators…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100 md:w-48"
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {[...new Set([...categories,...listings.map(item=>item.category).filter(Boolean)])].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <label className="relative">
            <SlidersHorizontal
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35"
              size={16}
            />
            <select
              className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100 pl-9 md:w-44"
              aria-label="Sort items"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Newest</option>
              <option value="popular">Campus demand</option>
              <option value="price-low">Price: low first</option>
              <option value="price-high">Price: high first</option>
            </select>
          </label>
        </div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-bold">
            {loading || loadError ? "—" : visible.length} available item{visible.length === 1 ? "" : "s"}
          </p>
        </div>
        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="h-96 animate-pulse rounded-3xl bg-ink/5"
              />
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-white p-10 text-center"><h2 className="text-xl font-semibold">The marketplace couldn’t load.</h2><p className="mt-3 text-sm text-ink/60">{loadError}</p><button onClick={() => setReload(value => value + 1)} className="brand-button mt-5">Try again</button></div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-mesh-900/10 bg-white  py-20 text-center">
            <Search className="mx-auto mb-3 text-ink/25" />
            <h2 className="text-xl font-semibold">No matching items</h2>
            <p className="mt-1 text-sm text-ink/50">
              Try another search or category.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((item, index) => (
              <motion.article
                key={item.id}
                className="group overflow-hidden rounded-xl border border-ink/10 bg-white"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.035, 0.28) }}

              >
                <div className="relative aspect-[4/3] overflow-hidden bg-mesh-50">
                  <img
                    src={listingImage(item)}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-contain bg-white p-2 transition duration-500 group-hover:scale-105"
                  />
                  <button
                    aria-label={saved.includes(String(item.id)) ? `Unsave ${item.title}` : `Save ${item.title}`}
                    onClick={() => toggleSaved(item.id)}
                    className={`absolute right-3 top-3 rounded-full bg-white/90 p-2 shadow-sm backdrop-blur ${saved.includes(String(item.id)) ? "text-red-500" : "text-ink/55"}`}
                  >
                    <Heart
                      size={17}
                      fill={
                        saved.includes(String(item.id))
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                </div>
                <div className="p-5">
                  <div className="grid gap-2">
                    <div>
                      <span className="text-xs font-medium text-ink/65">{item.category}</span>
                      <h2 className="mt-1 min-h-10 line-clamp-2 text-sm font-semibold">
                        {item.title}
                      </h2>
                    </div>
                    <p className="whitespace-nowrap font-semibold text-mesh-700">
                      ₹{price(item)}
                      <small className="font-medium text-ink/40">/day</small>
                    </p>
                  </div>
                  <p className="mt-3 flex items-center gap-1 text-xs text-ink/45">
                    <MapPin size={13} />
                    {item.location || "Campus pickup"} ·{" "}
                    {item.condition || "Good"}
                  </p>
                  {!item.demo_slug && <div className="mt-3 rounded-lg bg-mesh-50 px-3 py-2 text-xs leading-5">
                    <b className="text-mesh-800">{Number(item.paid_rentals_30d) >= 3 ? 'In demand' : Number(item.viewers_7d) >= 5 ? 'Getting attention' : 'Campus activity'}</b>
                    <p className="text-ink/65">{Number(item.paid_rentals_30d) || 0} paid bookings · last 30 days</p>
                    <p className="text-ink/65">{Number(item.viewers_7d) || 0} viewers · last 7 days</p>
                  </div>}
                  {item.demo_slug && <span className="mt-2 inline-block rounded bg-paper px-2 py-1 text-[10px] text-ink/50">Demo listing · Illustrative image</span>}
                  <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
                    <button
                      onClick={() => setSelected(item)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                    >
                      Choose dates
                    </button>
                    <Link
                      to={`/item/${item.id}`}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-mesh-900/15 bg-white px-5 text-sm font-bold text-ink transition hover:-translate-y-0.5 hover:border-mesh-500 hover:bg-mesh-50 px-3"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}
        <RecommendationStrip />
        <p className="mb-5 text-xs leading-5 text-ink/60">Demand is shown on each item: paid bookings in the last 30 days and distinct viewers this week. Sample listings are excluded.</p>
        <div className="mb-7 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {rentalCategories.map(([name, Icon]) => <button key={name} onClick={() => setCategory(category === name ? "All" : name)} aria-pressed={category === name} className={`flex flex-col items-center gap-3 rounded-xl border p-4 text-center transition ${category === name ? 'border-mesh-600 bg-mesh-50 text-mesh-800' : 'border-ink/10 bg-white text-ink/65 hover:border-mesh-300'}`}><Icon size={26} strokeWidth={1.5}/><span className="text-xs font-medium">{name}</span></button>)}
        </div>
      </div>
      {notice && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white shadow-xl"
        >
          {notice}
        </motion.div>
      )}
      {selected && (
        <RentalDialog listing={selected} onClose={() => setSelected(null)} />
      )}
    </main>
  );
}
