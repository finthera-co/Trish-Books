import { describe, it, expect, beforeEach, vi } from "vitest";
import * as XLSX from "xlsx";
import { downloadTrialBalanceWorkbook } from "../trialBalanceWorkbook";
import { buildTrialBalanceGroups } from "../trialBalanceModel";
import type { TrialBalanceRow } from "@/hooks/useTrialBalance";
import type { GLReportRow } from "../glReportModel";
import type { GLTransactionRow } from "@/hooks/useGeneralLedger";

const { written } = vi.hoisted(() => ({ written: [] as { wb: XLSX.WorkBook; name: string }[] }));

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: (wb: XLSX.WorkBook, name: string) => { written.push({ wb, name }); } };
});

// The audit-log insert is a fire-and-forget side effect; it must not be a
// prerequisite for producing the workbook.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

beforeEach(() => {
  written.length = 0;
});

function tbRow(partial: Partial<TrialBalanceRow> & Pick<TrialBalanceRow, "account_id" | "group_key">): TrialBalanceRow {
  return {
    group_key: partial.group_key,
    group_label: partial.group_key,
    group_sort: "00/" + partial.account_id,
    account_id: partial.account_id,
    account_code: "1000",
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

// A balanced two-account fixture: openings 500 Dr / 500 Cr, movement
// 1,000 Dr / 1,000 Cr, closings 1,150 Dr / 1,150 Cr.
const TB_ROWS: TrialBalanceRow[] = [
  tbRow({ account_id: "cash", group_key: "Assets", group_label: "Assets", account_code: "1000", account_name: "Cash", audit_opening: 500, period_debit: 1000, period_credit: 350, closing: 1150 }),
  tbRow({ account_id: "sales", group_key: "Income", group_label: "Income", account_code: "4000", account_name: "Sales", account_type: "Income", audit_opening: -500, period_credit: 650, closing: -1150 }),
];

const txn: GLTransactionRow = {
  account_id: "cash", entry_id: "e1", line_id: "l1", line_seq: 1, entry_date: "2026-01-15",
  txn_type: "Invoice", num: "INV-1", is_adjusting: false, entity_name: "Acme",
  memo: "Sale", split_text: "Sales", debit: 1000, credit: 0, running_balance: 1500,
};

const GL_ROWS: GLReportRow[] = [
  { kind: "account-header", depth: 1, key: "header:cash", label: "Cash", accountId: "cash", balance: 500 },
  { kind: "txn", depth: 1, key: "txn:l1", txn },
  { kind: "account-total", depth: 1, key: "total:cash", label: "Total Cash", debit: 1000, credit: 350, balance: 1150 },
  { kind: "account-header", depth: 1, key: "header:sales", label: "Sales", accountId: "sales", balance: -500 },
  { kind: "account-total", depth: 1, key: "total:sales", label: "Total Sales", debit: 0, credit: 650, balance: -1150 },
  { kind: "grand-total", depth: 0, key: "grand", label: "TOTAL", debit: 1000, credit: 1000, balance: 0 },
];

const META = {
  tenantId: "t1", userId: "u1", dateFrom: "2026-01-01", dateTo: "2026-03-31",
  groupBy: "parent" as const, includeZero: false, includeInactive: true, rowCount: 2,
};

function run(glRows: GLReportRow[] = GL_ROWS) {
  const { groups, grand } = buildTrialBalanceGroups(TB_ROWS);
  const ok = downloadTrialBalanceWorkbook({
    company: { company_name: "Acme (Pvt) Ltd" },
    meta: META,
    groups,
    grand,
    glRows,
    glFingerprintLine: "GL/2026-01-01/2026-03-31/abc · 4 rows",
  });
  const { wb, name } = written[written.length - 1];
  const aoa = (sheet: string) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
  /** The link target on a cell, e.g. "#'General Ledger'!A18". */
  const linkAt = (sheet: string, ref: string): string | undefined => wb.Sheets[sheet][ref]?.l?.Target;
  /** 1-based Excel row whose column-B (or A) cell holds `label`. */
  const rowOf = (sheet: string, label: string, col = 1) =>
    aoa(sheet).findIndex((r) => typeof r[col] === "string" && (r[col] as string).trim() === label) + 1;
  return { ok, wb, name, aoa, linkAt, rowOf };
}

describe("downloadTrialBalanceWorkbook", () => {
  it("writes one workbook holding both reports as separate sheets", () => {
    const { ok, wb, name } = run();
    expect(ok).toBe(true);
    expect(written).toHaveLength(1);
    expect(wb.SheetNames).toEqual(["Trial Balance", "General Ledger"]);
    expect(name).toContain("Acme (Pvt) Ltd");
    expect(name.endsWith(".xlsx")).toBe(true);
  });

  it("puts the trial balance's debit/credit pairs on the Trial Balance sheet as real numbers", () => {
    const { aoa } = run();
    const rows = aoa("Trial Balance");
    const total = rows.find((r) => r[1] === "TOTAL")!;
    // No, Ledger Name, Opening Dr/Cr, Transaction Dr/Cr, Closing Dr/Cr —
    // every pair proves out against its opposite number.
    expect(total.slice(2, 8)).toEqual([500, 500, 1000, 1000, 1150, 1150]);
    // Numbers, not pre-formatted strings — the sheet has to be summable.
    expect(typeof total[6]).toBe("number");
  });

  it("carries the ledger detail, including transaction lines, on the General Ledger sheet", () => {
    const { aoa } = run();
    const rows = aoa("General Ledger");
    // The column header sits below the company/report heading block.
    expect(rows.some((r) =>
      JSON.stringify(r) === JSON.stringify(["Account", "Type", "Date", "Num", "Adj", "Name", "Memo", "Split", "Debit", "Credit", "Balance"])
    )).toBe(true);
    const txnRow = rows.find((r) => r[3] === "INV-1")!;
    expect(txnRow[1]).toBe("Invoice");
    expect(txnRow[8]).toBe(1000);
    expect(txnRow[10]).toBe(1500);
    const grand = rows.find((r) => typeof r[0] === "string" && (r[0] as string).trim() === "TOTAL")!;
    expect(grand[8]).toBe(1000);
    expect(grand[9]).toBe(1000);
  });

  it("links the ledger code, name and both closing cells to that account's General Ledger section", () => {
    const { linkAt, rowOf, aoa } = run();
    const cashTbRow = rowOf("Trial Balance", "Cash");
    const cashGlRow = rowOf("General Ledger", "Cash", 0);
    expect(cashTbRow).toBeGreaterThan(0);
    expect(cashGlRow).toBeGreaterThan(0);

    const target = `#'General Ledger'!A${cashGlRow}`;
    // No (A), Ledger Name (B) and the closing figure. Cash carries a debit
    // balance, so column G holds it and H is legitimately empty — an account
    // has a closing debit or a closing credit, never both, and Excel writes no
    // cell at all for a blank one.
    for (const col of ["A", "B", "G"]) {
      expect(linkAt("Trial Balance", `${col}${cashTbRow}`)).toBe(target);
    }
    // Sales is credit-balance: its link sits on H instead.
    const salesTbRow = rowOf("Trial Balance", "Sales");
    const salesGlRow = rowOf("General Ledger", "Sales", 0);
    expect(linkAt("Trial Balance", `H${salesTbRow}`)).toBe(`#'General Ledger'!A${salesGlRow}`);
    // The link lands on the account's own section header, not some other row.
    expect(aoa("General Ledger")[cashGlRow - 1][0]).toBe("Cash");
  });

  it("does not link the amount columns that are neither code, name nor closing", () => {
    const { linkAt, rowOf } = run();
    const cashTbRow = rowOf("Trial Balance", "Cash");
    // Opening Dr/Cr and Transaction Dr/Cr stay plain, matching the screen.
    for (const col of ["C", "D", "E", "F"]) {
      expect(linkAt("Trial Balance", `${col}${cashTbRow}`)).toBeUndefined();
    }
  });

  it("links each General Ledger section back to its Trial Balance row", () => {
    const { linkAt, rowOf } = run();
    const salesTbRow = rowOf("Trial Balance", "Sales");
    const salesGlRow = rowOf("General Ledger", "Sales", 0);
    expect(linkAt("General Ledger", `A${salesGlRow}`)).toBe(`#'Trial Balance'!A${salesTbRow}`);
  });

  it("leaves cells unlinked rather than guessing when an account has no ledger section", () => {
    // A link to the wrong row is worse than no link.
    const glWithoutSales = GL_ROWS.filter((r) => r.accountId !== "sales" && r.key !== "total:sales");
    const { linkAt, rowOf } = run(glWithoutSales);
    const salesTbRow = rowOf("Trial Balance", "Sales");
    expect(linkAt("Trial Balance", `B${salesTbRow}`)).toBeUndefined();
    // The account that does have a section is still linked.
    expect(linkAt("Trial Balance", `B${rowOf("Trial Balance", "Cash")}`)).toBeDefined();
  });

  it("keeps linked closing balances as numbers, not text", () => {
    const { wb, rowOf } = run();
    const cell = wb.Sheets["Trial Balance"][`G${rowOf("Trial Balance", "Cash")}`];
    expect(cell.v).toBe(1150);
    expect(cell.t).toBe("n");
    expect(cell.l?.Target).toBeDefined();
  });

  it("still writes both sheets for a tenant with accounts but no postings", () => {
    // The shape a fresh tenant is actually in: a handful of accounts, an empty
    // ledger. buildGeneralLedgerRows returns nothing but the grand-total row,
    // and the workbook must still be produced rather than throwing.
    const { groups, grand } = buildTrialBalanceGroups([
      tbRow({ account_id: "obe", group_key: "Equity", group_label: "Equity", account_code: "3900", account_name: "Opening Balance Equity" }),
    ]);
    const emptyGl: GLReportRow[] = [
      { kind: "grand-total", depth: 0, key: "grand", label: "TOTAL", debit: 0, credit: 0, balance: 0 },
    ];
    const ok = downloadTrialBalanceWorkbook({
      company: null, meta: { ...META, rowCount: 1 }, groups, grand,
      glRows: emptyGl, glFingerprintLine: "fp",
    });
    expect(ok).toBe(true);
    const { wb } = written[written.length - 1];
    expect(wb.SheetNames).toEqual(["Trial Balance", "General Ledger"]);
  });

  it("writes a workbook even when the ledger has no rows at all", () => {
    const { groups, grand } = buildTrialBalanceGroups(TB_ROWS);
    const ok = downloadTrialBalanceWorkbook({
      company: null, meta: META, groups, grand, glRows: [], glFingerprintLine: "fp",
    });
    expect(ok).toBe(true);
    expect(written[written.length - 1].wb.SheetNames).toHaveLength(2);
  });

  it("keeps a zero closing balance visible rather than blanking the cell", () => {
    const { groups, grand } = buildTrialBalanceGroups([
      tbRow({ account_id: "a", group_key: "Assets", group_label: "Assets" }),
    ]);
    downloadTrialBalanceWorkbook({
      company: null, meta: META, groups, grand,
      glRows: GL_ROWS, glFingerprintLine: "fp",
    });
    const { wb } = written[written.length - 1];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Trial Balance"], { header: 1, raw: true, defval: null });
    const total = rows.find((r) => r[1] === "TOTAL")!;
    expect(total[6]).toBe(0);
    expect(total[7]).toBe(0);
  });
});
