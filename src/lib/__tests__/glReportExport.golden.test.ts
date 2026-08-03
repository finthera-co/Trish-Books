import { describe, it, expect } from "vitest";
import { buildGlCsvRows, GL_CSV_HEADERS } from "../glReportExport";
import { buildGeneralLedgerRows } from "../glReportModel";
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

function txn(partial: Partial<GLTransactionRow> & Pick<GLTransactionRow, "line_id" | "account_id">): GLTransactionRow {
  return {
    entry_id: `e-${partial.line_id}`,
    line_seq: 1,
    entry_date: "2025-06-05",
    txn_type: "General Journal",
    num: "JV-001",
    is_adjusting: false,
    entity_name: "",
    memo: "",
    split_text: "",
    debit: 0,
    credit: 0,
    running_balance: 0,
    ...partial,
  };
}

// A small, fixed fixture: one parent with a leaf child and a "- Other" pseudo-child.
// Golden file for the 17-column QuickBooks-parity CSV layout — if this test
// changes, it should be because the layout deliberately changed, not because
// something drifted silently (column order, indent depth, sign convention).
const FIXTURE_TREE: GLAccountNode[] = [
  node({ node_key: "P", account_id: "P", sort_path: "01/P", depth: 1, label: "Bank Accounts", account_code: "1010", has_children: true, own_opening: 5, own_debit: 30, own_credit: 10, own_txn_count: 1, subtree_opening: 55, subtree_debit: 50, subtree_credit: 10 }),
  node({ node_key: "C", account_id: "C", parent_account_id: "P", sort_path: "01/P/C", depth: 2, label: "Savings", account_code: "1012", own_opening: 50, own_debit: 20, own_credit: 0, own_txn_count: 1, subtree_opening: 50, subtree_debit: 20, subtree_credit: 0 }),
  node({ node_key: "P:other", account_id: "P", parent_account_id: "P", sort_path: "01/P/~other", depth: 2, label: "Bank Accounts - Other", is_other_node: true, own_opening: 5, own_debit: 30, own_credit: 10, own_txn_count: 1, subtree_opening: 5, subtree_debit: 30, subtree_credit: 10 }),
];

const FIXTURE_TXNS = new Map<string, GLTransactionRow[]>([
  ["C", [txn({ line_id: "l-c1", account_id: "C", debit: 20, credit: 0, running_balance: 70, txn_type: "Invoice", num: "INV-100", entity_name: "Acme Ltd", memo: "Deposit", split_text: "Cash in Hand" })]],
  ["P", [txn({ line_id: "l-p1", account_id: "P", debit: 30, credit: 10, running_balance: 25, txn_type: "Check", num: "CHK-9", is_adjusting: true, entity_name: "Vendor Co", memo: "-MULTIPLE-", split_text: "-SPLIT-" })]],
]);

const GOLDEN_ROWS: (string | number)[][] = [
  // header:P (depth 1) — label in indent col 1; balance = subtree_opening (55)
  ["", "Bank Accounts", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "55.00"],
  // header:C (depth 2) — label in indent col 2; balance = subtree_opening (50)
  ["", "", "Savings", "", "", "", "", "", "", "", "", "", "", "", "", "", "50.00"],
  // txn:l-c1
  ["", "", "", "", "", "", "Invoice", "05/06/2025", "", "INV-100", "", "Acme Ltd", "Deposit", "Cash in Hand", "20.00", "", "70.00"],
  // total:C — own_debit=20, own_credit=0(blank), balance=own_opening(50)+20-0=70
  ["", "", "Total Savings", "", "", "", "", "", "", "", "", "", "", "", "20.00", "", "70.00"],
  // header:P:other (depth 2) — balance = own_opening (5)
  ["", "", "Bank Accounts - Other", "", "", "", "", "", "", "", "", "", "", "", "", "", "5.00"],
  // txn:l-p1
  ["", "", "", "", "", "", "Check", "05/06/2025", "", "CHK-9", "√", "Vendor Co", "-MULTIPLE-", "-SPLIT-", "30.00", "10.00", "25.00"],
  // total:P:other — own_debit=30, own_credit=10, balance=5+30-10=25
  ["", "", "Total Bank Accounts - Other", "", "", "", "", "", "", "", "", "", "", "", "30.00", "10.00", "25.00"],
  // total:P — subtree_debit=50, subtree_credit=10, balance=subtree_opening(55)+50-10=95
  ["", "Total Bank Accounts", "", "", "", "", "", "", "", "", "", "", "", "", "50.00", "10.00", "95.00"],
  // grand-total — Dr=50/Cr=10 at this single top-level node (deliberately unbalanced fixture; not a real report)
  ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "", "50.00", "10.00", "0.00"],
  [],
  ["GL/2025-06-01/2025-06-30/deadbeef · 9 rows · Dr 50.00 ≠ Cr 10.00"],
];

describe("General Ledger CSV golden file", () => {
  it("has the expected 17-column headers", () => {
    expect(GL_CSV_HEADERS).toEqual(["", "", "", "", "", "", "Type", "Date", "", "Num", "Adj", "Name", "Memo", "Split", "Debit", "Credit", "Balance"]);
  });

  it("matches the golden row-by-row layout for a small fixed fixture", () => {
    const { rows } = buildGeneralLedgerRows(FIXTURE_TREE, FIXTURE_TXNS);
    const csvRows = buildGlCsvRows(rows, {
      fingerprintLine: "GL/2025-06-01/2025-06-30/deadbeef · 9 rows · Dr 50.00 ≠ Cr 10.00",
      warnings: [],
    });
    expect(csvRows).toEqual(GOLDEN_ROWS);
  });

  it("every data row has exactly 17 columns", () => {
    const { rows } = buildGeneralLedgerRows(FIXTURE_TREE, FIXTURE_TXNS);
    const csvRows = buildGlCsvRows(rows, { fingerprintLine: "fp", warnings: [] });
    for (const row of csvRows.slice(0, rows.length)) {
      expect(row).toHaveLength(17);
    }
  });
});
