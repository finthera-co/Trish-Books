/**
 * Batch-level validation: control totals, running-balance continuity,
 * duplicate detection. Line-level gates live in resolve.ts (Blocked/Suspense).
 *
 * All of this re-runs server-side; client results are advisory only.
 */

import { normalizeText } from "./normalize.ts";
import { isTotalsRow } from "./resolve.ts";
import type {
  BalanceDiscontinuity,
  BatchDuplicate,
  BatchValidation,
  ParsedLine,
  TotalsReconciliation,
  TotalsRow,
} from "./types.ts";

const BALANCE_TOLERANCE = 0.02;

export function computeControlTotals(lines: ParsedLine[]): {
  totalDebit: number;
  totalCredit: number;
  rowCount: number;
  excludedCount: number;
} {
  let totalDebit = 0;
  let totalCredit = 0;
  let rowCount = 0;
  let excludedCount = 0;
  for (const l of lines) {
    if (l.isExcluded) {
      excludedCount++;
      continue;
    }
    // A footer TOTAL is a restatement of the rows above it, never a movement.
    // Counting it here would double the batch's control figures.
    if (isTotalsRow(l)) continue;
    rowCount++;
    if (Number.isFinite(l.debit) && l.debit > 0) totalDebit += l.debit;
    if (Number.isFinite(l.credit) && l.credit > 0) totalCredit += l.credit;
  }
  return {
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    rowCount,
    excludedCount,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Recompute running-balance continuity per sheet, where the sheet carries a
 * balance column: expected balance = previous balance + credit − debit.
 * Discontinuities are FLAGGED in the import summary, never blocking — the
 * source is a hand-maintained workbook and gaps are exactly what the
 * accountant needs to see.
 */
export function checkBalanceContinuity(lines: ParsedLine[]): BalanceDiscontinuity[] {
  const bySheet = new Map<string, ParsedLine[]>();
  for (const l of lines) {
    const list = bySheet.get(l.sheetName) ?? [];
    list.push(l);
    bySheet.set(l.sheetName, list);
  }
  const out: BalanceDiscontinuity[] = [];
  for (const sheetLines of bySheet.values()) {
    const ordered = [...sheetLines].sort((a, b) => a.rowIndex - b.rowIndex);
    let prevBalance: number | null = null;
    for (const l of ordered) {
      if (l.balance === null || !Number.isFinite(l.balance)) continue;
      const debit = Number.isFinite(l.debit) ? l.debit : 0;
      const credit = Number.isFinite(l.credit) ? l.credit : 0;
      if (prevBalance !== null && !l.isExcluded) {
        const expected = round2(prevBalance + credit - debit);
        if (Math.abs(expected - l.balance) > BALANCE_TOLERANCE) {
          out.push({
            sheetName: l.sheetName,
            rowIndex: l.rowIndex,
            expected,
            actual: l.balance,
          });
        }
      }
      prevBalance = l.balance;
    }
  }
  return out;
}

/**
 * In-batch duplicate tuples (date, normalized description/name, debit, credit).
 * Salary runs legitimately contain same-day duplicates — FLAG, don't reject.
 */
export function findDuplicates(lines: ParsedLine[]): BatchDuplicate[] {
  const groups = new Map<string, Array<{ sheetName: string; rowIndex: number }>>();
  for (const l of lines) {
    if (l.isExcluded) continue;
    if (!Number.isFinite(l.debit) || !Number.isFinite(l.credit)) continue;
    const desc = normalizeText(l.description) || normalizeText(l.name);
    const key = `${l.txnDate ?? "?"}|${desc}|${l.debit}|${l.credit}`;
    const list = groups.get(key) ?? [];
    list.push({ sheetName: l.sheetName, rowIndex: l.rowIndex });
    groups.set(key, list);
  }
  const out: BatchDuplicate[] = [];
  for (const [key, rowRefs] of groups) {
    if (rowRefs.length > 1) out.push({ key, rowRefs });
  }
  return out;
}

/** Every footer TOTAL / subtotal row the sheet printed, in sheet order. */
export function findTotalsRows(lines: ParsedLine[]): TotalsRow[] {
  return lines
    .filter((l) => isTotalsRow(l))
    .map((l) => ({
      sheetName: l.sheetName,
      rowIndex: l.rowIndex,
      debit: Number.isFinite(l.debit) ? round2(l.debit) : 0,
      credit: Number.isFinite(l.credit) ? round2(l.credit) : 0,
    }))
    .sort((a, b) => a.rowIndex - b.rowIndex);
}

/**
 * Reconcile what we are about to post against the sheet's OWN printed bottom
 * line — the check that catches a workbook whose totals disagree with its rows.
 *
 * A sheet can print several footer figures (per-section subtotals then a grand
 * total), so the declared figure is the LARGEST on each side: a grand total is
 * by definition >= any subtotal beneath it. Compared to the cent, no tolerance —
 * a bank statement that doesn't foot is exactly what the accountant must see.
 */
export function reconcileTotals(lines: ParsedLine[]): TotalsReconciliation {
  const totals = computeControlTotals(lines);
  const rows = findTotalsRows(lines);
  const declaredDebit = rows.length ? Math.max(...rows.map((r) => r.debit)) : null;
  const declaredCredit = rows.length ? Math.max(...rows.map((r) => r.credit)) : null;
  // A sheet may print only one side (a payments-only footer); an absent or zero
  // side is not evidence of a mismatch, so it passes.
  const debitMatches = !declaredDebit || declaredDebit === totals.totalDebit;
  const creditMatches = !declaredCredit || declaredCredit === totals.totalCredit;
  return {
    computedDebit: totals.totalDebit,
    computedCredit: totals.totalCredit,
    declaredDebit,
    declaredCredit,
    debitMatches,
    creditMatches,
    matched: rows.length > 0 && debitMatches && creditMatches,
  };
}

export function validateBatch(lines: ParsedLine[]): BatchValidation {
  const totals = computeControlTotals(lines);
  return {
    ...totals,
    duplicates: findDuplicates(lines),
    discontinuities: checkBalanceContinuity(lines),
    totalsRows: findTotalsRows(lines),
    reconciliation: reconcileTotals(lines),
  };
}
