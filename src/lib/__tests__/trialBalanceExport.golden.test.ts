import { describe, it, expect } from "vitest";
import { buildTrialBalanceCsvRows, TRIAL_BALANCE_CSV_HEADERS } from "../trialBalanceExport";
import { buildTrialBalanceGroups } from "../trialBalanceModel";
import type { TrialBalanceRow } from "@/hooks/useTrialBalance";

function row(partial: Partial<TrialBalanceRow> & Pick<TrialBalanceRow, "account_id" | "group_key" | "group_label">): TrialBalanceRow {
  return {
    group_key: partial.group_key,
    group_label: partial.group_label,
    group_sort: "00/" + partial.account_id,
    account_id: partial.account_id,
    account_code: "0000",
    account_name: partial.account_id,
    account_type: "Asset",
    ledger_opening: 0,
    audit_opening: 0,
    opening_variance: 0,
    period_debit: 0,
    period_credit: 0,
    closing: 0,
    has_audit_row: false,
    ...partial,
  };
}

// Small fixed fixture: two groups, one account with an audit-opening override
// (ledger 100, audit 500 — a +400 variance, like the reference workbook's
// Trade Receivables row) and a credit-normal account (negative closing).
const FIXTURE_ROWS: TrialBalanceRow[] = [
  row({
    account_id: "cash", group_key: "assets", group_label: "Assets", account_code: "1000", account_name: "Cash",
    ledger_opening: 100, audit_opening: 500, opening_variance: 400, has_audit_row: true,
    period_debit: 1000, period_credit: 350, closing: 1150,
  }),
  row({
    account_id: "no-hist", group_key: "assets", group_label: "Assets", account_code: "1900", account_name: "No History Asset",
    ledger_opening: 0, audit_opening: -400, opening_variance: -400, has_audit_row: true,
    period_debit: 0, period_credit: 0, closing: -400,
  }),
  row({
    account_id: "sales", group_key: "income", group_label: "Income", account_code: "4000", account_name: "Sales Revenue",
    account_type: "Income", ledger_opening: 0, audit_opening: 0,
    period_debit: 0, period_credit: 750, closing: -750,
  }),
];

describe("Trial Balance CSV golden file", () => {
  const FP_LINE = "TB/2025-04-01/2026-03-31/deadbeef · 3 rows · Closing Dr 1,150.00 = Cr 1,150.00";

  it("has the expected 8-column headers", () => {
    expect(TRIAL_BALANCE_CSV_HEADERS).toEqual([
      "No", "Ledger Name",
      "Opening Debit", "Opening Credit",
      "Transaction Debit", "Transaction Credit",
      "Closing Debit", "Closing Credit",
    ]);
  });

  it("matches the golden row-by-row layout for a small fixed fixture", () => {
    const { groups, grand } = buildTrialBalanceGroups(FIXTURE_ROWS);
    const rows = buildTrialBalanceCsvRows(groups, grand, FP_LINE);

    expect(rows).toEqual([
      // group header: Assets
      ["", "Assets", "", "", "", "", "", ""],
      // cash: opening is the 500 audit override (the figure closing ties to),
      // not the 100 ledger opening; debit 1000, credit 350, closing 1150 Dr
      ["1000", "Cash", "500.00", "", "1000.00", "350.00", "1150.00", ""],
      // no-hist: -400 opening and closing both land in the credit column
      ["1900", "No History Asset", "", "400.00", "", "", "", "400.00"],
      // group subtotal: split per account THEN summed, so the 500 Dr and 400 Cr
      // both stay visible instead of netting into a single 100
      ["", "Total Assets", "500.00", "400.00", "1000.00", "350.00", "1150.00", "400.00"],
      [],
      // group header: Income
      ["", "Income", "", "", "", "", "", ""],
      // sales: credit-normal, closing lands in the credit column (raw Dr-Cr,
      // never signed by normal balance)
      ["4000", "Sales Revenue", "", "", "", "750.00", "", "750.00"],
      // group subtotal: Income
      ["", "Total Income", "", "", "", "750.00", "", "750.00"],
      [],
      // grand total: the closing pair proves out at 1,150.00 each side
      ["", "TOTAL", "500.00", "400.00", "1000.00", "1100.00", "1150.00", "1150.00"],
      [],
      [FP_LINE],
    ]);
  });

  it("every detail/subtotal/total row has exactly 8 columns (footer/blank rows excluded)", () => {
    const { groups, grand } = buildTrialBalanceGroups(FIXTURE_ROWS);
    const rows = buildTrialBalanceCsvRows(groups, grand, "fp");
    const dataRows = rows.filter((r) => r.length > 1);
    expect(dataRows.length).toBeGreaterThan(0);
    for (const row of dataRows) {
      expect(row).toHaveLength(8);
    }
  });
});
