import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Blocks Super Admin from accessing tenant business modules (control-plane only)
 * and self-service Employees from the admin app (they live under /me).
 */
export default function TenantRoute() {
  const { isSuperAdmin, isEmployee, loading, appUser } = useAuth();

  if (loading || !appUser) return null;

  if (isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  if (isEmployee) {
    return <Navigate to="/me" replace />;
  }

  return <Outlet />;
}
