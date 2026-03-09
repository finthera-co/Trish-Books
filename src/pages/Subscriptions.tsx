import { Check, X, Crown, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscriptionPlans } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

// All possible modules in the system
const ALL_MODULES = [
  { key: "accounts", label: "Chart of Accounts" },
  { key: "journals", label: "Journal Entries & Ledger" },
  { key: "reports", label: "Reports & Trial Balance" },
  { key: "invoicing", label: "Invoicing & Products" },
  { key: "expenses", label: "Expenses & Petty Cash" },
  { key: "budgeting", label: "Budgeting" },
  { key: "payroll", label: "Payroll" },
  { key: "audit", label: "Audit Logs" },
];

export default function Subscriptions() {
  const { data: plans } = useSubscriptionPlans();
  const { appUser, isSuperAdmin } = useAuth();
  const { planName, currentUserCount, maxUsers } = useSubscriptionLimits();

  // Get current tenant's subscription
  const { data: currentSubscription } = useQuery({
    queryKey: ["current_subscription", appUser?.tenant_id],
    queryFn: async () => {
      if (!appUser?.tenant_id) return null;
      const { data } = await supabase
        .from("tenants")
        .select("subscription_plan_id, subscription_plans(name)")
        .eq("id", appUser.tenant_id)
        .single();
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });

  const currentPlanName = (currentSubscription?.subscription_plans as any)?.name;

  const handleUpgrade = (plan: any) => {
    if (isSuperAdmin) {
      toast.info("As Super Admin, manage subscriptions from the Tenants page.");
    } else {
      toast.info("Please contact your administrator to upgrade your plan.");
    }
  };

  // Sort plans by price
  const sortedPlans = plans?.sort((a, b) => Number(a.price) - Number(b.price)) || [];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Subscription & Billing</h1>
          <p className="page-description">Manage your plan and access levels</p>
        </div>
      </div>

      {/* Current usage summary */}
      {!isSuperAdmin && planName && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card">
            <p className="text-xs font-medium text-muted-foreground">Current Plan</p>
            <p className="text-xl font-bold text-foreground mt-1 flex items-center gap-2">
              <Crown className="w-4 h-4 text-primary" /> {planName}
            </p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-medium text-muted-foreground">Users</p>
            <p className="text-xl font-bold text-foreground mt-1 tabular-nums">
              {currentUserCount} / {maxUsers}
            </p>
            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  currentUserCount / maxUsers > 0.9 ? "bg-destructive" :
                  currentUserCount / maxUsers > 0.7 ? "bg-accent-foreground" : "bg-primary"
                }`}
                style={{ width: `${Math.min((currentUserCount / maxUsers) * 100, 100)}%` }}
              />
            </div>
          </div>
          <div className="stat-card">
            <p className="text-xs font-medium text-muted-foreground">Billing Cycle</p>
            <p className="text-xl font-bold text-foreground mt-1 capitalize">Monthly</p>
          </div>
        </div>
      )}

      {/* Plan comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sortedPlans.map((plan) => {
          const isCurrent = plan.name === currentPlanName;
          const modules: string[] = (plan.features_json as any)?.modules || [];

          return (
            <div key={plan.id} className={`stat-card relative overflow-hidden ${isCurrent ? "ring-2 ring-primary" : ""}`}>
              {isCurrent && (
                <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-lg">
                  Current
                </div>
              )}

              <div className="mb-5">
                <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                <div className="mt-2">
                  <span className="text-3xl font-bold text-foreground tabular-nums">LKR {Number(plan.price).toLocaleString()}</span>
                  <span className="text-sm text-muted-foreground"> /{plan.billing_cycle}</span>
                </div>
              </div>

              {/* Limits */}
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-primary" />
                  <span className="text-foreground">Up to <strong>{plan.max_users}</strong> users</span>
                </div>
              </div>

              {/* Module access list */}
              <div className="border-t border-border pt-4 mb-6">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Module Access</p>
                <div className="space-y-2">
                  {ALL_MODULES.map(mod => {
                    const included = modules.includes(mod.key);
                    return (
                      <div key={mod.key} className="flex items-center gap-2 text-sm">
                        {included ? (
                          <Check className="w-4 h-4 text-primary shrink-0" />
                        ) : (
                          <X className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={included ? "text-foreground" : "text-muted-foreground/50"}>
                          {mod.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button
                variant={isCurrent ? "outline" : "default"}
                className="w-full"
                disabled={isCurrent}
                onClick={() => handleUpgrade(plan)}
              >
                {isCurrent ? "Current Plan" : (
                  <span className="flex items-center gap-1.5">
                    <Zap className="w-4 h-4" /> Upgrade to {plan.name}
                  </span>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
