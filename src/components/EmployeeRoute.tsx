import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Gates the employee self-service portal. Only the 'Employee' role lands here;
 * everyone else is sent back to their normal home.
 */
export default function EmployeeRoute() {
  const { isEmployee, loading, appUser } = useAuth();

  if (loading || !appUser) return null;

  if (!isEmployee) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
