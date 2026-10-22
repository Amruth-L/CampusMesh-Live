import { useEffect, useState } from "react";
import { ArrowLeft, Heart, MapPin, ShieldCheck, Truck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listingImage } from "../../lib/assets";
import RentalDialog from "./RentalDialog";

export default function ListingDetailsPage() {
  const { id } = useParams();
  const { api } = useAuth();
  const [item, setItem] = useState(null);
  const [rent, setRent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [favoriteNotice, setFavoriteNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState(0);
  useEffect(() => {
    api
      .get(`/listings/${id}`)
      .then(({ data }) => {
        setItem(data);
        setSelectedPhoto(0);
        api.post(`/listings/${id}/view`).catch(() => {});
      })
      .catch((error) =>
        setError(error.response?.data?.error || "This listing is unavailable."),
      );
  }, [api, id]);
  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/wishlist")
      .then(({ data }) => {
        if (!cancelled)
          setSaved((data || []).some((savedItem) => String(savedItem.id) === String(id)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  const toggleSaved = async () => {
    if (savingFavorite) return;
    setSavingFavorite(true);
    setFavoriteNotice("");
    try {
      const { data } = await api.post("/api/wishlist/toggle", { item_id: item.id });
      setSaved(Boolean(data.saved));
      setFavoriteNotice(data.saved ? "Saved to favourites" : "Removed from favourites");
      window.dispatchEvent(new Event("wishlist-updated"));
    } catch (favoriteError) {
      setFavoriteNotice(favoriteError.response?.data?.error || "Could not update your favourites.");
    } finally {
      setSavingFavorite(false);
    }
  };
  if (error)
    return (
      <main className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-20 text-center">
        <h1 className="font-display text-4xl">Listing unavailable</h1>
        <p className="mt-3 text-ink/50">{error}</p>
        <Link to="/marketplace" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 mt-6">
          Return to marketplace
        </Link>
      </main>
    );
  if (!item)
    return (
      <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-14">
        <div className="h-[32rem] animate-pulse rounded-[2rem] bg-ink/5" />
      </div>
    );
  return (
    <main className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-8 sm:py-12">
      <Link
        className="mb-6 inline-flex items-center gap-1 text-sm font-bold text-ink/50 hover:text-mesh-700"
        to="/marketplace"
      >
        <ArrowLeft size={16} /> Marketplace
      </Link>
      <div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <div className="overflow-hidden rounded-[2rem] bg-mesh-50 self-start">
          <img
            className="aspect-[4/3] w-full bg-white object-contain p-5"
            src={[...new Set([listingImage(item), ...(item.image_urls || [])])][selectedPhoto] || listingImage(item)}
            alt={`${item.title} — photo ${selectedPhoto + 1}`}
          />
          {item.image_urls?.length > 1 && <div className="flex gap-2 overflow-x-auto p-3" aria-label="Item photos">
            {[...new Set([listingImage(item), ...item.image_urls])].map((photo, index) => (
              <button key={photo} type="button" aria-label={`View photo ${index + 1}`} aria-pressed={selectedPhoto === index}
                onClick={() => setSelectedPhoto(index)}
                className={`size-16 shrink-0 overflow-hidden rounded-xl border-2 bg-white ${selectedPhoto === index ? 'border-mesh-600' : 'border-transparent'}`}>
                <img src={photo} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>}
        </div>
        <div className="flex flex-col justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-mesh-900/10 bg-white/80 px-3 py-1 text-xs font-bold text-mesh-700 w-fit">{item.category}</span>
          <h1 className="mt-5 font-display text-5xl font-semibold leading-none">
            {item.title}
          </h1>
          {item.demo_slug && <span className="mt-3 text-xs text-ink/50">Demo listing · Illustrative item image</span>}
          <p className="mt-5 leading-7 text-ink/55">{item.description}</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] p-4">
              <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">Daily rental</span>
              <p className="mt-1 text-2xl font-extrabold text-mesh-700">
                ₹{Number(item.rent_price || item.price || 0)}
              </p>
            </div>
            <div className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] p-4">
              <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">Refundable deposit</span>
              <p className="mt-1 text-2xl font-extrabold">
                ₹{Number(item.deposit || 0)}
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-2 text-sm text-ink/55">
            <p className="flex items-center gap-2">
              <MapPin size={17} className="text-mesh-600" />
              {item.location || "Campus pickup"}
            </p>
            <p className="flex items-center gap-2">
              <ShieldCheck size={17} className="text-mesh-600" />
              Listed by {item.owner_name || "a verified student"}
            </p>
            {item.delivery_available && (
              <p className="flex items-center gap-2">
                <Truck size={17} className="text-mesh-600" />
                Campus delivery available
              </p>
            )}
          </div>
          <div className="mt-8 flex gap-3">
            <button
              onClick={() => setRent(true)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 flex-1"
            >
              Rent now
            </button>
            <button
              onClick={toggleSaved}
              disabled={savingFavorite}
              aria-label={saved ? "Remove from favourites" : "Save to favourites"}
              title={saved ? "Remove from favourites" : "Save to favourites"}
              className={"inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60 " + (saved ? "border-mesh-500 bg-mesh-50 text-mesh-700" : "border-mesh-900/15 bg-white text-ink hover:border-mesh-500 hover:bg-mesh-50")}
            >
              <Heart size={17} fill={saved ? "currentColor" : "none"} />
            </button>
          </div>
          {favoriteNotice && (
            <p className="mt-3 text-sm font-semibold text-mesh-700" role="status">
              {favoriteNotice}
            </p>
          )}
        </div>
      </div>
      {rent && <RentalDialog listing={item} onClose={() => setRent(false)} />}
    </main>
  );
}
