import { Navigate } from "react-router-dom";

// Keep the old URL working while the account page owns the single request queue.
export default function OwnerDashboard() {
  return <Navigate to="/account/listings" replace />;
}
