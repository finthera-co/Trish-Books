import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { VoucherLine } from "@/hooks/usePaymentVouchers";

export interface RecurringCheckTemplate {
  id: string;
  tenant_id: string;
  payment_account_id: string;
  payee_id: string | null;
  payee_vendor_id: string | null;
  template_name: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  interval_count: number;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  occurrences_generated: number;
  next_run_date: string;
  status: "active" | "paused" | "completed";
  payment_method: string;
  memo: string | null;
  print_later: boolean;
  mailing_address: string | null;
  permit_number: string | null;
  location_id: string | null;
  created_at: string;
  updated_at: string;
  recurring_check_template_lines?: VoucherLine[];
}

export function useRecurringCheckTemplates() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["recurring_check_templates", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_check_templates" as any)
        .select("*, recurring_check_template_lines(*)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("template_name");
      if (error) throw error;
      return (data as any[]) as RecurringCheckTemplate[];
    },
  });
}

export function useCreateRecurringCheckTemplate() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      payment_account_id: string;
      payee_id?: string;
      payee_vendor_id?: string;
      template_name: string;
      frequency: "weekly" | "monthly" | "quarterly" | "yearly";
      interval_count: number;
      start_date: string;
      end_date?: string | null;
      max_occurrences?: number | null;
      memo?: string;
      lines: VoucherLine[];
    }) => {
      const tenantId = appUser!.tenant_id;
      const { data: tpl, error: tplErr } = await supabase
        .from("recurring_check_templates" as any)
        .insert({
          tenant_id: tenantId,
          payment_account_id: params.payment_account_id,
          payee_id: params.payee_id || null,
          payee_vendor_id: params.payee_vendor_id || null,
          template_name: params.template_name,
          frequency: params.frequency,
          interval_count: params.interval_count,
          start_date: params.start_date,
          end_date: params.end_date || null,
          max_occurrences: params.max_occurrences || null,
          next_run_date: params.start_date,
          memo: params.memo || null,
          created_by: appUser!.id,
        } as any)
        .select()
        .single();
      if (tplErr) throw tplErr;

      const tplId = (tpl as any).id as string;
      const { error: linesErr } = await supabase
        .from("recurring_check_template_lines" as any)
        .insert(
          params.lines.map((l, i) => ({
            recurring_check_template_id: tplId,
            account_id: l.account_id,
            description: l.description || null,
            amount: l.amount,
            customer_id: l.customer_id || null,
            is_billable: l.is_billable ?? false,
            cost_center_id: l.cost_center_id || null,
            is_taxable: l.is_taxable ?? false,
            sort_order: i,
          })) as any
        );
      if (linesErr) throw linesErr;

      return tpl;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_check_templates"] });
      toast.success("Recurring check template created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePauseRecurringCheckTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "paused" }) => {
      const { error } = await supabase
        .from("recurring_check_templates" as any)
        .update({ status } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_check_templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteRecurringCheckTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recurring_check_templates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_check_templates"] });
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Manual "run now" — calls the same generate_recurring_checks() RPC the cron
// invokes, but under the caller's own auth context so it's scoped to their
// tenant only (see the RPC's tenant-scoping guard).
export function useTriggerRecurringChecks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("generate_recurring_checks" as any);
      if (error) throw error;
      return data as { ok: boolean; checks_created: number; errors: any[] };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recurring_check_templates"] });
      qc.invalidateQueries({ queryKey: ["payment_vouchers"] });
      toast.success(`${data.checks_created} check${data.checks_created === 1 ? "" : "s"} generated`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
