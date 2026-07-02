import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Invoices currently awaiting approval (or rejected), newest first.
export function useApprovalQueue() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["approval_queue", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("invoices")
        .select("id, invoice_number, total_amount, currency, exchange_rate, approval_status, approvals_count, required_approvals, created_at, customers(name)")
        .eq("tenant_id", appUser!.tenant_id)
        .in("approval_status", ["pending", "rejected"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

// Tenant-wide approval event log (submitted / approved / rejected).
export function useApprovalLog(limit = 300) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["approval_log", appUser?.tenant_id, limit],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_approval_history" as any)
        .select("id, action, note, amount_base, created_at, invoice_id, invoices(invoice_number), users:actor_id(first_name, last_name, email)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as any[];
    },
  });
}
