import ConditionPhotos from "./components/ConditionPhotos";
import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { Clock3, Navigation, PackageCheck, Radio, UserRound } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { API_BASE_URL } from "../../lib/api";
import CampusRouteMap from "./components/CampusRouteMap";

const human = (value) => String(value || "pending").replaceAll("_", " ").toLowerCase();

export default function DeliveryTracking() {
  const { id } = useParams();
  const { api } = useAuth();
  const [data, setData] = useState();
  const [campus, setCampus] = useState();
  const [route, setRoute] = useState();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [tracking, campusData, routeData] = await Promise.allSettled([
      api.get("/api/delivery/" + id + "/tracking"),
      api.get("/api/campus"),
      api.get("/api/delivery/" + id + "/route"),
    ]);
    if (tracking.status === "fulfilled") {
      setData(tracking.value.data);
      setError("");
    } else {
      setError(tracking.reason?.response?.data?.error || "This delivery is not available.");
    }
    if (campusData.status === "fulfilled") setCampus(campusData.value.data);
    if (routeData.status === "fulfilled")
      setRoute(routeData.value.data.route || routeData.value.data);
  }, [api, id]);

  useEffect(() => {
    let cancelled = false;
    load();
    const interval = window.setInterval(() => {
      if (!cancelled) load();
    }, 15000);
    const socket = io(API_BASE_URL, { auth: { token: localStorage.getItem("token") } });
    const refresh = () => {
      if (!cancelled) load();
    };
    socket.emit("delivery:join", id);
    socket.on("delivery:location", (location) =>
      setData((current) => (current ? { ...current, location } : current)),
    );
    ["delivery:status", "delivery:assigned", "delivery:completed"].forEach((event) =>
      socket.on(event, refresh),
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      socket.close();
    };
  }, [id, load]);

  if (error && !data)
    return (
      <main className="mx-auto w-full max-w-[1240px] px-5 py-20 text-center sm:px-7 lg:px-10">
        <h1 className="font-display text-4xl">Tracking unavailable</h1>
        <p className="mt-3 text-ink/50">{error}</p>
        <Link to="/account/rentals" className="mt-6 inline-flex h-11 items-center rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white">Back to rentals</Link>
      </main>
    );
  if (!data || !campus)
    return <main className="mx-auto w-full max-w-[1240px] px-5 py-16 sm:px-7 lg:px-10"><div className="h-[30rem] animate-pulse rounded-3xl bg-ink/5" /></main>;

  const delivery = data.delivery || {};
  const pickup = route?.coordinates?.[0];
  const destination = route?.coordinates?.at(-1);
  const cards = [
    [PackageCheck, "Status", human(delivery.status)],
    [UserRound, "Delivery partner", delivery.courier_name || "Finding a partner"],
    [Navigation, "Current checkpoint", data.location ? "Live location received" : "Waiting for location"],
    [Clock3, "Estimated arrival", delivery.estimated_time || (route?.etaMinutes ? route.etaMinutes + " min" : "Updating")],
  ];
  return (
    <main className="min-h-screen bg-paper pb-16">
      <header className="border-b border-ink/10">
        <div className="mx-auto w-full max-w-[1240px] px-5 py-9 sm:px-7 lg:px-10">
          <Link to="/account/rentals" className="mb-5 inline-flex text-sm font-bold text-ink/50 hover:text-mesh-700">← Back to rentals</Link>
          <span className="flex items-center gap-1 text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600"><Radio size={13} /> Live campus tracking</span>
          <h1 className="mt-3 font-display text-5xl font-semibold">Your delivery is {human(delivery.status)}.</h1>
          <p className="mt-3 text-sm text-ink/50">{delivery.item_description || delivery.listing_title || "Campus order"} · {delivery.drop_location}</p>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-[1240px] gap-5 px-5 py-6 sm:px-7 lg:grid-cols-[1fr_320px] lg:px-10">
        <div className="space-y-5"><CampusRouteMap campus={campus} route={route} position={data.location} pickup={pickup} destination={destination} /><ConditionPhotos key={`${id}:${delivery.status}`} deliveryId={id}/></div>
        <aside className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {cards.map(([Icon, label, value]) => (
            <article key={label} className="flex items-center gap-3 rounded-[1.6rem] border border-mesh-900/10 bg-white p-4 shadow-[0_10px_40px_rgba(35,58,40,.06)]">
              <span className="grid size-10 place-items-center rounded-xl bg-mesh-50 text-mesh-700"><Icon size={19} /></span>
              <div><span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">{label}</span><b className="mt-1 block text-sm">{value}</b></div>
            </article>
          ))}
        </aside>
      </div>
    </main>
  );
}
