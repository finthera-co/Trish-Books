/**
 * Batch-level validation: control totals, running-balance continuity,
 * duplicate detection. Line-level gates live in resolve.ts (Blocked/Suspense).
 *
 * All of this re-runs server-side; client results are advisory only.
 */

import { normalizeText } from "./normalize.ts";
import type {
  BalanceDiscontinuity,
  BatchDuplicate,
  BatchValidation,
  ParsedLine,
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

export function validateBatch(lines: ParsedLine[]): BatchValidation {
  const totals = computeControlTotals(lines);
  return {
    ...totals,
    duplicates: findDuplicates(lines),
    discontinuities: checkBalanceContinuity(lines),
  };
}
