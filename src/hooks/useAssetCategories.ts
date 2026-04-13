import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useAssetCategories() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["asset_categories", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_categories")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateAssetCategory() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (cat: {
      name: string;
      asset_account_id?: string;
      accumulated_depreciation_account_id?: string;
      depreciation_expense_account_id?: string;
      disposal_gain_account_id?: string;
      disposal_loss_account_id?: string;
      depreciation_method?: string;
      default_useful_life_months?: number;
      proration_method?: string;
    }) => {
      const { data, error } = await supabase
        .from("asset_categories")
        .insert({ ...cat, tenant_id: appUser!.tenant_id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_categories"] });
      toast.success("Asset category created");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase
        .from("asset_categories")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_categories"] });
      toast.success("Asset category updated");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteAssetCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Check if any assets use this category
      const { data: assets } = await supabase
        .from("fixed_assets")
        .select("id")
        .eq("category_id", id)
        .limit(1);
      if (assets && assets.length > 0) {
        throw new Error("Cannot delete category with linked assets. Reassign assets first.");
      }
      const { error } = await supabase
        .from("asset_categories")
        .update({ is_active: false } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_categories"] });
      toast.success("Asset category deactivated");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
