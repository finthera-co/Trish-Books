import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface PlanLimits {
  planName: string | null;
  maxUsers: number;
  allowedModules: string[];
  currentUserCount: number;
  canAddUser: boolean;
  isModuleAllowed: (module: string) => boolean;
  loading: boolean;
}

// Map sidebar paths to module identifiers used in features_json
const PATH_TO_MODULE: Record<string, string> = {
  "/": "dashboard",
  "/accounting": "accounts",
  "/accounting/accounts": "accounts",
  "/accounting/journals": "journals",
  "/accounting/ledger": "journals",
  "/accounting/trial-balance": "reports",
  "/accounting/fiscal-periods": "accounts",
  "/sales/invoices": "invoicing",
  "/sales/products-taxes": "invoicing",
  "/expenses/tracker": "expenses",
  "/banking/petty-cash": "expenses",
  "/banking/reconciliation": "accounts",
  "/banking/write-checks": "expenses",
  "/reports/budgets": "budgeting",
  "/payroll/runs": "payroll",
  "/payroll/employees": "payroll",
  "/reports/financial": "reports",
  "/admin/audit-logs": "audit",
  "/reports/exports": "reports",
};

// These paths are always accessible regardless of plan
const ALWAYS_ALLOWED_PATHS = [
  "/",
  "/home",
  "/dashboard",
  "/admin",
  "/admin/tenants",
  "/admin/users",
  "/admin/subscriptions",
  "/admin/settings",
  "/payroll/employees",
];

export function useSubscriptionLimits(): PlanLimits {
  const { appUser, isSuperAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["subscription_limits", appUser?.tenant_id],
    queryFn: async () => {
      if (!appUser?.tenant_id) return null;

      // Get tenant's plan
      const { data: tenant } = await supabase
        .from("tenants")
        .select("subscription_plan_id, subscription_plans(name, max_users, features_json)")
        .eq("id", appUser.tenant_id)
        .single();

      // Get current user count for tenant
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", appUser.tenant_id);

      return {
        plan: tenant?.subscription_plans as any,
        userCount: count || 0,
      };
    },
    enabled: !!appUser?.tenant_id,
  });

  const plan = data?.plan;
  const planName = plan?.name || null;
  const maxUsers = plan?.max_users || 3;
  const allowedModules: string[] = plan?.features_json?.modules || [];
  const currentUserCount = data?.userCount || 0;
  const canAddUser = isSuperAdmin || currentUserCount < maxUsers;

  const isModuleAllowed = (_pathOrModule: string): boolean => {
    // TEMPORARY: plan-based module restrictions disabled for all plans.
    // Revert to the commented logic below to re-enable gating.
    return true;
    // if (isSuperAdmin) return true;
    // if (ALWAYS_ALLOWED_PATHS.includes(pathOrModule)) return true;
    // if (!planName || allowedModules.length === 0) return true;
    // const module = PATH_TO_MODULE[pathOrModule] || pathOrModule;
    // return allowedModules.includes(module);
  };

  return {
    planName,
    maxUsers,
    allowedModules,
    currentUserCount,
    canAddUser,
    isModuleAllowed,
    loading: isLoading,
  };
}

export { PATH_TO_MODULE, ALWAYS_ALLOWED_PATHS };
