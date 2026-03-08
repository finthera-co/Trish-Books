import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscriptionPlans } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export default function Subscriptions() {
  const { data: plans } = useSubscriptionPlans();
  const { appUser } = useAuth();

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

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Subscription & Billing</h1>
          <p className="page-description">Manage your plan and payment history</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plans?.map((plan) => {
          const isCurrent = plan.name === currentPlanName;
          const features = (plan.features_json as any)?.modules || [];
          
          return (
            <div key={plan.id} className={`stat-card ${isCurrent ? "ring-2 ring-primary" : ""}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                {isCurrent && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    Current Plan
                  </span>
                )}
              </div>
              <div className="mb-4">
                <span className="text-3xl font-bold text-foreground">LKR {Number(plan.price)}</span>
                <span className="text-muted-foreground">/{plan.billing_cycle}</span>
                <p className="text-sm text-muted-foreground mt-1">Up to {plan.max_users} users</p>
              </div>
              <ul className="space-y-2 mb-6">
                {features.map((f: string) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-success" />
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </li>
                ))}
              </ul>
              <Button variant={isCurrent ? "outline" : "default"} className="w-full">
                {isCurrent ? "Current Plan" : "Upgrade"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
