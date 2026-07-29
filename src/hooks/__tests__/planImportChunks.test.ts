/**
 * Chunk planning is the safety property that keeps an import inside the edge
 * runtime's CPU budget, so it is asserted directly.
 *
 * Regression: a 32,930-row single-sheet workbook was sent as ONE invocation and
 * the worker was killed with "CPU Time exceeded" (HTTP 546) part-way through
 * its 7th month, leaving six months posted and no error body.
 */

import { describe, expect, it } from "vitest";
import {
  planImportChunks,
  MAX_ROWS_PER_CALL,
  MAX_MONTHS_PER_CALL,
  type PlannedPeriod,
} from "../useBankStatementImport";

const p = (month: number, row_count: number, year = 2024): PlannedPeriod =>
  ({ year, month, row_count });

const rowsOf = (chunk: PlannedPeriod[]) =>
  chunk.reduce((n, x) => n + (x.row_count ?? 0), 0);

describe("planImportChunks", () => {
  it("keeps an ordinary workbook as a single invocation", () => {
    // The 2,079-row Peoples Bank file: no reason to pay 12 workbook re-reads.
    const periods = Array.from({ length: 12 }, (_, i) => p(i + 1, 170));
    expect(planImportChunks(periods)).toHaveLength(1);
  });

  it("never lets a chunk exceed the row budget", () => {
    const periods = Array.from({ length: 15 }, (_, i) => p((i % 12) + 1, 2_200));
    for (const chunk of planImportChunks(periods)) {
      // A chunk of one month may exceed the budget (nothing splits a month),
      // but any multi-month chunk must stay within it.
      if (chunk.length > 1) expect(rowsOf(chunk)).toBeLessThanOrEqual(MAX_ROWS_PER_CALL);
    }
  });

  it("splits the 32,930-row file that killed the worker", () => {
    // Real shape: 14 months, one tall sheet.
    const periods = Array.from({ length: 14 }, (_, i) => p((i % 12) + 1, 2_352, 2024 + Math.floor(i / 12)));
    const chunks = planImportChunks(periods);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      if (c.length > 1) expect(rowsOf(c)).toBeLessThanOrEqual(MAX_ROWS_PER_CALL);
    }
  });

  it("loses no period and preserves order", () => {
    const periods = Array.from({ length: 14 }, (_, i) => p((i % 12) + 1, 900, 2024 + Math.floor(i / 12)));
    const flat = planImportChunks(periods).flat();
    expect(flat).toEqual(periods);
  });

  it("isolates a single month that is itself over budget", () => {
    const periods = [p(1, 100), p(2, MAX_ROWS_PER_CALL * 3), p(3, 100)];
    const chunks = planImportChunks(periods);
    const big = chunks.find((c) => c.some((x) => x.month === 2))!;
    expect(big).toHaveLength(1); // never packed alongside another month
  });

  it("caps months per call even when every month is tiny", () => {
    const periods = Array.from({ length: 24 }, (_, i) => p((i % 12) + 1, 1, 2024 + Math.floor(i / 12)));
    for (const chunk of planImportChunks(periods)) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MONTHS_PER_CALL);
    }
  });

  it("treats an unknown row count as a full budget rather than guessing", () => {
    const periods = [{ year: 2024, month: 1 }, { year: 2024, month: 2 }];
    expect(planImportChunks(periods)).toHaveLength(2);
  });

  it("returns nothing for no periods", () => {
    expect(planImportChunks([])).toEqual([]);
  });
});
