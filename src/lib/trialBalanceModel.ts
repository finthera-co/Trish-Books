import type { TrialBalanceRow } from "@/hooks/useTrialBalance";

/**
 * A trial balance is presented as debit/credit pairs — the convention in Tally,
 * Zoho Books, Sage and every audit pack — rather than one signed column per
 * stage. Each pair proves out on its own (Opening Dr = Opening Cr, Period Dr =
 * Period Cr, Closing Dr = Closing Cr) for a complete ledger, so the report
 * demonstrates its own integrity instead of asking the reader to trust a single
 * netted figure of zero.
 *
 * The split has to happen per account and only then be summed: sum(max(x,0)) is
 * not max(sum(x),0), so netting first would collapse a debit and a credit of the
 * same size into nothing and understate both columns.
 */
export interface TrialBalanceTotals {
  opening_debit: number;
  opening_credit: number;
  period_debit: number;
  period_credit: number;
  closing_debit: number;
  closing_credit: number;
  /** Signed sums, retained for the ledger-vs-audit opening variance panel. */
  ledger_opening: number;
  audit_opening: number;
}

export interface TrialBalanceGroupBlock extends TrialBalanceTotals {
  key: string;
  label: string;
  rows: TrialBalanceRow[];
}

export type TrialBalanceGrandTotal = TrialBalanceTotals;

const EPSILON = 0.005;

function emptyTotals(): TrialBalanceTotals {
  return {
    opening_debit: 0,
    opening_credit: 0,
    period_debit: 0,
    period_credit: 0,
    closing_debit: 0,
    closing_credit: 0,
    ledger_opening: 0,
    audit_opening: 0,
  };
}

/** Signed balance → the debit/credit cell pair. Sub-cent noise renders as nothing. */
export function splitBalance(signed: number): { debit: number; credit: number } {
  if (signed > EPSILON) return { debit: signed, credit: 0 };
  if (signed < -EPSILON) return { debit: 0, credit: -signed };
  return { debit: 0, credit: 0 };
}

/**
 * The opening a row's closing balance actually ties off. rpc_trial_balance
 * computes closing = audit_opening + debit - credit, and audit_opening already
 * falls back to the ledger-derived opening whenever no opening-balance row has
 * been recorded — so this is the ledger carry-forward for tenants that have
 * never entered opening balances, which is how QuickBooks and Xero behave.
 */
export const effectiveOpening = (r: TrialBalanceRow): number => r.audit_opening;

export function openingSplit(r: TrialBalanceRow) {
  return splitBalance(effectiveOpening(r));
}

export function closingSplit(r: TrialBalanceRow) {
  return splitBalance(r.closing);
}

function accumulate(into: TrialBalanceTotals, r: TrialBalanceRow): void {
  const open = openingSplit(r);
  const close = closingSplit(r);
  into.opening_debit += open.debit;
  into.opening_credit += open.credit;
  into.period_debit += r.period_debit;
  into.period_credit += r.period_credit;
  into.closing_debit += close.debit;
  into.closing_credit += close.credit;
  into.ledger_opening += r.ledger_opening;
  into.audit_opening += r.audit_opening;
}

/**
 * Groups already-sorted rpc_trial_balance rows (grouped/sorted server-side by
 * group_key, account_code) into header/detail/subtotal blocks, plus the grand
 * total across every group. Pure — the client never re-derives a total from
 * anything other than these input rows.
 */
export function buildTrialBalanceGroups(rows: readonly TrialBalanceRow[]): {
  groups: TrialBalanceGroupBlock[];
  grand: TrialBalanceGrandTotal;
} {
  const map = new Map<string, TrialBalanceGroupBlock>();
  const order: string[] = [];
  const grand = emptyTotals();

  for (const r of rows) {
    if (!map.has(r.group_key)) {
      map.set(r.group_key, { key: r.group_key, label: r.group_label, rows: [], ...emptyTotals() });
      order.push(r.group_key);
    }
    const g = map.get(r.group_key)!;
    g.rows.push(r);
    accumulate(g, r);
    // Accumulated from the rows, not from the group subtotals: a group subtotal
    // is itself already a netted-then-split figure, and re-splitting it would
    // drift from the sum of the accounts it covers.
    accumulate(grand, r);
  }

  return { groups: order.map((k) => map.get(k)!), grand };
}

/** Dr and Cr must agree at every stage for a complete, balanced ledger. */
export function isBalanced(t: TrialBalanceTotals): boolean {
  return (
    Math.abs(t.opening_debit - t.opening_credit) < EPSILON &&
    Math.abs(t.period_debit - t.period_credit) < EPSILON &&
    Math.abs(t.closing_debit - t.closing_credit) < EPSILON
  );
}

export function closingDifference(t: TrialBalanceTotals): number {
  return t.closing_debit - t.closing_credit;
}

export function filterVarianceRows(rows: readonly TrialBalanceRow[]): TrialBalanceRow[] {
  return rows.filter((r) => r.has_audit_row && Math.abs(r.opening_variance) > EPSILON);
}

export interface VarianceStats {
  count: number;
  net: number;
}

export function computeVarianceStats(rows: readonly TrialBalanceRow[]): VarianceStats {
  const varianceRows = filterVarianceRows(rows);
  return { count: varianceRows.length, net: varianceRows.reduce((s, r) => s + r.opening_variance, 0) };
}

/**
 * How the report should describe its opening balances. Distinguishes "no
 * opening balances have been recorded, so these are ledger carry-forwards"
 * (the normal state for a tenant that has never run an opening-balance entry)
 * from "the period genuinely starts before any posting, so every opening is
 * zero" — two situations that otherwise look identical on screen.
 */
export type OpeningBasis = "audited" | "ledger-carry-forward" | "none";

export function openingBasis(rows: readonly TrialBalanceRow[]): OpeningBasis {
  if (rows.some((r) => r.has_audit_row)) return "audited";
  if (rows.some((r) => Math.abs(r.ledger_opening) > EPSILON)) return "ledger-carry-forward";
  return "none";
}
