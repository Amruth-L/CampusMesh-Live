import { useEffect, useState } from "react";
import { useAuth } from "../../../context/auth-context";
import { normalizeCampusLocations } from "../../../lib/campus";

export default function ReturnDestination({
  rentalId,
  delivery,
  isOwner,
  onSaved,
}) {
  const { api } = useAuth();
  const [locations, setLocations] = useState([]);
  const [location, setLocation] = useState(
    delivery.destination_location_id || "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable =
    ["RETURN_LOCATION_PENDING", "RETURN_MATCHING"].includes(delivery.status) &&
    !delivery.courier;
  useEffect(() => {
    setLocation(delivery.destination_location_id || "");
  }, [delivery.destination_location_id]);
  useEffect(() => {
    if (!isOwner || !editable) return;
    api
      .get("/api/campus/locations")
      .then(({ data }) => setLocations(normalizeCampusLocations(data)))
      .catch(() =>
        setError("Could not load campus locations. Refresh to retry."),
      );
  }, [api, isOwner, editable]);
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.put(`/api/rentals/${rentalId}/return-destination`, {
        location_id: location,
      });
      await onSaved();
    } catch (caught) {
      setError(caught.response?.data?.error || "Could not save destination.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel p-5 space-y-3">
      <h2 className="font-semibold">Return acceptance & destination</h2>
      <p className="text-sm text-ink/65">
        {delivery.status === "RETURN_LOCATION_PENDING"
          ? "Waiting for the owner to confirm where to receive the item. Couriers will be notified after confirmation."
          : editable
            ? "The owner can update the destination until a courier accepts. Changes replace the previous offers."
            : ["COMPLETED","DELIVERY_PAYMENT_PENDING"].includes(delivery.status)
              ? "Return handover is verified. The owner now checks the item condition; the refund and courier fee are tracked separately."
              : "A courier has accepted this destination. Contact them before making different arrangements."}
      </p>
      {isOwner && editable ? (
        <form onSubmit={save} className="space-y-3">
          <label className="block text-sm font-medium">
            Receive the item at
            <select
              required
              value={location}
              disabled={busy}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-2 w-full rounded-xl border border-ink/15 bg-white p-3"
            >
              <option value="" disabled>
                Choose campus location
              </option>
              {locations.map((place) => (
                <option key={place.id} value={place.id}>
                  {[place.building_name, place.floor_name, place.room_name]
                    .filter(Boolean)
                    .join(" · ")}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !locations.length}
            className="brand-button disabled:opacity-50"
          >
            {busy
              ? "Saving…"
              : delivery.status === "RETURN_LOCATION_PENDING"
                ? "Accept return & notify couriers"
                : "Update destination & notify couriers"}
          </button>
        </form>
      ) : (
        <p className="text-sm font-semibold">{delivery.drop_location}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
