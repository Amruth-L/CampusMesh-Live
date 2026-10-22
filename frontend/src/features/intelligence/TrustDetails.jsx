import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
export default function TrustDetails({ rentalId }) {
  const { api } = useAuth();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const { data } = await api.get(
        `/api/intelligence/rentals/${rentalId}/trust`,
      );
      setData(data);
    } catch (e) {
      setError(e.response?.data?.error || "Could not load history.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 text-xs">
      <button
        onClick={load}
        disabled={busy}
        className="font-medium text-mesh-700 underline underline-offset-2"
      >
        {busy ? "Loading…" : "View return reliability"}
      </button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <div className="mt-2 rounded-lg border border-ink/10 bg-white p-3">
          <b>
            {data.estimate === null
              ? "Building history"
              : `${data.estimate}% estimated on-time return rate`}
          </b>
          <p className="mt-1">
            {data.onTime} on-time returns from {data.completed} completed
            rentals.
          </p>
          <p className="mt-2 leading-5 text-ink/55">{data.note}</p>
        </div>
      )}
    </div>
  );
}
