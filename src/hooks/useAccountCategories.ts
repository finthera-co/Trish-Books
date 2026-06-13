import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface AccountCategory {
  id: string;
  tenant_id: string;
  name: string;
  account_type: string;
  sort_order: number;
  created_at: string;
}

export function useAccountCategories() {
  return useQuery({
    queryKey: ["account_categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_categories")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as AccountCategory[];
    },
  });
}

export function useCreateAccountCategory() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (cat: { name: string; account_type: string; sort_order?: number }) => {
      const { data, error } = await supabase
        .from("account_categories")
        .insert({ ...cat, tenant_id: appUser?.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data as AccountCategory;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account_categories"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// The single permitted auto-created account. A new tenant's COA starts EMPTY
// except for this system Opening Balance Equity account (code 3900). No default
// COA accounts and no default categories are ever seeded.
export function useEnsureOBEAccount() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const tenantId = appUser.tenant_id;

      // Idempotent: skip if the system OBE account (code 3900) already exists.
      const { data: existing } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("account_code", "3900")
        .eq("is_system", true)
        .maybeSingle();
      if (existing) return { addedAccounts: 0 };

      const { error } = await supabase.from("accounts").insert({
        tenant_id: tenantId,
        account_code: "3900",
        account_name: "Opening Balance Equity",
        account_type: "Equity",
        account_subtype: "Opening Balance Equity",
        normal_balance: "credit",
        is_system: true,
        is_active: true,
        is_locked: true,
      });
      if (error) throw error;

      return { addedAccounts: 1 };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account_categories"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
