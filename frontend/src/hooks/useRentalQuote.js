import { useEffect, useState } from "react";
import { useAuth } from "../context/auth-context";
import { dateError } from "../../../shared/rental-dates.js";
export function useRentalQuote(id, start, end, delivery = false) {
  const { api } = useAuth();
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([id, start, end, delivery, retry]);
  const [state, setState] = useState({});
  useEffect(() => {
    let cancelled = false;
    const invalid = dateError(start, end);
    if (!id || invalid) {
      setState({ key, error: invalid || "Choose an item." });
      return;
    }
    setState({ key, loading: true });
    api
      .post("/api/pricing/calculate", {
        listing_id: id,
        start_date: start,
        end_date: end,
        delivery_type: delivery ? "STANDARD" : "SELF_PICKUP",
      })
      .then(({ data }) => {
        if (!cancelled) setState({ key, quote: data });
      })
      .catch((e) => {
        if (!cancelled)
          setState({
            key,
            error:
              e.response?.data?.error || "Could not load quote. Please retry.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [api, id, start, end, delivery, retry, key]);
  return {
    ...(state.key === key ? state : { loading: true }),
    retry: () => setRetry((n) => n + 1),
  };
}
