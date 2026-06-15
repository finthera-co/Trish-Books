import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sortAccounts } from "@/lib/accountSort";

export interface AccountSearchResult {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  is_active: boolean;
}

interface Options {
  query: string;
  /** Restrict to specific account_type values (e.g. ["Asset", "Liability"]) */
  types?: string[];
  /** Show inactive accounts too. Defaults to false. */
  includeInactive?: boolean;
  /** Max rows returned. Default 20. */
  limit?: number;
  enabled?: boolean;
}

/**
 * Search-as-you-type account lookup.
 * Hits the `accounts` table directly with ILIKE on code + name.
 * Trigram indexes (idx_accounts_code_trgm, idx_accounts_name_trgm) keep this <100ms.
 */
export function useAccountSearch({
  query,
  types,
  includeInactive = false,
  limit = 20,
  enabled = true,
}: Options) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ["account-search", trimmed, types?.join(",") || "*", includeInactive, limit],
    enabled: enabled && trimmed.length >= 2,
    staleTime: 30_000, // cache recent queries for 30s
    queryFn: async (): Promise<AccountSearchResult[]> => {
      let q = supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type, is_active")
        .or(`account_code.ilike.%${trimmed}%,account_name.ilike.%${trimmed}%`)
        .order("account_code", { ascending: true })
        .limit(limit);

      if (!includeInactive) q = q.eq("is_active", true);
      if (types && types.length > 0) q = q.in("account_type", types);

      const { data, error } = await q;
      if (error) throw error;
      return sortAccounts((data || []) as AccountSearchResult[]);
    },
  });
}

/** Fetch a single account by id — used to hydrate the selector when a value is preset. */
export function useAccountById(id: string | null | undefined) {
  return useQuery({
    queryKey: ["account-by-id", id],
    enabled: !!id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AccountSearchResult | null> => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type, is_active")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as AccountSearchResult | null;
    },
  });
}
