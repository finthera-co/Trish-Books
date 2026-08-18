import { describe, it, expect, beforeEach, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  downloadSociWorkbook, SOCI_FACE_SHEET, SOCI_NOTES_SHEET, SOCI_AUDIT_SHEET,
} from "../fsStatementWorkbook";
import type { FsExportMeta } from "../fsStatementExport";
import type { FsStatementLine, FsStatementAccount } from "@/hooks/useFinancialStatements";

const { written } = vi.hoisted(() => ({ written: [] as { wb: XLSX.WorkBook; name: string }[] }));

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: (wb: XLSX.WorkBook, name: string) => { written.push({ wb, name }); } };
});

// The audit-log insert is fire-and-forget; producing the workbook must not
// depend on it.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

beforeEach(() => {
  written.length = 0;
});

function line(partial: Partial<FsStatementLine> & Pick<FsStatementLine, "line_id" | "line_code" | "label">): FsStatementLine {
  return {
    note_ref: null,
    line_type: "detail",
    emphasis: "normal",
    show_margin: false,
    sort_order: 0,
    current_value: null,
    compare_value: null,
    current_margin: null,
    compare_margin: null,
    account_count: 0,
    ...partial,
  };
}

const LINES: FsStatementLine[] = [
  line({ line_id: "l1", line_code: "REVENUE", label: "Revenue", note_ref: "01", current_value: 2150487725.11, compare_value: 1811248196.68 }),
  line({ line_id: "l2", line_code: "COS", label: "Cost of Sales", note_ref: "02", current_value: -1629561652.68, compare_value: -1392469295.43 }),
  line({ line_id: "l3", line_code: "GROSS_PROFIT", label: "GROSS PROFIT", line_type: "computed", emphasis: "bold_rule", show_margin: true, current_value: 520926072.43, compare_value: 418778901.25, current_margin: 24.22, compare_margin: 23.12 }),
  line({ line_id: "l4", line_code: "SPACER1", label: "", line_type: "spacer" }),
  line({ line_id: "l5", line_code: "UNMAPPED_EXP", label: "Unmapped Expense Line", current_value: 0, compare_value: 0 }),
  line({ line_id: "l6", line_code: "EPS", label: "Basic Earnings / (Loss) Per Ordinary Share", note_ref: "08", line_type: "per_share", current_value: 793.58, compare_value: -12.5 }),
];

const account = (partial: Partial<FsStatementAccount> & Pick<FsStatementAccount, "line_id" | "account_id">): FsStatementAccount => ({
  account_code: "4000",
  account_name: "Sales",
  account_type: "Income",
  owner_id: partial.account_id,
  depth: 0,
  current_value: 0,
  compare_value: 0,
  ...partial,
});

const ACCOUNTS = new Map<string, FsStatementAccount[]>([
  ["l1", [
    account({ line_id: "l1", account_id: "a1", account_code: "4000", account_name: "Sales — Local", current_value: 1500487725.11, compare_value: 1311248196.68 }),
    account({ line_id: "l1", account_id: "a2", account_code: "4010", account_name: "Sales — Export", current_value: 650000000.00, compare_value: 500000000.00 }),
  ]],
]);

const META: FsExportMeta = {
  tenantId: "t1",
  userId: "u1",
  statementCode: "SOCI",
  title: "STATEMENT OF COMPREHENSIVE INCOME",
  periodCaption: "For the Year Ended 31st March",
  dateFrom: "2025-04-01",
  dateTo: "2026-03-31",
  cmpDateFrom: "2024-04-01",
  cmpDateTo: "2025-03-31",
  currencyCaption: "Rs.         Cts.",
  company: { companyName: "Acme (Pvt) Ltd", address: "1 Galle Road\nColombo 03", phone: "0112 000 000", taxId: "123456789", registrationNumber: "PV 12345" },
  preparedBy: "Treshane Ranasinghe",
  warnings: ["[ERROR] UNMAPPED_ACCOUNT: Account has period movement but is not mapped to any line of this statement"],
  ackNote: "Exported with 1 unresolved coverage error(s), acknowledged by Treshane",
  footerNotes: ["Figures In Brackets Indicate Deductions."],
};

/** All cell values on a sheet, as a plain grid of raw values. */
function rowsOf(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: null });
}

function findRow(ws: XLSX.WorkSheet, firstCell: string): number {
  const rows = rowsOf(ws);
  const i = rows.findIndex((r) => r[0] === firstCell);
  if (i < 0) throw new Error(`no row starting "${firstCell}"`);
  return i;
}

describe("SOCI workbook", () => {
  it("writes the face, the notes and the basis/audit tab, named after the entity and period", () => {
    expect(downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS })).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe("Acme (Pvt) Ltd — Statement of Comprehensive Income 2025-04-01 to 2026-03-31.xlsx");
    expect(written[0].wb.SheetNames).toEqual([SOCI_FACE_SHEET, SOCI_NOTES_SHEET, SOCI_AUDIT_SHEET]);
  });

  it("identifies the entity, the statement and the basis of preparation above the face", () => {
    downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS });
    const heading = rowsOf(written[0].wb.Sheets[SOCI_FACE_SHEET]).slice(0, 12).map((r) => r[0]);

    expect(heading).toContain("Acme (Pvt) Ltd");
    expect(heading).toContain("1 Galle Road");
    expect(heading).toContain("STATEMENT OF COMPREHENSIVE INCOME");
    expect(heading).toContain("Profit or Loss and Other Comprehensive Income");
    expect(heading).toContain("For the Year Ended 31st March 2026");
    expect(heading).toContain("Accrual basis  ·  All amounts in LKR  ·  Figures in brackets indicate deductions");
    expect(heading.some((h) => typeof h === "string" && h.startsWith("Generated") && h.includes("Treshane Ranasinghe"))).toBe(true);
  });

  it("carries amounts as numbers in the accounting format, not display text", () => {
    downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS });
    const ws = written[0].wb.Sheets[SOCI_FACE_SHEET];
    const r = findRow(ws, "Cost of Sales");
    const cell = ws[XLSX.utils.encode_cell({ r, c: 2 })];

    expect(cell.v).toBe(-1629561652.68);
    expect(cell.t).toBe("n");
    // Negatives render in brackets rather than with a minus sign.
    expect(cell.z).toBe("#,##0.00;(#,##0.00)");
  });

  it("presents the comparative period alongside the current one", () => {
    downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS });
    const ws = written[0].wb.Sheets[SOCI_FACE_SHEET];
    const rows = rowsOf(ws);
    const header = rows.find((r) => r[1] === "Note");

    expect(header?.slice(1)).toEqual(["Note", "2026", "2025", "% 2026", "% 2025"]);
    const r = findRow(ws, "Revenue");
    expect(ws[XLSX.utils.encode_cell({ r, c: 3 })].v).toBe(1811248196.68);
  });

  it("drops the comparative and margin columns when no comparative is presented", () => {
    const { cmpDateFrom, cmpDateTo, ...rest } = META;
    downloadSociWorkbook({ lines: LINES, meta: rest, accounts: ACCOUNTS });
    const ws = written[0].wb.Sheets[SOCI_FACE_SHEET];
    const header = rowsOf(ws).find((r) => r[1] === "Note");

    expect(header?.slice(1)).toEqual(["Note", "2026", "%"]);
  });

  it("writes margins as real percentages and EPS without thousands separators", () => {
    downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS });
    const ws = written[0].wb.Sheets[SOCI_FACE_SHEET];

    const gp = findRow(ws, "GROSS PROFIT");
    const margin = ws[XLSX.utils.encode_cell({ r: gp, c: 4 })];
    expect(margin.v).toBeCloseTo(0.2422, 6);
    expect(margin.z).toBe("0.00%");

    const eps = findRow(ws, "Basic Earnings / (Loss) Per Ordinary Share");
    expect(ws[XLSX.utils.encode_cell({ r: eps, c: 2 })]).toMatchObject({ v: 793.58, z: "0.00;(0.00)" });
  });

  it("blanks a zero detail line but keeps a zero subtotal", () => {
    const withZeroSubtotal = LINES.map((l) =>
      l.line_code === "GROSS_PROFIT" ? { ...l, current_value: 0 } : l
    );
    downloadSociWorkbook({ lines: withZeroSubtotal, meta: META, accounts: ACCOUNTS });
    const ws = written[0].wb.Sheets[SOCI_FACE_SHEET];

    const detail = findRow(ws, "Unmapped Expense Line");
    expect(ws[XLSX.utils.encode_cell({ r: detail, c: 2 })]).toBeUndefined();

    const subtotal = findRow(ws, "GROSS PROFIT");
    expect(ws[XLSX.utils.encode_cell({ r: subtotal, c: 2 })].v).toBe(0);
  });

  it("foots each note block with a live SUM over its own ledger rows", () => {
    downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS });
    const ws = written[0].wb.Sheets[SOCI_NOTES_SHEET];
    const rows = rowsOf(ws);
    const totalIdx = rows.findIndex((r) => r[2] === "Total — Revenue");
    const total = ws[XLSX.utils.encode_cell({ r: totalIdx, c: 3 })];

    // The two ledger rows sit immediately above the total.
    expect(total.f).toBe(`SUM(D${totalIdx - 1}:D${totalIdx})`);
    // …and the cached value is the sum our own figures produce, so a stale
    // cache and a recalculation cannot disagree.
    expect(total.v).toBeCloseTo(2150487725.11, 2);
    expect(total.v).toBeCloseTo(rows[totalIdx - 2][3] as number + (rows[totalIdx - 1][3] as number), 2);
  });

  it("shows the year-on-year movement on each ledger, guarded against a nil comparative", () => {
    downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS });
    const ws = written[0].wb.Sheets[SOCI_NOTES_SHEET];
    const rows = rowsOf(ws);
    const idx = rows.findIndex((r) => r[2] === "Sales — Export");

    expect(ws[XLSX.utils.encode_cell({ r: idx, c: 5 })]).toMatchObject({ v: 150000000, f: `D${idx + 1}-E${idx + 1}` });
    const pct = ws[XLSX.utils.encode_cell({ r: idx, c: 6 })];
    expect(pct.v).toBeCloseTo(0.3, 6);
    expect(pct.f).toContain(`IF(E${idx + 1}=0,""`);
  });

  it("cross-links the face and the notes in both directions", () => {
    downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS });
    const face = written[0].wb.Sheets[SOCI_FACE_SHEET];
    const notes = written[0].wb.Sheets[SOCI_NOTES_SHEET];

    const faceRow = findRow(face, "Revenue");
    const target = face[XLSX.utils.encode_cell({ r: faceRow, c: 0 })].l.Target;
    expect(target).toMatch(/^#'Notes to the Statement'!A\d+$/);

    // The link lands on the note block header for the same line.
    const notesRow = Number(target.split("!A")[1]) - 1;
    expect(rowsOf(notes)[notesRow][2]).toBe("Revenue");

    const back = notes[XLSX.utils.encode_cell({ r: notesRow, c: 2 })].l.Target;
    expect(rowsOf(face)[Number(back.split("!A")[1]) - 1][0]).toBe("Revenue");
  });

  it("records the basis of preparation, the scope limitation and the coverage issues", () => {
    downloadSociWorkbook({ lines: LINES, meta: META, accounts: ACCOUNTS });
    const rows = rowsOf(written[0].wb.Sheets[SOCI_AUDIT_SHEET]);
    const value = (label: string) => rows.find((r) => r[0] === label)?.[1] as string | undefined;

    expect(value("Entity")).toBe("Acme (Pvt) Ltd");
    expect(value("Registration number")).toBe("PV 12345");
    expect(value("Reporting period")).toBe("1 Apr 2025 to 31 Mar 2026");
    expect(value("Comparative period")).toBe("1 Apr 2024 to 31 Mar 2025");
    expect(value("Presentation currency")).toBe("Sri Lanka Rupees (LKR)");
    expect(value("Basis of accounting")).toContain("Accrual basis");
    expect(value("Scope")).toContain("not a complete set of financial statements");
    expect(value("Prepared by")).toBe("Treshane Ranasinghe");
    expect(value("Document fingerprint")).toContain("SOCI/2025-04-01/2026-03-31/");
    expect(value("Acknowledgement")).toContain("acknowledged by Treshane");
    expect(value("Issue 1")).toContain("UNMAPPED_ACCOUNT");
    expect(value("Note 1")).toBe("Figures In Brackets Indicate Deductions.");
  });

  it("says so plainly when every account is mapped and the statement ties out", () => {
    downloadSociWorkbook({ lines: LINES, meta: { ...META, warnings: [], ackNote: undefined }, accounts: ACCOUNTS });
    const rows = rowsOf(written[0].wb.Sheets[SOCI_AUDIT_SHEET]);

    expect(rows.find((r) => r[0] === "Result")?.[1]).toContain("No coverage issues");
    expect(rows.some((r) => r[0] === "Acknowledgement")).toBe(false);
  });

  it("still writes the face when no ledger detail is available", () => {
    expect(downloadSociWorkbook({ lines: LINES, meta: META })).toBe(true);
    expect(written[0].wb.SheetNames).toEqual([SOCI_FACE_SHEET, SOCI_AUDIT_SHEET]);
  });

  it("writes nothing when there is no statement", () => {
    expect(downloadSociWorkbook({ lines: [], meta: META })).toBe(false);
    expect(written).toHaveLength(0);
  });
});
