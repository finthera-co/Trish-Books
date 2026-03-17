import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Get a system setting
export function useSystemSetting(key: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["system_setting", appUser?.tenant_id, key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("setting_key", key)
        .maybeSingle();
      if (error) throw error;
      return data?.setting_value || null;
    },
    enabled: !!appUser?.tenant_id,
  });
}

// Save a system setting
export function useSaveSystemSetting() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error } = await supabase.from("system_settings").upsert(
        {
          tenant_id: appUser.tenant_id,
          setting_key: key,
          setting_value: value,
          updated_by: appUser.id,
        },
        { onConflict: "tenant_id,setting_key" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["system_setting", appUser?.tenant_id, vars.key] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Opening balance date
export function useOpeningBalanceDate() {
  return useSystemSetting("opening_balance_date");
}

// Opening balance status: draft | finalized | closed
export function useOpeningBalanceStatus() {
  return useSystemSetting("opening_balance_status");
}

// Finalize opening balances - locks entries and syncs to accounts table
export function useFinalizeOpeningBalances() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      
      // Set status to finalized
      await supabase.from("system_settings").upsert(
        {
          tenant_id: appUser.tenant_id,
          setting_key: "opening_balance_status",
          setting_value: "finalized",
          updated_by: appUser.id,
        },
        { onConflict: "tenant_id,setting_key" }
      );

      // Audit
      await supabase.from("audit_logs").insert({
        action: "Opening Balances Finalized",
        table_name: "system_settings",
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system_setting"] });
      toast.success("Opening balances finalized");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Revert to draft
export function useRevertToDraft() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      await supabase.from("system_settings").upsert(
        {
          tenant_id: appUser.tenant_id,
          setting_key: "opening_balance_status",
          setting_value: "draft",
          updated_by: appUser.id,
        },
        { onConflict: "tenant_id,setting_key" }
      );
      await supabase.from("audit_logs").insert({
        action: "Opening Balances Reverted to Draft",
        table_name: "system_settings",
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system_setting"] });
      toast.success("Opening balances reverted to draft");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Update account opening balance (per-account inline entry)
export function useSaveAccountOpeningBalance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      accountId,
      openingBalance,
      openingBalanceType,
    }: {
      accountId: string;
      openingBalance: number;
      openingBalanceType: "debit" | "credit";
    }) => {
      const { error } = await supabase
        .from("accounts")
        .update({
          opening_balance: openingBalance,
          opening_balance_type: openingBalanceType,
        })
        .eq("id", accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      toast.success("Opening balance saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
