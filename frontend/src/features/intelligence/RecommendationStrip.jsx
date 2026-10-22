import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listingImage } from "../../lib/assets";
export default function RecommendationStrip() {
  const { api } = useAuth();
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    api
      .get("/api/intelligence/recommendations")
      .then(({ data }) => {
        if (alive) setItems(data.slice(0, 4));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);
  if (!items.length) return null;
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Suggested for you</h2>
        <Link to="/insights" className="text-xs text-mesh-700">
          Campus insights →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((i) => (
          <Link
            key={i.id}
            to={`/item/${i.id}`}
            className="panel flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center"
          >
            <img
              src={listingImage(i)}
              alt=""
              loading="lazy"
              className="size-16 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-xs font-semibold leading-5">
                {i.title}
              </h3>
              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink/55">
                {i.reason}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
