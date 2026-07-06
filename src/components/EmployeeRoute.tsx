import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Gates the employee self-service portal (/me). Every tenant user — any role —
 * has a linked employee profile, so all of them may enter. Super admins have
 * no tenant (and no employee record), so they go back to the control plane.
 */
export default function EmployeeRoute() {
  const { isSuperAdmin, loading, appUser } = useAuth();

  if (loading || !appUser) return null;

  if (isSuperAdmin || !appUser.tenant_id) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
