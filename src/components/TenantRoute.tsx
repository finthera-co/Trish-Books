import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Blocks Super Admin from accessing tenant business modules.
 * Super Admin is a control-plane role only.
 */
export default function TenantRoute() {
  const { isSuperAdmin, loading, appUser } = useAuth();

  if (loading || !appUser) return null;

  if (isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
