import { Route } from "lucide-react";
const label = (location) =>
  [location.building_name, location.floor_name, location.room_name]
    .filter(Boolean)
    .join(" · ");
export default function RouteSetup({
  form,
  setForm,
  locations,
  onSubmit,
  online,
  onToggle,
  routeSaving = false,
  className = "",
}) {
  return (
    <form onSubmit={onSubmit} className={className + " panel p-5"}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-ink/65">Your availability</span>
          <h2 className="mt-1 flex items-center gap-2 font-semibold">
            <Route size={18} /> Delivery availability
          </h2>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={routeSaving || !online}
          className={`rounded-full px-3 py-2 text-xs font-semibold ${online ? "bg-mesh-100 text-mesh-800" : "bg-slate-100 text-slate-600"}`}
        >
          <i
            className={`mr-1.5 inline-block size-2 rounded-full ${online ? "bg-mesh-500" : "bg-slate-400"}`}
          />
          {online ? "Go offline" : "Offline"}
        </button>
      </div>
      <p className="mb-4 text-xs leading-5 text-ink/65">Go online to receive campus delivery and return requests. Each offer shows the pickup, drop-off and your earning.</p>
      <label className="mb-4 flex items-center gap-2 text-xs font-medium">
        <input type="checkbox" checked={form.availability_mode === 'ROUTE'} disabled={routeSaving}
          onChange={e => setForm({ ...form, availability_mode: e.target.checked ? 'ROUTE' : 'OPEN' })}/>
        Only requests along a route (optional)
      </label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {form.availability_mode === "ROUTE" && [
          ["origin_location_id", "Starting point"],
          ["destination_location_id", "Heading to"],
        ].map(([name, title]) => (
          <label key={name}>
            <span className="text-xs font-medium text-ink/65 mb-1 block">{title}</span>
            <select
              className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              value={form[name]}
              disabled={routeSaving}
              onChange={(e) => setForm({ ...form, [name]: e.target.value })}
            >
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          <span className="text-xs font-medium text-ink/65 mb-1 block">Available until</span>
          <input
            className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
            type="datetime-local"
            value={form.available_until}
            disabled={routeSaving}
            onChange={(e) =>
              setForm({ ...form, available_until: e.target.value })
            }
          />
        </label>
        {form.availability_mode === "ROUTE" && <label>
          <span className="text-xs font-medium text-ink/65 mb-1 block">
            Maximum detour · {form.max_detour_meters} m
          </span>
          <input
            className="w-full accent-emerald-600"
            type="range"
            min="50"
            max="750"
            step="50"
            value={form.max_detour_meters}
            disabled={routeSaving}
            onChange={(e) =>
              setForm({ ...form, max_detour_meters: Number(e.target.value) })
            }
          />
        </label>}
      </div>
      <button disabled={routeSaving} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 mt-4 w-full">
        {routeSaving ? "Saving…" : online ? "Update availability" : "Go online"}
      </button>
    </form>
  );
}
