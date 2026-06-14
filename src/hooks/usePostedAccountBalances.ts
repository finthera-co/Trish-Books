import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * usePostedAccountBalances
 * ────────────────────────────────────────────────────────────────────────────
 * Builds a map of account_id → { debit, credit } summing every POSTED,
 * non-voided journal line for the tenant. This is the missing piece that made
 * Fixed Asset (and any transaction-driven) balances fail to roll up: the COA
 * previously only knew about opening balances and computed inventory value, so
 * acquisition / depreciation journals (Dr 1600 / Cr Cash, Dr 7100 / Cr 1650)
 * never appeared against the leaf accounts and therefore never rolled up into
 * their parents.
 *
 * Optionally scoped to a fiscal period's date window when a period with start /
 * end dates is supplied. When no period is given, ALL posted lines are summed
 * (cumulative-to-date), which is the correct view for Balance-Sheet control
 * accounts like PP&E and Accumulated Depreciation.
 *
 * Mirrors the shape/conventions of useInventoryAccountBalanceMap so it can be
 * merged into the same balance pipeline in ChartOfAccounts.
 */
export interface PostedMovement {
  debit: number;
  credit: number;
}

interface PeriodWindow {
  period_start?: string | null;
  period_end?: string | null;
}

export function usePostedAccountBalances(period?: PeriodWindow | null) {
  const { appUser } = useAuth();
  const start = period?.period_start ?? null;
  const end = period?.period_end ?? null;

  return useQuery({
    queryKey: ["posted_account_balances", appUser?.tenant_id, start, end],
    queryFn: async () => {
      const tid = appUser!.tenant_id;

      const { data: lines, error } = await supabase
        .from("journal_lines")
        .select(
          "account_id, debit, credit, journal_entries!inner(entry_date, status, tenant_id, voided_at)"
        )
        .filter("journal_entries.tenant_id", "eq", tid);

      if (error) throw error;

      const map = new Map<string, PostedMovement>();

      for (const line of (lines || []) as any[]) {
        const entry = line.journal_entries;
        if (!entry || entry.status !== "posted" || entry.voided_at) continue;
        if (start && entry.entry_date < start) continue;
        if (end && entry.entry_date > end) continue;

        const existing = map.get(line.account_id) || { debit: 0, credit: 0 };
        existing.debit += Number(line.debit) || 0;
        existing.credit += Number(line.credit) || 0;
        map.set(line.account_id, existing);
      }

      return map;
    },
    enabled: !!appUser?.tenant_id,
    staleTime: 30_000,
  });
}
