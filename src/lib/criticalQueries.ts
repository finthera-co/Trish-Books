import type { FetchQueryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryClient } from "@/lib/queryClient";
import { persistQuery } from "@/lib/queryPersistence";

/**
 * Centralized registry of queries that MUST be hydrated before a tenant
 * switch resolves. Prefetched in parallel by `switchTenant` so pages render
 * fully populated — never with skeletons or stale data.
 *
 * Add a new entry whenever a screen relies on data that should be ready
 * the moment the user lands on it after switching companies.
 *
 * Conventions:
 *  - Query key MUST be `["tenant", tenantId, ...]` to match useTenantQuery.
 *  - Query fn MUST scope by tenant_id (RLS will also enforce this).
 *  - Keep these queries small + fast — heavy/page-specific data stays lazy.
 */
export type CriticalQueryFactory = (tenantId: string) => FetchQueryOptions<unknown>;

export const CRITICAL_QUERIES: Record<string, CriticalQueryFactory> = {
  accounts: (tenantId) => ({
    queryKey: ["tenant", tenantId, "accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  customers: (tenantId) => ({
    queryKey: ["tenant", tenantId, "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  vendors: (tenantId) => ({
    queryKey: ["tenant", tenantId, "vendors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  invoices: (tenantId) => ({
    queryKey: ["tenant", tenantId, "invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, customers(name)")
        .eq("tenant_id", tenantId)
        .order("issue_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  fiscalPeriods: (tenantId) => ({
    queryKey: ["tenant", tenantId, "fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  // ── prefetched at login to eliminate per-page loading ──
  // Note: no separate "bank accounts" table exists — bank accounts are
  // rows in `accounts` (COA), already covered by the `accounts` entry above.

  bills: (tenantId) => ({
    queryKey: ["tenant", tenantId, "bills"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_bills")
        .select("*, vendors(name)")
        .eq("tenant_id", tenantId)
        .order("bill_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  taxRates: (tenantId) => ({
    queryKey: ["tenant", tenantId, "tax_rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("taxes")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("tax_name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  accountSettings: (tenantId) => ({
    queryKey: ["tenant", tenantId, "account_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  pettyCashAccounts: (tenantId) => ({
    queryKey: ["tenant", tenantId, "petty_cash_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_accounts")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("account_name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  postingProfiles: (tenantId) => ({
    queryKey: ["tenant", tenantId, "posting_profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posting_profiles")
        .select("*, accounts(account_code, account_name)")
        .eq("tenant_id", tenantId)
        .order("module")
        .order("transaction_type")
        .order("priority");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),

  expenseCategories: (tenantId) => ({
    queryKey: ["tenant", tenantId, "expense_categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  }),
};

/**
 * Prefetch every critical query in parallel. Resolves only when all settle.
 * After each successful fetch, the result is persisted to IndexedDB for
 * instant hydration on the next app load.
 */
export async function prefetchCriticalQueries(
  tenantId: string,
  prefetch: (opts: FetchQueryOptions<unknown>) => Promise<void>
) {
  await Promise.allSettled(
    Object.entries(CRITICAL_QUERIES).map(async ([, factory]) => {
      const opts = factory(tenantId);
      await prefetch(opts);
      // prefetch() already populated the shared queryClient's cache — read
      // it back instead of re-invoking queryFn (which would double the
      // network request for every critical query).
      const data = queryClient.getQueryData(opts.queryKey);
      if (data !== undefined) {
        await persistQuery(opts.queryKey as unknown[], data);
      }
    })
  );
}
