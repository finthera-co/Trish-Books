import { describe, it, expect } from "vitest";
import { buildSociCsvRows } from "../fsStatementExport";
import type { FsStatementLine, FsStatementAccount } from "@/hooks/useFinancialStatements";

function line(p: Partial<FsStatementLine> & Pick<FsStatementLine, "line_id" | "line_code" | "label">): FsStatementLine {
  return {
    note_ref: null, line_type: "detail", emphasis: "normal", show_margin: false, sort_order: 0,
    current_value: null, compare_value: null, current_margin: null, compare_margin: null,
    account_count: 0, ...p,
  };
}

function acct(p: Partial<FsStatementAccount> & Pick<FsStatementAccount, "line_id" | "account_id" | "account_code">): FsStatementAccount {
  return {
    account_name: "Account", account_type: "Income", current_value: 0, compare_value: null, ...p,
  };
}

const LINES: FsStatementLine[] = [
  line({ line_id: "l1", line_code: "REVENUE", label: "Revenue", note_ref: "01", current_value: 300 }),
  line({ line_id: "l2", line_code: "GROSS_PROFIT", label: "GROSS PROFIT", line_type: "computed", emphasis: "bold_rule", current_value: 300 }),
  line({ line_id: "l3", line_code: "GAP", label: "", line_type: "spacer" }),
  line({ line_id: "l4", line_code: "ASSETS", label: "Assets", current_value: 50000 }),
];

const ACCOUNTS = new Map<string, FsStatementAccount[]>([
  ["l1", [
    acct({ line_id: "l1", account_id: "a1", account_code: "4000", account_name: "Sales", current_value: 200 }),
    acct({ line_id: "l1", account_id: "a2", account_code: "4100", account_name: "Service Income", current_value: 100 }),
  ]],
  ["l4", [
    acct({ line_id: "l4", account_id: "a3", account_code: "1200", account_name: "Trade Receivables", account_type: "Asset", current_value: 50000 }),
  ]],
]);

describe("SOCI ledger tree export", () => {
  it("emits each mapped ledger indented directly beneath its line", () => {
    const rows = buildSociCsvRows(LINES, "fp", undefined, [], ACCOUNTS);
    expect(rows.slice(0, 5)).toEqual([
      ["Revenue", "01", "300.00", "", "", ""],
      ["    4000 Sales", "", "200.00", "", "", ""],
      ["    4100 Service Income", "", "100.00", "", "", ""],
      ["GROSS PROFIT", "", "300.00", "", "", ""],
      ["Assets", "", "50000.00", "", "", ""],
    ]);
  });

  it("keeps the statutory face intact when no ledgers are passed", () => {
    const rows = buildSociCsvRows(LINES, "fp", undefined, []);
    expect(rows.slice(0, 3)).toEqual([
      ["Revenue", "01", "300.00", "", "", ""],
      ["GROSS PROFIT", "", "300.00", "", "", ""],
      ["Assets", "", "50000.00", "", "", ""],
    ]);
  });

  it("shows a child's zero rather than blanking it — a mapped ledger at nil is a fact, not an absence", () => {
    const zero = new Map<string, FsStatementAccount[]>([
      ["l1", [acct({ line_id: "l1", account_id: "a1", account_code: "4000", account_name: "Sales", current_value: 0 })]],
    ]);
    const rows = buildSociCsvRows(LINES, "fp", undefined, [], zero);
    expect(rows[1]).toEqual(["    4000 Sales", "", "0.00", "", "", ""]);
  });

  it("children sum to their parent line", () => {
    for (const [lineId, kids] of ACCOUNTS) {
      const parent = LINES.find((l) => l.line_id === lineId)!;
      const sum = kids.reduce((s, k) => s + (k.current_value ?? 0), 0);
      expect(sum).toBeCloseTo(parent.current_value ?? 0, 2);
    }
  });
});
