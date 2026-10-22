import MeshScore from "./components/MeshScore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { CheckCircle2, Bell, Wallet, Truck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { normalizeCampusLocations } from "../../lib/campus";
import { API_BASE_URL } from "../../lib/api";
import QrScanner from "../../components/QrScanner";
import ActiveTask from "./components/ActiveTask";
import CampusRouteMap from "./components/CampusRouteMap";
import OffersPanel from "./components/OffersPanel";
import RouteSetup from "./components/RouteSetup";
import CompletedDeliveries from "./components/CompletedDeliveries";

import { Link, useSearchParams } from 'react-router-dom';
import { toLocalDateTime } from '../../lib/delivery';
const API = API_BASE_URL;
const listFrom = (result, key) => {
  if (result.status !== "fulfilled") return [];
  const value = result.value.data;
  return Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : [];
};
const activeStatuses = new Set(["COURIER_ASSIGNED", "ACCEPTED", "GOING_TO_PICKUP", "ARRIVED_AT_PICKUP", "IN_TRANSIT", "ARRIVED_AT_DESTINATION", "RETURN_COURIER_ASSIGNED", "RETURN_IN_TRANSIT"]);

export default function DeliveryPage() {
  const { user, api } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = ['active', 'history'].includes(params.get('view')) ? params.get('view') : 'requests';
  const setView = next => setParams(next === 'requests' ? {} : { view: next });
  const routeInitialized = useRef(false);
  const [metricsError, setMetricsError] = useState(true);
  const [campus, setCampus] = useState();
  const [locations, setLocations] = useState([]);
  const [offers, setOffers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [active, setActive] = useState();
  const [route, setRoute] = useState();
  const [declaredRoute, setDeclaredRoute] = useState();
  const [position, setPosition] = useState();
  const [stats, setStats] = useState({ available: 0, active: 0, completed: 0, totalEarned: 0 });
  const [online, setOnline] = useState(Boolean(user?.delivery_available));
  const [busyId, setBusyId] = useState("");
  const [routeSaving, setRouteSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState("reconnecting");
  const [availability, setAvailability] = useState({ online: false, routeActive: false, reason: "OFFLINE" });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [scanner, setScanner] = useState(false);
  const [verify, setVerify] = useState({ stage: "PICKUP", method: "OTP", value: "" });
  const [form, setForm] = useState({ availability_mode: "OPEN", origin_location_id: "", destination_location_id: "", available_until: toLocalDateTime(new Date(Date.now() + 7200000)), max_detour_meters: 250 });

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      api.get("/api/campus"),
      api.get("/api/campus/locations"),
      api.get("/api/delivery/available"),
      api.get("/api/delivery/my-deliveries"),
      api.get("/api/courier/routes/current"),
      api.get("/api/delivery/stats"),
    ]);
    const [c, l, a, m, r, s] = results;

    if (c.status === "fulfilled") setCampus(c.value.data);
    let locationList = [];
    if (l.status === "fulfilled") {
      locationList = normalizeCampusLocations(l.value.data);
      setLocations(locationList);
      setForm((current) => ({
        ...current,
        origin_location_id: locationList.some((item) => item.id === current.origin_location_id) ? current.origin_location_id : locationList[0]?.id || "",
        destination_location_id: locationList.some((item) => item.id === current.destination_location_id) ? current.destination_location_id : locationList.find((item) => item.building_id === "hostel")?.id || locationList[1]?.id || "",
      }));
    }
    if (a.status === "fulfilled") {
      const value = a.value.data;
      const offerList = Array.isArray(value) ? value : Array.isArray(value?.deliveries) ? value.deliveries : [];
      setOffers(offerList);
      setAvailability(value?.availability || { online: false, routeActive: false, reason: "NO_OPEN_REQUESTS" });
    }
    if (m.status === "fulfilled") setTasks(listFrom(m, "deliveries"));
    setMetricsError(s.status !== "fulfilled");
    if (s.status === "fulfilled") setStats(s.value.data);
    if (r.status === "fulfilled") {
      setOnline(Boolean(r.value.data?.route && r.value.data?.delivery_available));
      setDeclaredRoute(r.value.data?.navigation);
      const saved = r.value.data?.route;
      if (saved && !routeInitialized.current) {
        setForm({ availability_mode: saved.availability_mode || "ROUTE", origin_location_id: saved.origin_location_id || locationList[0]?.id || "", destination_location_id: saved.destination_location_id || locationList[1]?.id || "", available_until: toLocalDateTime(new Date(saved.available_until)), max_detour_meters: saved.max_detour_meters });
        routeInitialized.current = true;
      }
    }

    const taskList = m.status === "fulfilled" ? listFrom(m, "deliveries") : [];
    const current = taskList.find((item) => activeStatuses.has(item.status));
    if (m.status === "fulfilled") setActive(current);
    if (!current && m.status === "fulfilled") setPosition(undefined);

    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length === results.length) {
      setConnection("offline");
      setNotice("Could not refresh your delivery dashboard. Check your connection and retry.");
    } else if (failed.length) {
      setConnection("offline");
      setNotice(failed[0].reason?.response?.data?.error || "Some delivery data could not be refreshed.");
    } else {
      setConnection("live");
      setLastUpdated(new Date());
    }
  }, [api]);
  useEffect(() => { load().catch((error) => { setConnection("offline"); setNotice(error.response?.data?.error || "Could not load courier workspace."); }); }, [load]);
  useEffect(() => {
    const socket = io(API, { auth: { token: localStorage.getItem("token") }, reconnectionAttempts: 5 });
    socket.on("connect", () => setConnection("live"));
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on("connect_error", () => setConnection("offline"));
    const refresh = () => load();
    ["delivery:offer", "delivery:offer-unavailable", "delivery:created", "delivery:status", "delivery:assigned", "delivery:completed"].forEach((event) => socket.on(event, refresh));
    socket.on("delivery:location", (location) => { if (location.delivery_id === active?.id) setPosition(location); });
    window.addEventListener("campusmesh:delivery-change", refresh);
    return () => { socket.close(); window.removeEventListener("campusmesh:delivery-change", refresh); };
  }, [active?.id, load]);
  useEffect(() => {
    const timer = setInterval(() => load(), online || active ? 5000 : 15000);
    return () => clearInterval(timer);
  }, [active, load, online]);

  useEffect(() => {
    if (active?.task_type === 'WISH_DELIVERY') { setRoute(undefined); return undefined; }
    if (!active?.pickup_location_id || !active?.destination_location_id) { setRoute(declaredRoute); return undefined; }
    let cancelled = false;
    api.get(`/api/campus/route?from=${encodeURIComponent(active.pickup_location_id)}&to=${encodeURIComponent(active.destination_location_id)}`).then(({ data }) => { if (!cancelled) setRoute(data); }).catch(() => { if (!cancelled) setRoute(declaredRoute); });
    return () => { cancelled = true; };
  }, [active?.id, active?.task_type, active?.pickup_location_id, active?.destination_location_id, api, declaredRoute]);

  const pickup = useMemo(() => locations.find((item) => item.id === active?.pickup_location_id), [locations, active]);
  const destination = useMemo(() => locations.find((item) => item.id === active?.destination_location_id), [locations, active]);
  const completed = Number(stats.completed ?? tasks.filter((item) => item.status === "COMPLETED").length);
  const available = offers.filter(offer => new Date(offer.offer_expires_at).getTime() > Date.now()).length;
  const activeCount = Number(stats.active ?? tasks.filter((item) => activeStatuses.has(item.status)).length);

  const saveRoute = async (event) => {
    event.preventDefault();
    if (routeSaving) return;
    setRouteSaving(true);
    try {
      const { data } = await api.post("/api/courier/availability", { ...form, available_until: new Date(form.available_until).toISOString() });
      setOnline(Boolean(data.delivery_available));
      setDeclaredRoute(data.navigation || undefined);
      setNotice("You are online. New requests appear here and in your notification bell. You choose which to accept.");
      window.dispatchEvent(new Event("campusmesh:delivery-change"));
      await load();
    } catch (error) {
      setNotice(error.response?.data?.error || "Could not save availability.");
    } finally {
      setRouteSaving(false);
    }
  };
  const toggleOnline = async () => {
    try { if (online) { await api.delete("/api/courier/routes/current"); setOnline(false); setNotice("You are offline. New delivery requests are paused."); window.dispatchEvent(new Event("campusmesh:delivery-change")); await load(); } else setNotice("Choose your available-until time and go online."); } catch (error) { setNotice(error.response?.data?.error || "Could not update availability."); }
  };
  const accept = async (offer) => {
    if (busyId) return;
    setBusyId(offer.delivery_id);
    try { await api.post(`/api/delivery/${offer.delivery_id}/accept`, { offer_id: offer.offer_id }); setNotice("Delivery accepted. Head to the pickup point."); setView("active"); window.dispatchEvent(new Event("campusmesh:delivery-change")); await load(); } catch (error) { setNotice(error.response?.data?.error || "That delivery is no longer available."); } finally { setBusyId(""); }
  };
  const decline = async (offer) => {
    if (busyId) return;
    setBusyId(offer.delivery_id);
    try { await api.post(`/api/delivery/${offer.delivery_id}/decline`, { offer_id: offer.offer_id }); setNotice("Request skipped."); window.dispatchEvent(new Event("campusmesh:delivery-change")); await load(); } catch (error) { setNotice(error.response?.data?.error || "Could not skip this request."); } finally { setBusyId(""); }
  };
  const checkpoint = async (target) => {
    const location = target === "pickup" ? pickup : destination;
    if (!active || !location) return;
    try { const point = { x: Number(location.x), y: Number(location.y), route_node_id: location.route_node_id, speed: 5 }; await api.post(`/api/delivery/${active.id}/location`, point); setPosition({ ...point, delivery_id: active.id }); setNotice("Live checkpoint shared with the renter and owner."); } catch (error) { setNotice(error.response?.data?.error || "Could not share this checkpoint."); }
  };
  const advance = async (status) => {
    if (!active) return;
    try { await api.post(`/api/delivery/${active.id}/status`, { status }); setNotice(`Delivery moved to ${status.replaceAll("_", " ").toLowerCase()}.`); await load(); } catch (error) { setNotice(error.response?.data?.error || "That step is not available yet."); }
  };
  const confirm = async () => {
    if (!active || !verify.value.trim()) return;
    try {
      let value = verify.value.trim();
      if (verify.method === "QR") { try { value = JSON.parse(value); } catch { value = { token: value }; } }
      await api.post(`/api/delivery/${active.id}/verify-handover`, { stage: verify.stage, method: verify.method, value });
      setVerify((current) => ({ ...current, value: "" })); setNotice(`${verify.stage.replaceAll("_", " ")} verified. The next stage is now unlocked.`); await load();
    } catch (error) { setNotice(error.response?.data?.error || "Credential verification failed."); }
  };

  return (
    <main className="min-h-screen bg-paper pb-16">
      {scanner && <QrScanner onClose={() => setScanner(false)} onResult={(value) => { setVerify((current) => ({ ...current, method: "QR", value })); setScanner(false); }} />}
      <div className="page-shell">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="page-title">Delivery dashboard</h1><p className="page-copy">Manage your deliveries and track your earnings.</p><Link to="/delivery/wishes" className="mt-3 inline-flex text-sm font-semibold text-mesh-700">Wish Box errands →</Link></div>
          <div className="flex items-center gap-3"><button onClick={load} className="text-xs font-medium text-ink/60 hover:text-mesh-700">Refresh</button><span className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium ${online ? 'border-mesh-200 bg-mesh-50 text-mesh-700' : 'border-ink/10 bg-white text-ink/60'}`}><span className={`size-2 rounded-full ${online ? 'bg-mesh-600' : 'bg-ink/30'}`}/>{online ? 'Online for requests' : 'Offline'}</span></div>
        </header>
        <div className="my-7 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[[Bell, 'Pending requests', available, 'requests', 'Waiting for your response'], [Truck, 'In progress', activeCount, 'active', 'Your current delivery'], [CheckCircle2, 'Completed', completed, 'history', 'All completed deliveries'], [Wallet, 'Total earned', `₹${Number(stats.totalEarned || 0).toFixed(0)}`, 'history', 'From completed deliveries']].map(([Icon,label,value,target,hint]) => <button key={label} onClick={() => setView(target)} className="panel p-4 text-left transition hover:border-mesh-300 sm:p-5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-ink/60">{label}</span><Icon size={17} className="text-mesh-600"/></div><strong className="mt-2 block text-2xl font-semibold tracking-tight sm:mt-4 sm:text-3xl">{metricsError ? '—' : value}</strong><p className="mt-2 hidden text-[11px] text-ink/50 sm:block">{hint}</p></button>)}
        </div>
        {!metricsError && <MeshScore mesh={stats.meshScore}/>}
        {notice && <div role="status" className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-xs leading-5 ${connection === 'offline' ? 'bg-red-50 text-red-700' : 'bg-mesh-50 text-mesh-800'}`}><span>{notice}</span><button onClick={load} className="shrink-0 font-semibold underline underline-offset-2">{connection === 'offline' ? 'Retry' : lastUpdated ? 'Refresh' : 'Loading…'}</button></div>}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <nav aria-label="Delivery sections" className="mb-6 flex gap-5 border-b border-ink/10">{[['requests','Requests'],['active','Current delivery'],['history','History & earnings']].map(([id,label]) => <button key={id} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined} className={`border-b-2 pb-3 text-xs font-semibold sm:text-sm ${view === id ? 'border-mesh-600 text-mesh-700' : 'border-transparent text-ink/55'}`}>{label}</button>)}</nav>
            {view === 'requests' && <OffersPanel offers={offers} onAccept={accept} onDecline={decline} online={online} reason={availability.reason} connection={connection} busyId={busyId} active={active}/>}
            {view === 'active' && <div className="space-y-5"><ActiveTask task={active} route={route} verify={verify} setVerify={setVerify} onVerify={confirm} onAdvance={advance} onCheckpoint={checkpoint} onScan={() => setScanner(true)}/>{active && active.task_type !== "WISH_DELIVERY" && <CampusRouteMap campus={campus} route={route} position={position} pickup={pickup} destination={destination}/>}</div>}
            {view === 'history' && <CompletedDeliveries deliveries={tasks}/>}
          </div>
          <aside className="order-first space-y-4 lg:order-last"><RouteSetup form={form} setForm={setForm} locations={locations} onSubmit={saveRoute} online={online} onToggle={toggleOnline} routeSaving={routeSaving}/><div className="px-2 text-xs leading-6 text-ink/55">Receive requests while CampusMesh is open. Review both locations and accept or decline. Accept one delivery at a time. Earnings are recorded after the handover is complete.</div>{active && view !== 'active' && <button onClick={() => setView('active')} className="secondary-button w-full"><Truck size={16}/> Continue current delivery</button>}</aside>
        </div>
      </div>
    </main>
  );
}
