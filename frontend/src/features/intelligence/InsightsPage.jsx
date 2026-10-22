import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp,
  ShieldCheck,
  Route,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listingImage } from "../../lib/assets";
export default function InsightsPage() {
  const { api } = useAuth();
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/intelligence/overview");
      setData(data);
      setError("");
    } catch (e) {
      setError(e.response?.data?.error || "Could not load insights.");
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <main className="page-shell pb-28">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-mesh-700">
            Based on campus activity
          </p>
          <h1 className="page-title">Campus insights</h1>
          <p className="page-copy">
            Discover useful items and see what the data can tell us.
          </p>
        </div>
        <button onClick={load} className="secondary-button">
          <RefreshCw size={15} />
          Refresh
        </button>
      </header>
      {error && (
        <p
          role="alert"
          className="my-6 rounded-lg bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {!data && !error ? (
        <p className="mt-8 text-sm text-ink/55">Loading campus insights…</p>
      ) : (
        data && (
          <>
            <div className="my-7 grid gap-4 md:grid-cols-2">
              <section className="panel p-5">
                <div className="flex items-center gap-2 text-mesh-700">
                  <ShieldCheck size={19} />
                  <h2 className="font-semibold">Your return reliability</h2>
                </div>
                <strong className="mt-4 block text-3xl font-semibold">
                  {data.trust.estimate === null
                    ? "Building history"
                    : `${data.trust.estimate}%`}
                </strong>
                <p className="mt-2 text-sm text-ink/65">
                  {data.trust.completed} completed rentals · {data.trust.onTime}{" "}
                  returned on time
                </p>
                {data.trust.range && (
                  <p className="mt-2 text-xs text-ink/55">
                    Historical rate interval: {data.trust.range.join("–")}% ·{" "}
                    {data.trust.confidence} confidence
                  </p>
                )}
                <p className="mt-3 text-xs leading-5 text-ink/55">
                  {data.trust.note}
                </p>
              </section>
              <section className="panel p-5">
                <div className="flex items-center gap-2 text-mesh-700">
                  <Route size={19} />
                  <h2 className="font-semibold">Delivery estimates</h2>
                </div>
                <strong className="mt-4 block text-xl font-semibold">
                  {data.eta.method === "validated_linear_regression"
                    ? "Learning from completed trips"
                    : "Campus route estimates"}
                </strong>
                <p className="mt-2 text-sm text-ink/65">
                  {data.eta.sampleCount} usable completed trips
                </p>
                <p className="mt-3 text-xs leading-5 text-ink/55">
                  Routes match direction, detour limits and available time.
                  Regression needs at least {data.eta.minimumSamples} completed
                  trips and must improve on the route estimate. Outside-campus
                  travel is not mapped yet.
                </p>
                {data.eta.validationMae !== null && (
                  <p className="mt-2 text-xs">
                    Validation error: about {data.eta.validationMae} minutes
                  </p>
                )}
              </section>
            </div>
            <section className="panel p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <TrendingUp size={20} className="text-mesh-600" />
                <h2 className="text-lg font-semibold">Demand outlook</h2>
              </div>
              <p className="mt-2 text-sm text-ink/60">{data.market.scope}</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.market.categories.map((c) => (
                  <article
                    key={c.category}
                    className="rounded-xl border border-ink/10 p-4"
                  >
                    <h3 className="text-sm font-semibold">{c.category}</h3>
                    <div
                      className="my-4 flex h-12 items-end gap-0.5"
                      aria-label={`${c.observations} paid rentals over 28 days`}
                    >
                      {c.daily.map((n, i) => (
                        <span
                          key={i}
                          title={`${c.days[i]}: ${n} rentals`}
                          className={
                            n
                              ? "flex-1 rounded-t bg-mesh-500"
                              : "flex-1 rounded-t bg-ink/10"
                          }
                          style={{
                            height: `${Math.max(4, (n / Math.max(1, ...c.daily)) * 100)}%`,
                          }}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-ink/55">
                      Last 7 days: <b className="text-ink">{c.recentWeek}</b> ·
                      Previous: {c.previousWeek}
                    </p>
                    <p className="mt-3 text-sm font-semibold">
                      {c.nextWeek === null
                        ? "Waiting for real rental activity"
                        : `Next 7 days: about ${c.nextWeek} rentals`}
                    </p>
                    {c.range && (
                      <p className="mt-1 text-xs text-mesh-700">
                        Planning range {c.range.join("–")} · {c.confidence}{" "}
                        confidence
                      </p>
                    )}
                    <p className="mt-2 text-xs leading-5 text-ink/50">
                      {c.note}
                    </p>
                  </article>
                ))}
              </div>
            </section>
            <section className="mt-8">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Suggested for you</h2>
                <Link
                  to="/marketplace"
                  className="text-xs font-semibold text-mesh-700"
                >
                  Browse all →
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {data.recommendations.map((item) => (
                  <Link
                    to={`/item/${item.id}`}
                    key={item.id}
                    className="panel overflow-hidden"
                  >
                    <img
                      src={listingImage(item)}
                      alt={item.title}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-contain bg-white p-3"
                    />
                    <div className="p-4">
                      <h3 className="text-sm font-semibold">{item.title}</h3>
                      <p className="mt-2 text-sm text-mesh-700">
                        ₹{item.rent_price}/day
                      </p>
                      <p className="mt-2 text-xs leading-5 text-ink/55">
                        {item.reason}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
              {!data.recommendations.length && (
                <p className="panel p-6 text-sm text-ink/55">
                  No available recommendations yet. Try the full catalog.
                </p>
              )}
            </section>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/reminders" className="secondary-button">
                Reminder settings <ArrowRight size={15} />
              </Link>
              <Link to="/support" className="secondary-button">
                Ask CampusMesh support <ArrowRight size={15} />
              </Link>
            </div>
          </>
        )
      )}
    </main>
  );
}
