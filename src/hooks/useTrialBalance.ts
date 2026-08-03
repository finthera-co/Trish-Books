import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toNum } from "@/hooks/useGeneralLedger";

export type TrialBalanceGroupBy = "parent" | "category" | "type";

export interface TrialBalanceRow {
  group_key: string;
  group_label: string;
  group_sort: string;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  ledger_opening: number;
  audit_opening: number;
  opening_variance: number;
  period_debit: number;
  period_credit: number;
  closing: number;
  has_audit_row: boolean;
}

export interface TrialBalanceOptions {
  groupBy?: TrialBalanceGroupBy;
  includeZero?: boolean;
  includeInactive?: boolean;
}

function mapRow(r: any): TrialBalanceRow {
  return {
    group_key: r.group_key,
    group_label: r.group_label,
    group_sort: r.group_sort,
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    account_type: r.account_type,
    ledger_opening: toNum(r.ledger_opening),
    audit_opening: toNum(r.audit_opening),
    opening_variance: toNum(r.opening_variance),
    period_debit: toNum(r.period_debit),
    period_credit: toNum(r.period_credit),
    closing: toNum(r.closing),
    has_audit_row: !!r.has_audit_row,
  };
}

/**
 * Single trial balance implementation — replaces both TrialBalance.tsx's and
 * Reports.tsx's independent client-side aggregations, which could (and did)
 * disagree with each other on the same tenant. All arithmetic happens in
 * Postgres; the client never re-derives a total it renders.
 */
export function useTrialBalance(dateFrom: string, dateTo: string, opts?: TrialBalanceOptions) {
  const { appUser } = useAuth();
  const groupBy = opts?.groupBy ?? "parent";
  const includeZero = opts?.includeZero ?? false;
  const includeInactive = opts?.includeInactive ?? true;

  return useQuery({
    queryKey: ["trial_balance", appUser?.tenant_id, dateFrom, dateTo, groupBy, includeZero, includeInactive],
    enabled: Boolean(dateFrom && dateTo),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_trial_balance" as any, {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_group_by: groupBy,
        p_include_zero: includeZero,
        p_include_inactive: includeInactive,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapRow);
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
