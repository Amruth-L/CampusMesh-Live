import { useEffect, useState } from "react";
import { API_BASE_URL } from "../../lib/api";
export default function useDirectMode() {
  const [mode, setMode] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    fetch(`${API_BASE_URL}/api/direct-upi/config`, { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => setMode(d.enabled === true))
      .catch((e) => {
        if (e.name !== "AbortError")
          setError("Could not load payment options. Reload before continuing.");
      });
    return () => c.abort();
  }, []);
  return { mode, error };
}
