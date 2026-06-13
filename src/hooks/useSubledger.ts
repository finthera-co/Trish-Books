import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { postFixedAssetOpeningBalanceWithCreate } from "@/lib/postingEngine";

// ─── Vendors ───────────────────────────────────────────────

export function useVendors() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["vendors", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateVendor() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vendor: { name: string; email?: string; phone?: string; address?: string }) => {
      const { data, error } = await supabase
        .from("vendors")
        .insert({ ...vendor, tenant_id: appUser!.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Inventory Items ───────────────────────────────────────

export function useInventoryItems() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inventory_items", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("item_name");
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateInventoryItem() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: { item_name: string; sku?: string; description?: string; unit_cost?: number; quantity_on_hand?: number; account_id?: string }) => {
      const { ...safeItem } = item as any;
      const { data, error } = await supabase
        .from("inventory_items")
        .insert({ ...safeItem, tenant_id: appUser!.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      toast.success("Inventory item created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Fixed Assets ──────────────────────────────────────────

export function useFixedAssets() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fixed_assets", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("asset_name");
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateFixedAsset() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: { asset_name: string; description?: string; acquisition_date?: string; cost?: number; accumulated_depreciation?: number; asset_account_id?: string; depreciation_account_id?: string }) => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .insert({ ...asset, tenant_id: appUser!.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      toast.success("Fixed asset created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Create a MIGRATED fixed asset and post its opening balance from within the
 * Opening Balances sub-ledger breakdown — the single entry point for pre-go-live
 * assets. Posts only opening journals (no acquisition), then records the
 * opening_balance_details allocation (amount = gross cost) so the new asset shows
 * as allocated against the control balance.
 */
export function useCreateMigratedAsset() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      account_id: string;            // OB control account (asset cost, e.g. 1710)
      asset_name: string;
      description?: string;
      category_id?: string;
      accumulated_depreciation_account_id: string;
      depreciation_method?: string;
      cost: number;
      opening_accum_dep: number;
      salvage_value?: number;
      useful_life_months: number;
      acquisition_date: string;
      as_of_date: string;
    }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      const result = await postFixedAssetOpeningBalanceWithCreate({
        tenant_id: appUser.tenant_id,
        asset_name: params.asset_name,
        description: params.description,
        category_id: params.category_id,
        asset_account_id: params.account_id,
        accumulated_depreciation_account_id: params.accumulated_depreciation_account_id,
        depreciation_method: params.depreciation_method,
        cost: params.cost,
        opening_accum_dep: params.opening_accum_dep,
        salvage_value: params.salvage_value,
        useful_life_months: params.useful_life_months,
        acquisition_date: params.acquisition_date,
        as_of_date: params.as_of_date,
      });

      // Record the sub-ledger allocation (gross cost) so the asset shows allocated.
      const { error } = await supabase
        .from("opening_balance_details")
        .upsert(
          {
            account_id: params.account_id,
            entity_type: "fixed_asset",
            entity_id: result.asset_id,
            amount: params.cost,
            tenant_id: appUser.tenant_id,
          },
          { onConflict: "account_id,entity_type,entity_id" }
        );
      if (error) throw error;

      return result;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["fixed_assets"] });
      qc.invalidateQueries({ queryKey: ["opening_balance_details", vars.account_id] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Migrated asset created and opening balance posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Opening Balance Details (Sub-ledger) ──────────────────

export function useOpeningBalanceDetails(accountId: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["opening_balance_details", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opening_balance_details")
        .select("*")
        .eq("account_id", accountId!)
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!accountId && !!appUser?.tenant_id,
  });
}

export function useSaveOpeningBalanceDetail() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (detail: {
      account_id: string;
      entity_type: string;
      entity_id: string;
      amount: number;
      notes?: string;
    }) => {
      const { error } = await supabase
        .from("opening_balance_details")
        .upsert(
          {
            ...detail,
            tenant_id: appUser!.tenant_id,
          },
          { onConflict: "account_id,entity_type,entity_id" }
        );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["opening_balance_details", vars.account_id] });
      toast.success("Sub-ledger detail saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteOpeningBalanceDetail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accountId }: { id: string; accountId: string }) => {
      const { error } = await supabase
        .from("opening_balance_details")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return accountId;
    },
    onSuccess: (accountId) => {
      qc.invalidateQueries({ queryKey: ["opening_balance_details", accountId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Helpers ───────────────────────────────────────────────

/** Determine what sub-ledger entity type an account requires based on its subtype */
export function getSubledgerType(accountSubtype: string | null | undefined): string | null {
  if (!accountSubtype) return null;
  const lower = accountSubtype.toLowerCase();
  if (lower.includes("accounts receivable") || lower === "receivable") return "customer";
  if (lower.includes("accounts payable") || lower === "payable") return "vendor";
  if (lower.includes("inventory")) return "inventory_item";
  if (lower.includes("fixed asset") || lower.includes("accumulated depreciation")) return "fixed_asset";
  return null;
}
