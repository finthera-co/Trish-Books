import { describe, it, expect } from "vitest";
import { computeControlTotals, checkBalanceContinuity, findDuplicates, validateBatch } from "../validate";
import { makeLine } from "./helpers";

describe("computeControlTotals", () => {
  it("sums debits and credits, excludes B/F rows", () => {
    const lines = [
      makeLine({ debit: 100 }),
      makeLine({ credit: 250 }),
      makeLine({ debit: 50, isExcluded: true }), // B/F excluded
    ];
    const t = computeControlTotals(lines);
    expect(t.totalDebit).toBe(100);
    expect(t.totalCredit).toBe(250);
    expect(t.rowCount).toBe(2);
    expect(t.excludedCount).toBe(1);
  });

  it("ignores non-finite amounts in totals", () => {
    const lines = [makeLine({ debit: NaN }), makeLine({ debit: 100 })];
    expect(computeControlTotals(lines).totalDebit).toBe(100);
  });
});

describe("findDuplicates", () => {
  it("flags same (date, desc, debit, credit) tuples — does not reject", () => {
    const lines = [
      makeLine({ txnDate: "2024-05-10", description: "Salary", debit: 5000 }),
      makeLine({ txnDate: "2024-05-10", description: "Salary", debit: 5000 }),
      makeLine({ txnDate: "2024-05-10", description: "Rent", debit: 3000 }),
    ];
    const dups = findDuplicates(lines);
    expect(dups).toHaveLength(1);
    expect(dups[0].rowRefs).toHaveLength(2);
  });

  it("excludes B/F rows from duplicate detection", () => {
    const lines = [
      makeLine({ txnDate: "2024-05-01", description: "b/f", balance: 100, isExcluded: true }),
      makeLine({ txnDate: "2024-05-01", description: "b/f", balance: 100, isExcluded: true }),
    ];
    expect(findDuplicates(lines)).toHaveLength(0);
  });
});

describe("checkBalanceContinuity", () => {
  it("flags a discontinuity where balance != prev + credit - debit", () => {
    const lines = [
      makeLine({ rowIndex: 2, balance: 1000 }),
      makeLine({ rowIndex: 3, debit: 200, balance: 800 }), // ok: 1000-200
      makeLine({ rowIndex: 4, debit: 100, balance: 500 }), // bad: expected 700
    ];
    const gaps = checkBalanceContinuity(lines);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].rowIndex).toBe(4);
    expect(gaps[0].expected).toBe(700);
    expect(gaps[0].actual).toBe(500);
  });

  it("is clean for a consistent running balance", () => {
    const lines = [
      makeLine({ rowIndex: 2, balance: 1000 }),
      makeLine({ rowIndex: 3, credit: 500, balance: 1500 }),
      makeLine({ rowIndex: 4, debit: 300, balance: 1200 }),
    ];
    expect(checkBalanceContinuity(lines)).toHaveLength(0);
  });
});

describe("validateBatch", () => {
  it("returns totals, duplicates, and discontinuities together", () => {
    const lines = [
      makeLine({ rowIndex: 2, txnDate: "2024-05-10", description: "Salary", debit: 5000, balance: 5000 }),
      makeLine({ rowIndex: 3, txnDate: "2024-05-10", description: "Salary", debit: 5000, balance: 0 }),
    ];
    const b = validateBatch(lines);
    expect(b.totalDebit).toBe(10000);
    expect(b.rowCount).toBe(2);
    expect(b.duplicates).toHaveLength(1);
  });
});
