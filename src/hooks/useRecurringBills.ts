import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface RecurringBillTemplateLine {
  id?: string;
  account_id: string;
  description?: string;
  qty: number;
  unit_cost: number;
  customer_id?: string | null;
  is_billable?: boolean;
  cost_center_id?: string | null;
  sort_order?: number;
}

export interface RecurringBillTemplate {
  id: string;
  tenant_id: string;
  vendor_id: string;
  template_name: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  interval_count: number;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  occurrences_generated: number;
  next_run_date: string;
  status: "active" | "paused" | "completed";
  auto_post: boolean;
  payment_terms: string;
  vendor_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  recurring_bill_template_lines?: RecurringBillTemplateLine[];
}

export function useRecurringBillTemplates() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["recurring_bill_templates", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_bill_templates" as any)
        .select("*, recurring_bill_template_lines(*)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("template_name");
      if (error) throw error;
      return (data as any[]) as RecurringBillTemplate[];
    },
  });
}

export function useCreateRecurringBillTemplate() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      vendor_id: string;
      template_name: string;
      frequency: "weekly" | "monthly" | "quarterly" | "yearly";
      interval_count: number;
      start_date: string;
      end_date?: string | null;
      max_occurrences?: number | null;
      auto_post: boolean;
      payment_terms: string;
      vendor_ref?: string;
      notes?: string;
      lines: RecurringBillTemplateLine[];
    }) => {
      const tenantId = appUser!.tenant_id;
      const { data: tpl, error: tplErr } = await supabase
        .from("recurring_bill_templates" as any)
        .insert({
          tenant_id: tenantId,
          vendor_id: params.vendor_id,
          template_name: params.template_name,
          frequency: params.frequency,
          interval_count: params.interval_count,
          start_date: params.start_date,
          end_date: params.end_date || null,
          max_occurrences: params.max_occurrences || null,
          next_run_date: params.start_date,
          auto_post: params.auto_post,
          payment_terms: params.payment_terms,
          vendor_ref: params.vendor_ref || null,
          notes: params.notes || null,
          created_by: appUser!.id,
        } as any)
        .select()
        .single();
      if (tplErr) throw tplErr;

      const tplId = (tpl as any).id as string;
      const { error: linesErr } = await supabase
        .from("recurring_bill_template_lines" as any)
        .insert(
          params.lines.map((l, i) => ({
            recurring_bill_template_id: tplId,
            account_id: l.account_id,
            description: l.description || null,
            qty: l.qty,
            unit_cost: l.unit_cost,
            customer_id: l.customer_id || null,
            is_billable: l.is_billable ?? false,
            cost_center_id: l.cost_center_id || null,
            sort_order: i,
          })) as any
        );
      if (linesErr) throw linesErr;

      return tpl;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_bill_templates"] });
      toast.success("Recurring bill template created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateRecurringBillTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<RecurringBillTemplate> & { id: string }) => {
      const { error } = await supabase
        .from("recurring_bill_templates" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_bill_templates"] });
      toast.success("Template updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePauseRecurringBillTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "paused" }) => {
      const { error } = await supabase
        .from("recurring_bill_templates" as any)
        .update({ status } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_bill_templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteRecurringBillTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recurring_bill_templates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_bill_templates"] });
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Manual "run now" — calls the same generate_recurring_bills() RPC the cron
// invokes, but under the caller's own auth context so it's scoped to their
// tenant only (see the RPC's tenant-scoping guard).
export function useTriggerRecurringBills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("generate_recurring_bills" as any);
      if (error) throw error;
      return data as { ok: boolean; bills_created: number; errors: any[] };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recurring_bill_templates"] });
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      toast.success(`${data.bills_created} bill${data.bills_created === 1 ? "" : "s"} generated`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
