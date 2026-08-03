import { describe, it, expect } from "vitest";
import { buildTrialBalanceGroups, filterVarianceRows, computeVarianceStats } from "../trialBalanceModel";
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
    expect(groups[0].closing).toBe(130); // 150 + -20
    expect(groups[0].period_debit).toBe(50);
    expect(groups[0].period_credit).toBe(20);
    expect(groups[1].closing).toBe(10);
  });

  it("sums the grand total across every group, not just the first", () => {
    const rows: TrialBalanceRow[] = [
      row({ account_id: "a1", group_key: "g1", closing: 100, ledger_opening: 10, audit_opening: 10, period_debit: 90, period_credit: 0 }),
      row({ account_id: "b1", group_key: "g2", closing: -100, ledger_opening: 0, audit_opening: 0, period_debit: 0, period_credit: 100 }),
    ];
    const { grand } = buildTrialBalanceGroups(rows);
    expect(grand.closing).toBe(0); // balanced ledger ties to zero
    expect(grand.ledger_opening).toBe(10);
    expect(grand.period_debit).toBe(90);
    expect(grand.period_credit).toBe(100);
  });

  it("returns no groups for an empty row set", () => {
    const { groups, grand } = buildTrialBalanceGroups([]);
    expect(groups).toEqual([]);
    expect(grand).toEqual({ ledger_opening: 0, audit_opening: 0, period_debit: 0, period_credit: 0, closing: 0 });
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
