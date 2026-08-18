import { describe, it, expect } from "vitest";
import { buildSociFaceGrid } from "../fsStatementWorkbook";
import type { FsExportMeta } from "../fsStatementExport";
import type { FsStatementLine, FsStatementAccount } from "@/hooks/useFinancialStatements";

function line(p: Partial<FsStatementLine> & Pick<FsStatementLine, "line_id" | "line_code" | "label">): FsStatementLine {
  return {
    note_ref: null, line_type: "detail", emphasis: "normal", show_margin: false, sort_order: 0,
    current_value: null, compare_value: null, current_margin: null, compare_margin: null,
    account_count: 0, ...p,
  };
}
function acct(p: Partial<FsStatementAccount> & Pick<FsStatementAccount, "line_id" | "account_id" | "account_code">): FsStatementAccount {
  return { account_name: "Account", account_type: "Income", owner_id: p.account_id, depth: 0, current_value: 0, compare_value: null, ...p };
}

const META: FsExportMeta = {
  tenantId: "t1", userId: "u1", statementCode: "SOCI",
  title: "Statement Of Comprehensive Income",
  dateFrom: "2025-04-01", dateTo: "2026-03-31",
  warnings: [], footerNotes: [],
};

const LINES: FsStatementLine[] = [
  line({ line_id: "l1", line_code: "REVENUE", label: "Revenue", note_ref: "01", current_value: 300 }),
  line({ line_id: "l2", line_code: "GROSS_PROFIT", label: "GROSS PROFIT", line_type: "computed", current_value: 300 }),
  line({ line_id: "l3", line_code: "GAP", label: "", line_type: "spacer" }),
  line({ line_id: "l4", line_code: "ASSETS", label: "Assets", current_value: 0 }),
];

const ACCOUNTS = new Map<string, FsStatementAccount[]>([
  ["l1", [
    acct({ line_id: "l1", account_id: "a1", account_code: "4000", account_name: "Sales", current_value: 200 }),
    acct({ line_id: "l1", account_id: "a2", account_code: "4100", account_name: "Service Income", current_value: 100 }),
  ]],
  ["l4", [acct({ line_id: "l4", account_id: "a3", account_code: "1200", account_name: "Trade Receivables", current_value: 0 })]],
]);

const OFFSET = 8; // pretend the heading block occupies 7 rows

describe("SOCI face sheet outlining", () => {
  it("emits one outline level per grid row, never a misaligned array", () => {
    const { grid, levels } = buildSociFaceGrid(LINES, META, "fp", ACCOUNTS, OFFSET);
    expect(levels).toBeDefined();
    expect(levels!.length).toBe(grid.length);
  });

  it("nests each ledger one level under its line, leaving statement lines at level 0", () => {
    const { grid, levels } = buildSociFaceGrid(LINES, META, "fp", ACCOUNTS, OFFSET);
    const revenueIdx = grid.findIndex((r) => r[0]?.v === "Revenue");
    expect(levels![revenueIdx]).toBe(0);
    expect(grid[revenueIdx + 1][0].v).toBe("    4000  Sales");
    expect(levels![revenueIdx + 1]).toBe(1);
    expect(grid[revenueIdx + 2][0].v).toBe("    4100  Service Income");
    expect(levels![revenueIdx + 2]).toBe(1);
    // the next statement line returns to level 0
    expect(levels![revenueIdx + 3]).toBe(0);
    expect(grid[revenueIdx + 3][0].v).toBe("GROSS PROFIT");
  });

  it("foots each line with a SUM spanning exactly its own ledger rows, in Excel coordinates", () => {
    const { grid } = buildSociFaceGrid(LINES, META, "fp", ACCOUNTS, OFFSET);
    const revenueIdx = grid.findIndex((r) => r[0]?.v === "Revenue");
    const firstKidExcelRow = revenueIdx + 1 + OFFSET;
    expect(grid[revenueIdx][2].f).toBe(`SUM(C${firstKidExcelRow}:C${firstKidExcelRow + 1})`);
    expect(grid[revenueIdx][2].v).toBe(300);
  });

  it("shows a summed line's zero rather than blanking it, since its ledgers are visible", () => {
    const { grid } = buildSociFaceGrid(LINES, META, "fp", ACCOUNTS, OFFSET);
    const assetsIdx = grid.findIndex((r) => r[0]?.v === "Assets");
    expect(grid[assetsIdx][2].v).toBe(0);
    expect(grid[assetsIdx][2].f).toMatch(/^SUM\(C\d+:C\d+\)$/);
  });

  it("writes no outline levels and no formulas when ledgers are not supplied", () => {
    const { grid, levels } = buildSociFaceGrid(LINES, META, "fp");
    expect(levels!.every((l) => l === 0)).toBe(true);
    const revenueIdx = grid.findIndex((r) => r[0]?.v === "Revenue");
    expect(grid[revenueIdx][2].f).toBeUndefined();
    expect(grid[revenueIdx][2].v).toBe(300);
  });
});
