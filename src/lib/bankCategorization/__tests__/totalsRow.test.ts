/**
 * Footer TOTAL / subtotal rows must never post, and what DOES post must foot to
 * the figure the sheet prints at its own bottom.
 *
 * Regression: a live Peoples Bank import posted a Rs 438,219,700.68 subtotal row
 * as an expense. The row carried only a debit, so the pre-existing
 * `both_sides_populated` guard (which did catch the two grand-total rows beside
 * it) never fired. Numbers below are that file's real figures.
 */

import { describe, expect, it } from "vitest";
import { classifyLine, isTotalsRow } from "../resolve";
import { findTotalsRows, reconcileTotals, computeControlTotals, validateBatch } from "../validate";
import { makeCtx, makeLine } from "./helpers";

const REAL_DEBITS = 438238361.69;
const BANK_CHARGES = 18661.01;
const SUBTOTAL = 438219700.68; // == REAL_DEBITS - BANK_CHARGES

describe("totals-row detection", () => {
  it("flags an amount-only row with no identifying field", () => {
    expect(isTotalsRow(makeLine({ rawDate: "", debit: SUBTOTAL }))).toBe(true);
  });

  it("blocks it rather than posting it anywhere", () => {
    const line = makeLine({ rawDate: "", debit: SUBTOTAL });
    expect(classifyLine(line, makeCtx())).toEqual({ kind: "blocked", reason: "totals_row" });
  });

  it("still catches the row when a date was forward-filled onto it", () => {
    // txnDate is inherited from the row above; rawDate stays empty, which is
    // what distinguishes a footer from a real undated transaction.
    const line = makeLine({ rawDate: "", txnDate: "2025-03-25", debit: SUBTOTAL });
    expect(isTotalsRow(line)).toBe(true);
  });

  it.each([
    ["a description", { description: "bill payment" }],
    ["a name", { name: "ACME Ltd" }],
    ["a voucher no", { voucherNo: "CHQ-9912" }],
    ["an account type", { rawAccountType: "Bank Charges" }],
    ["a printed date", { rawDate: "2024-05-10" }],
  ])("does NOT flag a real transaction carrying %s", (_label, fields) => {
    const line = makeLine({ rawDate: "", debit: 5000, ...fields });
    expect(isTotalsRow(line)).toBe(false);
  });

  it("does not flag a zero-amount row (nothing to double-count)", () => {
    expect(isTotalsRow(makeLine({ rawDate: "", debit: 0, credit: 0 }))).toBe(false);
  });
});

describe("control totals exclude footer rows", () => {
  it("does not let a subtotal double the batch's debit", () => {
    const lines = [
      makeLine({ description: "Payment", rawAccountType: "Bank Charges", debit: BANK_CHARGES }),
      makeLine({ description: "Payment", rawAccountType: "Rent", debit: REAL_DEBITS - BANK_CHARGES }),
      makeLine({ rawDate: "", debit: SUBTOTAL }), // the footer
    ];
    expect(computeControlTotals(lines).totalDebit).toBe(REAL_DEBITS);
    expect(computeControlTotals(lines).rowCount).toBe(2);
  });
});

describe("reconciliation against the sheet's printed bottom line", () => {
  const txn = (debit: number) => makeLine({ description: "Payment", rawAccountType: "Rent", debit });

  it("passes when the rows foot to the declared total", () => {
    const lines = [txn(400), txn(600), makeLine({ rawDate: "", debit: 1000 })];
    const r = reconcileTotals(lines);
    expect(r.computedDebit).toBe(1000);
    expect(r.declaredDebit).toBe(1000);
    expect(r.matched).toBe(true);
  });

  it("fails when the file's total double-counts a subtotal", () => {
    // The real file: grand total (876,458,062.37) = real rows + the subtotal.
    const lines = [
      txn(REAL_DEBITS - BANK_CHARGES),
      makeLine({ description: "Charge", rawAccountType: "Bank Charges", debit: BANK_CHARGES }),
      makeLine({ rawDate: "", debit: SUBTOTAL }),
      makeLine({ rawDate: "", debit: REAL_DEBITS + SUBTOTAL }),
    ];
    const r = reconcileTotals(lines);
    expect(r.computedDebit).toBe(REAL_DEBITS);
    expect(r.declaredDebit).toBe(876458062.37);
    expect(r.debitMatches).toBe(false);
    expect(r.matched).toBe(false);
  });

  it("takes the LARGEST footer figure as the declared total", () => {
    const lines = [txn(1000), makeLine({ rawDate: "", debit: 400 }), makeLine({ rawDate: "", debit: 1000 })];
    expect(reconcileTotals(lines).declaredDebit).toBe(1000);
    expect(reconcileTotals(lines).matched).toBe(true);
  });

  it("does not claim a match when the sheet prints no totals row", () => {
    const r = reconcileTotals([txn(1000)]);
    expect(r.declaredDebit).toBeNull();
    expect(r.matched).toBe(false); // nothing to reconcile against
    expect(r.debitMatches).toBe(true); // but not a mismatch either
  });

  it("ignores a side the footer leaves blank", () => {
    // A payments-only footer must not read as "credits should be zero".
    const lines = [
      makeLine({ description: "Receipt", rawAccountType: "Rent", credit: 900 }),
      txn(100),
      makeLine({ rawDate: "", debit: 100 }),
    ];
    const r = reconcileTotals(lines);
    expect(r.declaredCredit).toBe(0);
    expect(r.creditMatches).toBe(true);
    expect(r.matched).toBe(true);
  });

  it("is exposed on validateBatch", () => {
    const v = validateBatch([txn(100), makeLine({ rawDate: "", debit: 100 })]);
    expect(v.totalsRows).toHaveLength(1);
    expect(v.reconciliation.matched).toBe(true);
    expect(findTotalsRows([txn(100)])).toEqual([]);
  });
});
