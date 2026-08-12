// ─────────────────────────────────────────────────────────────────────────────
// useAccountSettings.ts
// Central hook for account_settings GL control account mappings.
// Exports: AccountSettings (interface), AccountSettingsCompleteness (interface),
//          useAccountSettings, useAccountSettingsCompleteness,
//          useUpsertAccountSettings, usePostInvoice
// ─────────────────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── AccountSettings — all 19 mappable GL control fields ─────────────────────

export interface AccountSettings {
  id?: string;
  tenant_id?: string;
  // Core — required for invoice/bill/payment posting
  ar_account_id:                        string | null;
  sales_account_id:                     string | null;
  tax_payable_account_id:               string | null;   // DEPRECATED: legacy shared VAT account; superseded by the two below
  vat_output_payable_account_id:        string | null;   // Cr on sales (liability)
  vat_input_receivable_account_id:      string | null;   // Dr on purchases (asset)
  ap_account_id:                        string | null;
  bank_account_id:                      string | null;
  // Inventory & Procurement
  inventory_account_id:                 string | null;
  cogs_account_id:                      string | null;
  grni_clearing_account_id:             string | null;
  purchase_price_variance_account_id:   string | null;
  // Fixed Assets — global fallback (asset category takes priority)
  depreciation_expense_account_id:      string | null;
  accumulated_depreciation_account_id:  string | null;
  disposal_gain_account_id:             string | null;
  disposal_loss_account_id:             string | null;
  // Equity & Period-Close
  retained_earnings_account_id:         string | null;
  // Foreign Exchange — IAS 21
  fx_gain_account_id:                   string | null;
  fx_loss_account_id:                   string | null;
  // Payroll — global fallback (component GL mapping takes priority)
  wages_expense_account_id:             string | null;
  payroll_clearing_account_id:          string | null;
  // Governance — invoice approval + credit control (optional: columns added later,
  // not yet in generated DB types until `supabase gen types` is re-run).
  invoice_approval_threshold?:          number | null;   // total ≥ this requires approval (null/0 = off)
  enforce_credit_limit?:                boolean | null;   // block posting past customer credit limit
  invoice_approver_ids?:                string[] | null;  // appointed approvers; empty → owners (Primary/Super Admin)
  customer_advance_account_id?:         string | null;    // liability account for customer deposits/advances
  invoice_approval_tiers?:              { min_amount: number; required_approvals: number }[] | null;   // legacy flat tiers; read as a single-step chain
  // Sequential approval chain — ordered levels, each opening only once the
  // previous one has collected its sign-offs. Supersedes invoice_approval_tiers.
  invoice_approval_workflow?:           { name: string; min_amount: number; required_approvals: number; approver_ids: string[] }[] | null;
  invoice_approval_require_distinct?:   boolean | null;   // one person may not sign two levels of the same invoice
  // Bank Statement Import — DIRECTIONAL suspense, mirroring the client's own
  // workbook: unresolved money IN → Unrecognized Deposits, unresolved money OUT
  // → Unrecognized Payments. Both REQUIRED before importing; tracked to zero in
  // Suspense Clearing. (Columns added by 20260721000000; not yet in gen types.)
  bank_import_unrecognized_deposit_account_id?: string | null;
  bank_import_unrecognized_payment_account_id?: string | null;
  bank_import_posting_mode?:            "auto_post" | "draft" | null;
  bank_import_amount_ceiling?:          number | null;
}

// ─── AccountSettingsCompleteness — shape returned by get_account_settings_completeness RPC

export interface AccountSettingsCompleteness {
  configured: boolean;
  critical_missing: string[];
  recommended_missing: string[];
  critical_complete: boolean;
  fully_complete: boolean;
}

// ─── useAccountSettings ───────────────────────────────────────────────────────

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

export function useUpsertAccountSettings() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (settings: Partial<AccountSettings>) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { data, error } = await supabase
        .from("account_settings")
        .upsert(
          { tenant_id: appUser.tenant_id, ...settings } as any,
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

// ─── usePostInvoice — DO NOT CHANGE, imported by CreateInvoice.tsx and Invoices.tsx

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
      const data = await invokeEdgeFunction<{ ok?: boolean; error?: string }>(
        "post-invoice",
        { invoice_id, action },
      );
      // post-invoice reports failure in a 200 body, and can return ok:false with
      // no error string — so the ok flag is still checked here.
      if (!data?.ok) throw new Error(data?.error || "Posting failed");
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success(data?.message || "Done");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
