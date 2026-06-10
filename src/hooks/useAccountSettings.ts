import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface AccountSettings {
  id?: string;
  tenant_id?: string;
  // ── Existing fields ─────────────────────────────────────
  ar_account_id:                  string | null;
  sales_account_id:               string | null;
  tax_payable_account_id:         string | null;
  ap_account_id:                  string | null;
  bank_account_id:                string | null;
  // ── New fields (added in migration expand_account_settings) ─
  retained_earnings_account_id:      string | null;
  inventory_asset_account_id:        string | null;
  cogs_account_id:                   string | null;
  grni_clearing_account_id:          string | null;
  depreciation_expense_account_id:   string | null;
  accum_depreciation_account_id:     string | null;
  gain_on_disposal_account_id:       string | null;
  loss_on_disposal_account_id:       string | null;
  petty_cash_account_id:             string | null;
}

export function useAccountSettings() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["account_settings", appUser?.tenant_id],
    queryFn: async () => {
      if (!appUser?.tenant_id) return null;
      const { data, error } = await supabase
        .from("account_settings")
        .select("*")
        .eq("tenant_id", appUser.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return data as AccountSettings | null;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useUpsertAccountSettings() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (settings: Partial<AccountSettings>) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("account_settings")
        .upsert({ tenant_id: appUser.tenant_id, ...settings }, { onConflict: "tenant_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account_settings"] });
      toast.success("Account mapping saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoice_id, action }: { invoice_id: string; action: "post" | "void" }) => {
      const { data, error } = await supabase.functions.invoke("post-invoice", {
        body: { invoice_id, action },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Posting failed");
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success(data?.message || "Done");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
