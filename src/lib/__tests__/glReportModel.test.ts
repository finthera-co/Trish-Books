import { describe, it, expect } from "vitest";
import { buildGeneralLedgerRows, fmtAmt, fmtBal, type BuildGLOptions } from "../glReportModel";
import type { GLAccountNode, GLTransactionRow } from "@/hooks/useGeneralLedger";

function node(partial: Partial<GLAccountNode> & Pick<GLAccountNode, "node_key" | "account_id" | "sort_path" | "depth">): GLAccountNode {
  return {
    parent_account_id: null,
    account_code: "0000",
    account_name: partial.node_key,
    account_type: "Asset",
    label: partial.node_key,
    is_other_node: false,
    has_children: false,
    own_opening: 0,
    own_debit: 0,
    own_credit: 0,
    own_txn_count: 0,
    subtree_opening: 0,
    subtree_debit: 0,
    subtree_credit: 0,
    ...partial,
  };
}

function txn(lineId: string, debit: number, credit: number, runningBalance: number): GLTransactionRow {
  return {
    account_id: "A1",
    entry_id: `e-${lineId}`,
    line_id: lineId,
    line_seq: Number(lineId.replace(/\D/g, "")) || 1,
    entry_date: "2025-01-01",
    txn_type: "General Journal",
    num: "JV-001",
    is_adjusting: false,
    entity_name: "",
    memo: "",
    split_text: "",
    debit,
    credit,
    running_balance: runningBalance,
  };
}

// A (parent, has_children) ── A1 (leaf) ── A2 (parent, has_children)
//                                            ├── A21 (leaf)
//                                            └── A2:other
//                             └── A:other
const nodeA = node({ node_key: "A", account_id: "A", sort_path: "01/A", depth: 1, label: "Asset Group", has_children: true, subtree_opening: 55, subtree_debit: 150, subtree_credit: 50 });
const nodeA1 = node({ node_key: "A1", account_id: "A1", parent_account_id: "A", sort_path: "01/A/A1", depth: 2, label: "Cash", own_debit: 100, own_credit: 40, own_txn_count: 2, subtree_debit: 100, subtree_credit: 40 });
const nodeA2 = node({ node_key: "A2", account_id: "A2", parent_account_id: "A", sort_path: "01/A/A2", depth: 2, label: "Bank", has_children: true, own_opening: 5, own_debit: 30, own_credit: 10, own_txn_count: 1, subtree_opening: 55, subtree_debit: 50, subtree_credit: 10 });
const nodeA21 = node({ node_key: "A21", account_id: "A21", parent_account_id: "A2", sort_path: "01/A/A2/A21", depth: 3, label: "Savings", own_opening: 50, own_debit: 20, own_credit: 0, own_txn_count: 1, subtree_opening: 50, subtree_debit: 20, subtree_credit: 0 });
const nodeA2Other = node({ node_key: "A2:other", account_id: "A2", parent_account_id: "A2", sort_path: "01/A/A2/~other", depth: 3, label: "Bank - Other", is_other_node: true, own_opening: 5, own_debit: 30, own_credit: 10, own_txn_count: 1, subtree_opening: 5, subtree_debit: 30, subtree_credit: 10 });
const nodeAOther = node({ node_key: "A:other", account_id: "A", parent_account_id: "A", sort_path: "01/A/~other", depth: 2, label: "Asset Group - Other", is_other_node: true });

const FULL_TREE = [nodeA, nodeA1, nodeA2, nodeA21, nodeA2Other, nodeAOther];

function fullTxnsByAccount() {
  return new Map<string, GLTransactionRow[]>([
    ["A1", [{ ...txn("l1", 60, 0, 60), account_id: "A1" }, { ...txn("l2", 40, 40, 60), account_id: "A1" }]],
    ["A21", [{ ...txn("l3", 20, 0, 70), account_id: "A21" }]],
    ["A2", [{ ...txn("l4", 30, 10, 25), account_id: "A2" }]],
    ["A", []],
  ]);
}

describe("buildGeneralLedgerRows", () => {
  it("sequences leaves, nested parents, and '- Other' pseudo-children in sort_path order", () => {
    const { rows } = buildGeneralLedgerRows(FULL_TREE, fullTxnsByAccount());
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual([
      "header:A",
      "header:A1", "txn:l1", "txn:l2", "total:A1",
      "header:A2",
      "header:A21", "txn:l3", "total:A21",
      "header:A2:other", "txn:l4", "total:A2:other",
      "total:A2",
      "header:A:other", "total:A:other",
      "total:A",
      "grand",
    ]);
  });

  it("closes a parent's total only after its last descendant, using subtree_* not own_*", () => {
    const { rows } = buildGeneralLedgerRows(FULL_TREE, fullTxnsByAccount());
    const totalA2Index = rows.findIndex((r) => r.key === "total:A2");
    const totalA2OtherIndex = rows.findIndex((r) => r.key === "total:A2:other");
    expect(totalA2Index).toBeGreaterThan(totalA2OtherIndex);
    const totalA2 = rows[totalA2Index];
    expect(totalA2.debit).toBe(50);
    expect(totalA2.credit).toBe(10);
    expect(totalA2.balance).toBe(95); // subtree_opening(55) + subtree_debit(50) - subtree_credit(10)

    const totalA = rows.find((r) => r.key === "total:A")!;
    expect(totalA.debit).toBe(150);
    expect(totalA.credit).toBe(50);
    expect(totalA.balance).toBe(155); // subtree_opening(55) + 150 - 50
  });

  it("gives a leaf/'- Other' total its own_* figures, not subtree_*", () => {
    const { rows } = buildGeneralLedgerRows(FULL_TREE, fullTxnsByAccount());
    const totalA1 = rows.find((r) => r.key === "total:A1")!;
    expect(totalA1).toMatchObject({ debit: 100, credit: 40, balance: 60 });
    const totalA2Other = rows.find((r) => r.key === "total:A2:other")!;
    expect(totalA2Other).toMatchObject({ debit: 30, credit: 10, balance: 25 });
  });

  it("collapsing a parent hides its descendants but keeps its (subtree) total", () => {
    const options: BuildGLOptions = { collapsed: new Set(["A2"]) };
    const { rows } = buildGeneralLedgerRows(FULL_TREE, fullTxnsByAccount(), options);
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual([
      "header:A",
      "header:A1", "txn:l1", "txn:l2", "total:A1",
      "header:A2", "total:A2",
      "header:A:other", "total:A:other",
      "total:A",
      "grand",
    ]);
    const totalA2 = rows.find((r) => r.key === "total:A2")!;
    expect(totalA2).toMatchObject({ debit: 50, credit: 10, balance: 95 }); // subtree, not own
  });

  it("emits one isLoadingTxns row for an account not yet present in txnsByAccount", () => {
    const txnsByAccount = new Map<string, GLTransactionRow[]>([["A21", []], ["A2", []], ["A", []]]);
    // A1 deliberately absent (still loading)
    const { rows } = buildGeneralLedgerRows(FULL_TREE, txnsByAccount);
    const a1Rows = rows.filter((r) => r.nodeKey === "A1" && r.kind === "txn");
    expect(a1Rows).toHaveLength(1);
    expect(a1Rows[0].isLoadingTxns).toBe(true);
  });

  it("prunes zero-activity nodes bottom-up when includeZeroActivity is false", () => {
    const zeroLeaf = node({ node_key: "Z1", account_id: "Z1", parent_account_id: "A", sort_path: "01/A/Z1", depth: 2, label: "Dormant" });
    const withDormant = [nodeA, nodeA1, zeroLeaf, nodeA2, nodeA21, nodeA2Other, nodeAOther].sort((a, b) =>
      a.sort_path < b.sort_path ? -1 : a.sort_path > b.sort_path ? 1 : 0
    );

    const { rows: withZero } = buildGeneralLedgerRows(withDormant, fullTxnsByAccount(), { includeZeroActivity: true });
    expect(withZero.some((r) => r.nodeKey === "Z1")).toBe(true);

    const { rows: pruned } = buildGeneralLedgerRows(withDormant, fullTxnsByAccount(), { includeZeroActivity: false });
    expect(pruned.some((r) => r.nodeKey === "Z1")).toBe(false);
    // The active subtree survives untouched.
    expect(pruned.some((r) => r.key === "total:A2")).toBe(true);
  });

  it("prunes an entirely dormant subtree along with its parent", () => {
    const dormantParent = node({ node_key: "D", account_id: "D", sort_path: "02/D", depth: 1, label: "Dormant Group", has_children: true });
    const dormantChild = node({ node_key: "D1", account_id: "D1", parent_account_id: "D", sort_path: "02/D/D1", depth: 2, label: "Dormant Child" });
    const tree = [...FULL_TREE, dormantParent, dormantChild];

    const { rows } = buildGeneralLedgerRows(tree, fullTxnsByAccount(), { includeZeroActivity: false });
    expect(rows.some((r) => r.nodeKey === "D" || r.nodeKey === "D1")).toBe(false);
  });

  it("produces stable, deterministic keys across repeated builds", () => {
    const run1 = buildGeneralLedgerRows(FULL_TREE, fullTxnsByAccount()).rows.map((r) => r.key);
    const run2 = buildGeneralLedgerRows(FULL_TREE, fullTxnsByAccount()).rows.map((r) => r.key);
    expect(run1).toEqual(run2);
  });

  it("propagates a nonzero imbalance rather than rounding it away", () => {
    const unbalanced = node({ node_key: "U", account_id: "U", sort_path: "03/U", depth: 1, label: "Unbalanced", subtree_debit: 100.004, subtree_credit: 100 });
    const { imbalance, grandDebit, grandCredit } = buildGeneralLedgerRows([unbalanced], new Map());
    expect(grandDebit).toBe(100.004);
    expect(grandCredit).toBe(100);
    expect(imbalance).toBeCloseTo(0.004, 10);
    expect(imbalance).not.toBe(0);
  });
});

describe("fmtAmt / fmtBal", () => {
  it("renders zero as an empty cell, not 0.00", () => {
    expect(fmtAmt(0)).toBe("");
    expect(fmtAmt(null)).toBe("");
    expect(fmtAmt(undefined)).toBe("");
  });

  it("formats a positive amount with en-US grouping and 2dp", () => {
    expect(fmtAmt(1234.5)).toBe("1,234.50");
  });

  it("wraps negative balances in parentheses", () => {
    expect(fmtBal(-1234.5)).toBe("(1,234.50)");
    expect(fmtBal(1234.5)).toBe("1,234.50");
    expect(fmtBal(0)).toBe("0.00");
  });
});
