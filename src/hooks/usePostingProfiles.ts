import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type PostingProfile = {
  id: string;
  module: string;
  transaction_type: string;
  account_role: string;
  gl_account_id: string;
  entity_scope: Record<string, string> | null;
  effective_from: string;
  effective_to: string | null;
  priority: number;
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
  accounts?: { account_code: string; account_name: string } | null;
};

export type ResolvedAccount = {
  gl_account_id: string;
  account_code: string;
  account_name: string;
  matched_by: "entity_scope" | "default";
};

export type ResolvedProfiles = Record<string, ResolvedAccount>;

export const MODULES = ["AR", "AP", "FIXED_ASSETS", "BANK"] as const;
export type Module = (typeof MODULES)[number];

export const TRANSACTION_TYPES_BY_MODULE: Record<Module, string[]> = {
  AR:           ["INVOICE", "PAYMENT", "CREDIT_NOTE"],
  AP:           ["BILL", "BILL_PAYMENT", "DEBIT_NOTE"],
  FIXED_ASSETS: ["ASSET_ACQUISITION", "DEPRECIATION", "DISPOSAL", "ASSET_WRITE_OFF", "ASSET_ADJUSTMENT"],
  BANK:         ["BANK_TRANSFER", "BANK_FEE", "BANK_INTEREST"],
};

export const ACCOUNT_ROLES = [
  "CONTROL_DEBIT",
  "CONTROL_CREDIT",
  "REVENUE",
  "COGS",
  "TAX",
  "CLEARING",
  "EXPENSE",
  "ASSET",
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  CONTROL_DEBIT:  "Control Debit (e.g. AR debit on invoice)",
  CONTROL_CREDIT: "Control Credit (e.g. AP credit on bill)",
  REVENUE:        "Revenue",
  COGS:           "Cost of Goods Sold",
  TAX:            "Tax Payable",
  CLEARING:       "Clearing / Transit",
  EXPENSE:        "Expense",
  ASSET:          "Asset",
};

export const MODULE_LABELS: Record<Module, string> = {
  AR:           "Accounts Receivable",
  AP:           "Accounts Payable",
  FIXED_ASSETS: "Fixed Assets",
  BANK:         "Bank",
};

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  INVOICE:          "Invoice",
  PAYMENT:          "Payment Received",
  CREDIT_NOTE:      "Credit Note",
  BILL:             "Supplier Bill",
  BILL_PAYMENT:     "Bill Payment",
  DEBIT_NOTE:       "Debit Note",
  ASSET_ACQUISITION:"Asset Acquisition",
  DEPRECIATION:     "Depreciation",
  DISPOSAL:         "Asset Disposal",
  ASSET_WRITE_OFF:  "Asset Write-Off",
  ASSET_ADJUSTMENT: "Asset Adjustment",
  BANK_TRANSFER:    "Bank Transfer",
  BANK_FEE:         "Bank Fee",
  BANK_INTEREST:    "Bank Interest",
};

// Suggest which account_types are appropriate for each role
export const ROLE_ACCOUNT_TYPES: Record<AccountRole, string[]> = {
  CONTROL_DEBIT:  ["Asset"],
  CONTROL_CREDIT: ["Liability"],
  REVENUE:        ["Income", "Other Income"],
  COGS:           ["Cost of Goods Sold"],
  TAX:            ["Liability"],
  CLEARING:       ["Asset", "Liability"],
  EXPENSE:        ["Expense", "Other Expense"],
  ASSET:          ["Asset"],
};

export function usePostingProfiles(module?: string) {
  return useQuery({
    queryKey: ["posting_profiles", module ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("posting_profiles")
        .select("*, accounts(account_code, account_name)")
        .order("module")
        .order("transaction_type")
        .order("priority");
      if (module) q = (q as any).eq("module", module);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PostingProfile[];
    },
  });
}

export function useCreatePostingProfile() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (
      profile: Omit<PostingProfile, "id" | "accounts" | "created_at" | "updated_at">
    ) => {
      const { data, error } = await supabase
        .from("posting_profiles")
        .insert({ ...profile, tenant_id: appUser?.tenant_id! })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posting_profiles"] });
      toast.success("Posting profile created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdatePostingProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Omit<PostingProfile, "accounts">> & { id: string }) => {
      const { error } = await supabase
        .from("posting_profiles")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posting_profiles"] });
      toast.success("Profile updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePostingProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("posting_profiles")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posting_profiles"] });
      toast.success("Profile deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useResolvePostingProfile() {
  return useMutation({
    mutationFn: async ({
      module,
      transaction_type,
      date,
      entity_scope,
    }: {
      module: string;
      transaction_type: string;
      date?: string;
      entity_scope?: Record<string, string> | null;
    }): Promise<ResolvedProfiles> => {
      const { data, error } = await (supabase as any).rpc("resolve_posting_profile", {
        p_module:           module,
        p_transaction_type: transaction_type,
        p_date:             date ?? new Date().toISOString().split("T")[0],
        p_entity_scope:     entity_scope ?? null,
      });
      if (error) throw error;
      return (data ?? {}) as ResolvedProfiles;
    },
    onError: (e: Error) => toast.error("Resolution failed: " + e.message),
  });
}
