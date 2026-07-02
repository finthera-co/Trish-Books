import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface RecurringItemInput {
  description: string;
  quantity: number;
  unit_price: number;
  product_id?: string | null;
  account_id?: string | null;
  discount_amount?: number;
  is_tax_inclusive?: boolean;
  tax_code_id?: string | null;
  tax_group_id?: string | null;
}

export interface CreateRecurringInput {
  customer_id: string;
  template_name: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  interval_count: number;
  start_date: string;
  end_date?: string | null;
  max_occurrences?: number | null;
  auto_post: boolean;
  branch_code?: string | null;
  payment_terms: string;
  notes?: string | null;
  terms?: string | null;
  items: RecurringItemInput[];
}

export function useRecurringInvoices() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["recurring_invoices", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("recurring_invoices")
        .select("*, customers(name), recurring_invoice_items(id)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateRecurringInvoice() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRecurringInput) => {
      const { items, ...header } = input;
      const { data: rec, error } = await (supabase as any)
        .from("recurring_invoices")
        .insert({
          tenant_id: appUser!.tenant_id,
          created_by: appUser!.id,
          next_run_date: input.start_date, // first run is the start date
          ...header,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (items.length) {
        const { error: itemErr } = await (supabase as any)
          .from("recurring_invoice_items")
          .insert(items.map((it, i) => ({
            recurring_invoice_id: rec.id,
            description: it.description,
            quantity: it.quantity,
            unit_price: it.unit_price,
            product_id: it.product_id || null,
            account_id: it.account_id || null,
            discount_amount: it.discount_amount || 0,
            is_tax_inclusive: !!it.is_tax_inclusive,
            tax_code_id: it.tax_code_id || null,
            tax_group_id: it.tax_group_id || null,
            sort_order: i,
          })));
        if (itemErr) throw itemErr;
      }
      return rec;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_invoices"] });
      toast.success("Recurring schedule created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetRecurringStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "paused" }) => {
      const { error } = await (supabase as any)
        .from("recurring_invoices")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["recurring_invoices"] });
      toast.success(v.status === "paused" ? "Schedule paused" : "Schedule resumed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteRecurringInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("recurring_invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_invoices"] });
      toast.success("Schedule deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
