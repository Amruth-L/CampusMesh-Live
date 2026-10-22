const configured = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL;
export const API_BASE_URL = (
  configured === "/"
    ? window.location.origin
    : configured || (import.meta.env.PROD ? window.location.origin : "http://localhost:3003")
).replace(/\/$/, "");
