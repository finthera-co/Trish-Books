import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toNum } from "@/hooks/useGeneralLedger";

/** One account or journal entry behind a component of the difference. */
export interface ImbalanceItem {
  kind: "account" | "entry";
  id: string;
  code: string;
  label: string;
  note: string;
  /** Signed, debit-positive: what this row adds to the closing difference. */
  amount: number;
}

export interface ImbalanceComponent {
  code: "pl_opening_not_closed" | "unbalanced_entries" | "audit_opening_override" | "excluded_accounts";
  label: string;
  detail: string;
  amount: number;
  count: number;
  items: ImbalanceItem[];
}

export interface TrialBalanceDiagnostics {
  dateFrom: string;
  dateTo: string;
  openingDifference: number;
  periodDifference: number;
  closingDifference: number;
  /** Components minus the difference. Zero by construction — shown if it isn't. */
  residual: number;
  components: ImbalanceComponent[];
}

function mapItem(r: any): ImbalanceItem {
  return {
    kind: r.kind === "entry" ? "entry" : "account",
    id: r.id,
    code: r.code ?? "",
    label: r.label ?? "",
    note: r.note ?? "",
    amount: toNum(r.amount),
  };
}

function mapDiagnostics(d: any): TrialBalanceDiagnostics {
  return {
    dateFrom: d.date_from,
    dateTo: d.date_to,
    openingDifference: toNum(d.opening_difference),
    periodDifference: toNum(d.period_difference),
    closingDifference: toNum(d.closing_difference),
    residual: toNum(d.residual),
    components: ((d.components ?? []) as any[]).map((c) => ({
      code: c.code,
      label: c.label,
      detail: c.detail,
      amount: toNum(c.amount),
      count: Number(c.count ?? 0),
      items: ((c.items ?? []) as any[]).map(mapItem),
    })),
  };
}

/**
 * Why the Trial Balance does not balance, decomposed exactly.
 *
 * The arithmetic runs in Postgres against the same range and account
 * population the report itself was built from — the client never re-derives a
 * cause from the rendered rows, so the explanation cannot drift from the
 * figures it is explaining. Deliberately lazy: `enabled` stays false until the
 * reader opens the banner, since the scan reads every posted line up to the
 * report's end date.
 */
export function useTrialBalanceDiagnostics(
  dateFrom: string,
  dateTo: string,
  includeInactive: boolean,
  enabled: boolean
) {
  const { appUser } = useAuth();

  return useQuery({
    queryKey: ["trial_balance_diagnostics", appUser?.tenant_id, dateFrom, dateTo, includeInactive],
    enabled: enabled && Boolean(dateFrom && dateTo),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_trial_balance_diagnostics" as any, {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_include_inactive: includeInactive,
      });
      if (error) throw error;
      return mapDiagnostics(data ?? {});
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
