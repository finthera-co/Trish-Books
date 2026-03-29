import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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
      const { total_value, ...safeItem } = item as any;
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
