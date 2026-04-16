import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Blocks non-Super-Admin users from accessing SaaS control plane pages.
 */
export default function SuperAdminRoute() {
  const { isSuperAdmin, loading, appUser } = useAuth();

  if (loading || !appUser) return null;

  if (!isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
