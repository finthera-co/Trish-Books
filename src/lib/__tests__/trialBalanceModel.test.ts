import { describe, it, expect } from "vitest";
import {
  buildTrialBalanceGroups, filterVarianceRows, computeVarianceStats,
  splitBalance, openingSplit, closingSplit, isBalanced, closingDifference, openingBasis,
} from "../trialBalanceModel";
import type { TrialBalanceRow } from "@/hooks/useTrialBalance";

function row(partial: Partial<TrialBalanceRow> & Pick<TrialBalanceRow, "account_id" | "group_key">): TrialBalanceRow {
  return {
    group_key: partial.group_key,
    group_label: partial.group_key,
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

describe("splitBalance", () => {
  it("routes a positive balance to debit and a negative one to credit", () => {
    expect(splitBalance(150)).toEqual({ debit: 150, credit: 0 });
    expect(splitBalance(-150)).toEqual({ debit: 0, credit: 150 });
  });

  it("treats sub-cent noise as neither, so it never prints a 0.00 debit", () => {
    expect(splitBalance(0)).toEqual({ debit: 0, credit: 0 });
    expect(splitBalance(0.004)).toEqual({ debit: 0, credit: 0 });
    expect(splitBalance(-0.004)).toEqual({ debit: 0, credit: 0 });
  });
});

describe("openingSplit / closingSplit", () => {
  it("splits the opening on the audit opening, the figure the closing balance ties to", () => {
    const r = row({ account_id: "a", group_key: "g", ledger_opening: 100, audit_opening: 500, closing: 1150 });
    expect(openingSplit(r)).toEqual({ debit: 500, credit: 0 });
    expect(closingSplit(r)).toEqual({ debit: 1150, credit: 0 });
  });

  it("falls back to the ledger carry-forward when no opening balance was recorded", () => {
    // rpc_trial_balance already coalesces audit_opening to the ledger opening,
    // so an account with no opening_balances row still shows a real opening.
    const r = row({ account_id: "a", group_key: "g", ledger_opening: -320, audit_opening: -320, closing: -320 });
    expect(openingSplit(r)).toEqual({ debit: 0, credit: 320 });
  });
});

describe("buildTrialBalanceGroups", () => {
  it("groups detail rows and sums group subtotals in first-appearance order", () => {
    const rows: TrialBalanceRow[] = [
      row({ account_id: "a1", group_key: "g1", group_label: "Group One", ledger_opening: 100, audit_opening: 100, period_debit: 50, period_credit: 0, closing: 150 }),
      row({ account_id: "a2", group_key: "g1", group_label: "Group One", ledger_opening: 0, audit_opening: 0, period_debit: 0, period_credit: 20, closing: -20 }),
      row({ account_id: "b1", group_key: "g2", group_label: "Group Two", ledger_opening: 0, audit_opening: 0, period_debit: 10, period_credit: 0, closing: 10 }),
    ];

    const { groups, grand } = buildTrialBalanceGroups(rows);

    expect(groups.map((g) => g.key)).toEqual(["g1", "g2"]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].opening_debit).toBe(100);
    expect(groups[0].opening_credit).toBe(0);
    expect(groups[0].period_debit).toBe(50);
    expect(groups[0].period_credit).toBe(20);
    // 150 Dr and 20 Cr — NOT a single netted 130.
    expect(groups[0].closing_debit).toBe(150);
    expect(groups[0].closing_credit).toBe(20);
    expect(groups[1].closing_debit).toBe(10);
    expect(grand.closing_debit).toBe(160);
    expect(grand.closing_credit).toBe(20);
  });

  it("splits each account before summing, so opposing balances are not netted away", () => {
    // Netting first would give closing 0 and print two empty cells; splitting
    // first shows the 500 Dr and 500 Cr that actually exist.
    const rows: TrialBalanceRow[] = [
      row({ account_id: "a1", group_key: "g1", audit_opening: 500, closing: 500 }),
      row({ account_id: "a2", group_key: "g1", audit_opening: -500, closing: -500 }),
    ];
    const { grand } = buildTrialBalanceGroups(rows);
    expect(grand.closing_debit).toBe(500);
    expect(grand.closing_credit).toBe(500);
    expect(grand.opening_debit).toBe(500);
    expect(grand.opening_credit).toBe(500);
    expect(closingDifference(grand)).toBe(0);
    expect(isBalanced(grand)).toBe(true);
  });

  it("sums the grand total across every group, not just the first", () => {
    const rows: TrialBalanceRow[] = [
      row({ account_id: "a1", group_key: "g1", closing: 100, ledger_opening: 10, audit_opening: 10, period_debit: 90, period_credit: 0 }),
      row({ account_id: "b1", group_key: "g2", closing: -100, ledger_opening: 0, audit_opening: 0, period_debit: 0, period_credit: 100 }),
    ];
    const { grand } = buildTrialBalanceGroups(rows);
    expect(grand.closing_debit).toBe(100);
    expect(grand.closing_credit).toBe(100);
    expect(closingDifference(grand)).toBe(0); // balanced ledger ties off
    expect(grand.ledger_opening).toBe(10);
    expect(grand.period_debit).toBe(90);
    expect(grand.period_credit).toBe(100);
  });

  it("reports a real imbalance rather than a zero that hides it", () => {
    const rows: TrialBalanceRow[] = [
      row({ account_id: "a1", group_key: "g1", closing: 100, period_debit: 100 }),
      row({ account_id: "b1", group_key: "g2", closing: -75, period_credit: 75 }),
    ];
    const { grand } = buildTrialBalanceGroups(rows);
    expect(closingDifference(grand)).toBe(25);
    expect(isBalanced(grand)).toBe(false);
  });

  it("returns no groups for an empty row set", () => {
    const { groups, grand } = buildTrialBalanceGroups([]);
    expect(groups).toEqual([]);
    expect(grand).toEqual({
      opening_debit: 0, opening_credit: 0,
      period_debit: 0, period_credit: 0,
      closing_debit: 0, closing_credit: 0,
      ledger_opening: 0, audit_opening: 0,
    });
  });
});

describe("openingBasis", () => {
  it("reports audited openings when any account carries a stored opening balance", () => {
    expect(openingBasis([row({ account_id: "a", group_key: "g", has_audit_row: true })])).toBe("audited");
  });

  it("reports a ledger carry-forward when openings come only from prior postings", () => {
    expect(openingBasis([row({ account_id: "a", group_key: "g", ledger_opening: 250, audit_opening: 250 })]))
      .toBe("ledger-carry-forward");
  });

  it("reports none when the period starts before any posting at all", () => {
    expect(openingBasis([row({ account_id: "a", group_key: "g", period_debit: 40, closing: 40 })])).toBe("none");
    expect(openingBasis([])).toBe("none");
  });
});

describe("filterVarianceRows / computeVarianceStats", () => {
  const rows: TrialBalanceRow[] = [
    row({ account_id: "a1", group_key: "g1", has_audit_row: true, opening_variance: 400 }),
    row({ account_id: "a2", group_key: "g1", has_audit_row: true, opening_variance: 0.001 }), // below threshold
    row({ account_id: "a3", group_key: "g1", has_audit_row: false, opening_variance: 999 }), // no audit row -> excluded regardless of variance
    row({ account_id: "a4", group_key: "g1", has_audit_row: true, opening_variance: -100 }),
  ];

  it("only includes rows with has_audit_row and a variance above the 0.005 threshold", () => {
    const filtered = filterVarianceRows(rows);
    expect(filtered.map((r) => r.account_id)).toEqual(["a1", "a4"]);
  });

  it("computes count and net variance", () => {
    const stats = computeVarianceStats(rows);
    expect(stats.count).toBe(2);
    expect(stats.net).toBe(300); // 400 + -100
  });
});
