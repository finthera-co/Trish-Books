import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const COA_QUERY_KEYS = ["accounts", "chart_of_accounts", "trial_balance", "balance_sheet"];

export function useFixedAssets() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fixed_assets", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useFixedAsset(id: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["fixed_asset", id],
    enabled: !!id && !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useAssetDepreciation(assetId: string | undefined) {
  return useQuery({
    queryKey: ["asset_depreciation", assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_depreciation")
        .select("*")
        .eq("asset_id", assetId!)
        .order("period", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useAssetJournalEntries(assetId: string | undefined) {
  return useQuery({
    queryKey: ["asset_journal_entries", assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data: depRecs } = await supabase
        .from("asset_depreciation")
        .select("journal_entry_id, period")
        .eq("asset_id", assetId!)
        .not("journal_entry_id", "is", null)
        .order("period", { ascending: true });

      const { data: dispRecs } = await supabase
        .from("asset_disposals")
        .select("journal_entry_id, disposal_date")
        .eq("asset_id", assetId!)
        .not("journal_entry_id", "is", null);

      const jeIds = [
        ...(depRecs?.map(r => r.journal_entry_id).filter(Boolean) ?? []),
        ...(dispRecs?.map(r => r.journal_entry_id).filter(Boolean) ?? []),
      ];

      if (jeIds.length === 0) return [];

      const { data: entries, error } = await supabase
        .from("journal_entries")
        .select("id, entry_date, description, status, journal_lines(id, account_id, debit, credit, accounts:account_id(account_code, account_name))")
        .in("id", jeIds)
        .order("entry_date", { ascending: true });
      if (error) throw error;
      return entries ?? [];
    },
  });
}

// ─── Edge Function calls ───

async function callAssetEngine(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("post-asset-transaction", {
    body,
  });
  if (error) throw new Error(error.message || "Edge function call failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["fixed_assets"] });
  qc.invalidateQueries({ queryKey: ["fixed_asset"] });
  qc.invalidateQueries({ queryKey: ["asset_subledger"] });
  qc.invalidateQueries({ queryKey: ["asset_depreciation"] });
  qc.invalidateQueries({ queryKey: ["asset_journal_entries"] });
  COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: {
      name: string;
      category_id: string;
      cost: number;
      salvage_value?: number;
      useful_life_months?: number;
      purchase_date?: string;
      depreciation_start_date?: string;
      payment_account_id: string;
      description?: string;
    }) => {
      return callAssetEngine({ event_type: "ASSET_CREATED", ...asset });
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Asset created with journal entry posted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase
        .from("fixed_assets")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Asset updated");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useRunDepreciation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => {
      return callAssetEngine({ event_type: "DEPRECIATION_POSTED", period });
    },
    onSuccess: (result: any) => {
      invalidateAll(qc);
      toast.success(`Depreciation: ${result.processed} posted, ${result.skipped} skipped`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDisposeAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, saleValue, cashAccountId }: { assetId: string; saleValue: number; cashAccountId: string }) => {
      return callAssetEngine({
        event_type: "ASSET_DISPOSED",
        asset_id: assetId,
        sale_price: saleValue,
        cash_account_id: cashAccountId,
      });
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Asset disposed successfully");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useAdjustAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, adjustmentType, amount, reason }: {
      assetId: string;
      adjustmentType: string;
      amount: number;
      reason?: string;
    }) => {
      return callAssetEngine({
        event_type: "ASSET_ADJUSTED",
        asset_id: assetId,
        adjustment_type: adjustmentType,
        amount,
        reason,
      });
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Asset adjustment applied");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useTransferCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, newCategoryId }: { assetId: string; newCategoryId: string }) => {
      return callAssetEngine({
        event_type: "CATEGORY_TRANSFER",
        asset_id: assetId,
        new_category_id: newCategoryId,
      });
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Asset category transferred");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useBulkImportAssets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assets: Array<{
      name: string;
      category_id: string;
      cost: number;
      payment_account_id: string;
      salvage_value?: number;
      useful_life_months?: number;
      purchase_date?: string;
      description?: string;
    }>) => {
      return callAssetEngine({ event_type: "BULK_IMPORT", assets });
    },
    onSuccess: (result: any) => {
      invalidateAll(qc);
      toast.success(`Bulk import: ${result.created} created, ${result.failed} failed`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}
