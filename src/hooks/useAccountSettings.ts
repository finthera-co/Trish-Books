import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Full 19-field AccountSettings interface ──────────────────────────────────
// All fields nullable — the DB schema is nullable for all non-PK columns.
// The `as AccountSettings` cast in useAccountSettings() is intentional: types.ts
// has not yet been regenerated so TS doesn't know about the new columns.
// Once types.ts is regenerated the cast can be removed.

export interface AccountSettings {
  id?: string;
  tenant_id?: string;

  // ── Core (original 5 fields — preserved exactly) ──────────────────────────
  ar_account_id:                        string | null;
  sales_account_id:                     string | null;
  tax_payable_account_id:               string | null;
  ap_account_id:                        string | null;
  bank_account_id:                      string | null;

  // ── Inventory & Procurement ───────────────────────────────────────────────
  inventory_account_id:                 string | null;
  cogs_account_id:                      string | null;
  grni_clearing_account_id:             string | null;
  purchase_price_variance_account_id:   string | null;

  // ── Fixed Assets (global fallback — asset category takes priority) ─────────
  depreciation_expense_account_id:      string | null;
  accumulated_depreciation_account_id:  string | null;
  disposal_gain_account_id:             string | null;
  disposal_loss_account_id:             string | null;

  // ── Equity & Period-Close ─────────────────────────────────────────────────
  retained_earnings_account_id:         string | null;

  // ── FX — IAS 21 ───────────────────────────────────────────────────────────
  fx_gain_account_id:                   string | null;
  fx_loss_account_id:                   string | null;

  // ── Payroll (global fallback — component GL mapping takes priority) ────────
  wages_expense_account_id:             string | null;
  payroll_clearing_account_id:          string | null;
}

// ─── Completeness response shape (from get_account_settings_completeness RPC) ─

export interface AccountSettingsCompleteness {
  configured: boolean;
  critical_missing: string[];
  recommended_missing: string[];
  critical_complete: boolean;
  fully_complete: boolean;
}

// ─── useAccountSettings ───────────────────────────────────────────────────────
// Fetches the single account_settings row for the current tenant.
// Uses .maybeSingle() — returns null if no row exists (safe for new tenants).

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

// ─── useAccountSettingsCompleteness ──────────────────────────────────────────
// Calls the get_account_settings_completeness RPC to determine which of the
// 19 accounts are mapped. Used by AccountMapping.tsx to render the health banner.

export function useAccountSettingsCompleteness() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["account_settings_completeness", appUser?.tenant_id],
    queryFn: async () => {
      if (!appUser?.tenant_id) return null;
      const { data, error } = await supabase
        .rpc("get_account_settings_completeness", {
          p_tenant_id: appUser.tenant_id,
        });
      if (error) throw error;
      return data as AccountSettingsCompleteness | null;
    },
    enabled: !!appUser?.tenant_id,
  });
}

// ─── useUpsertAccountSettings ─────────────────────────────────────────────────
// Upserts all 19 account mapping fields in one call.
// Invalidates both account_settings and account_settings_completeness on success.

export function useUpsertAccountSettings() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (settings: Partial<AccountSettings>) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("account_settings")
        .upsert(
          { tenant_id: appUser.tenant_id, ...settings },
          { onConflict: "tenant_id" }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account_settings"] });
      qc.invalidateQueries({ queryKey: ["account_settings_completeness"] });
      toast.success("Account mapping saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── usePostInvoice ───────────────────────────────────────────────────────────
// Preserved exactly — do not change any line of this function.
// Imported by CreateInvoice.tsx and Invoices.tsx.

export function usePostInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      invoice_id,
      action,
    }: {
      invoice_id: string;
      action: "post" | "void";
    }) => {
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
