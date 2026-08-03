import type { TrialBalanceRow } from "@/hooks/useTrialBalance";

export interface TrialBalanceGroupBlock {
  key: string;
  label: string;
  rows: TrialBalanceRow[];
  ledger_opening: number;
  audit_opening: number;
  period_debit: number;
  period_credit: number;
  closing: number;
}

export interface TrialBalanceGrandTotal {
  ledger_opening: number;
  audit_opening: number;
  period_debit: number;
  period_credit: number;
  closing: number;
}

const EMPTY_GRAND: TrialBalanceGrandTotal = { ledger_opening: 0, audit_opening: 0, period_debit: 0, period_credit: 0, closing: 0 };

/**
 * Groups already-sorted rpc_trial_balance rows (grouped/sorted server-side by
 * group_key, account_code) into header/detail/subtotal blocks, plus the grand
 * total across every group. Pure — the client never re-derives a total from
 * anything other than these input rows.
 */
export function buildTrialBalanceGroups(rows: readonly TrialBalanceRow[]): { groups: TrialBalanceGroupBlock[]; grand: TrialBalanceGrandTotal } {
  const map = new Map<string, TrialBalanceGroupBlock>();
  const order: string[] = [];

  for (const r of rows) {
    if (!map.has(r.group_key)) {
      map.set(r.group_key, {
        key: r.group_key,
        label: r.group_label,
        rows: [],
        ledger_opening: 0,
        audit_opening: 0,
        period_debit: 0,
        period_credit: 0,
        closing: 0,
      });
      order.push(r.group_key);
    }
    const g = map.get(r.group_key)!;
    g.rows.push(r);
    g.ledger_opening += r.ledger_opening;
    g.audit_opening += r.audit_opening;
    g.period_debit += r.period_debit;
    g.period_credit += r.period_credit;
    g.closing += r.closing;
  }

  const groups = order.map((k) => map.get(k)!);
  const grand = groups.reduce(
    (acc, g) => ({
      ledger_opening: acc.ledger_opening + g.ledger_opening,
      audit_opening: acc.audit_opening + g.audit_opening,
      period_debit: acc.period_debit + g.period_debit,
      period_credit: acc.period_credit + g.period_credit,
      closing: acc.closing + g.closing,
    }),
    { ...EMPTY_GRAND }
  );

  return { groups, grand };
}

export function filterVarianceRows(rows: readonly TrialBalanceRow[]): TrialBalanceRow[] {
  return rows.filter((r) => r.has_audit_row && Math.abs(r.opening_variance) > 0.005);
}

export interface VarianceStats {
  count: number;
  net: number;
}

export function computeVarianceStats(rows: readonly TrialBalanceRow[]): VarianceStats {
  const varianceRows = filterVarianceRows(rows);
  return { count: varianceRows.length, net: varianceRows.reduce((s, r) => s + r.opening_variance, 0) };
}
