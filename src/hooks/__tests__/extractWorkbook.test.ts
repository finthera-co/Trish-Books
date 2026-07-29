/**
 * The browser-side row extract must be indistinguishable, to the engine, from
 * decoding the .xlsx server-side — otherwise moving the decode off the edge
 * function silently changes what gets posted.
 *
 * Context: a 32,930-row workbook blew BOTH edge limits ("Memory limit exceeded"
 * and "CPU Time exceeded"), so the decode moved to the browser and the server
 * now parses the extracted cell matrix instead.
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractWorkbook, serialiseDateCell, EXTRACT_VERSION } from "../useBankStatementImport";
import { parseSheetMatrix } from "@/lib/bankCategorization";

function workbook(rows: unknown[][], name = "SAVINGS") {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return wb;
}

/** What the edge function's legacy path does with a decoded workbook. */
function serverSideMatrix(wb: XLSX.WorkBook, name: string) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) as unknown[][];
}

const HEADER = [
  ["Payment Analysis"],
  ["Date", "Name", "Description", "Account Type", "Debit", "Credit", "Balance"],
];

describe("serialiseDateCell", () => {
  it("keeps the calendar date the spreadsheet shows, not the UTC instant", () => {
    // Midnight local on 1 May. toISOString() in any timezone east of UTC would
    // roll this back to 30 April and import the row into the previous MONTH.
    const d = new Date(2024, 4, 1, 0, 0, 0);
    expect(serialiseDateCell(d)).toBe("2024-05-01");
    expect(serialiseDateCell(new Date(2024, 0, 9))).toBe("2024-01-09"); // zero padding
    expect(serialiseDateCell(new Date(2024, 11, 31))).toBe("2024-12-31");
  });

  it("never yields the previous day for a late-evening cell", () => {
    // 23:30 local on 31 Dec — toISOString() west of UTC would roll it forward.
    expect(serialiseDateCell(new Date(2024, 11, 31, 23, 30))).toBe("2024-12-31");
  });
});

describe("extractWorkbook", () => {
  it("stamps the version the edge function checks", () => {
    expect(extractWorkbook(workbook(HEADER)).v).toBe(EXTRACT_VERSION);
  });

  it("produces rows the engine parses identically to the server-side decode", () => {
    const rows = [
      ...HEADER,
      ["2024-05-01", "", "b/f", "", "", "", "100000"],
      ["2024-05-02", "ACME LTD", "payment 1", "Bank Charges", "1500.50", "", "98499.50"],
      ["2024-05-03", "PAYEE", "cash deposit", "Customer Deposits", "", "25000", "123499.50"],
      ["2024-05-04", "X", "odd row", "Plantation Expenses", "10.05", "", ""],
    ];
    const wb = workbook(rows);

    const viaServer = parseSheetMatrix(serverSideMatrix(wb, "SAVINGS"), "SAVINGS", { month: 5, year: 2024 });
    const viaExtract = parseSheetMatrix(extractWorkbook(wb).sheets[0].rows, "SAVINGS", { month: 5, year: 2024 });

    expect(viaExtract.errors).toEqual(viaServer.errors);
    expect(viaExtract.lines).toEqual(viaServer.lines);
  });

  it("round-trips real Date cells to the same parsed transaction date", () => {
    const wb = workbook([...HEADER,
      [new Date(2024, 4, 2), "ACME", "payment", "Bank Charges", "100", "", ""],
    ]);
    // The extract is JSON — assert what actually crosses the wire, not the
    // in-memory object, since Date survives one but not the other.
    const wire = JSON.parse(JSON.stringify(extractWorkbook(wb))) as { sheets: { rows: unknown[][] }[] };
    const lines = parseSheetMatrix(wire.sheets[0].rows, "SAVINGS", { month: 5, year: 2024 }).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].txnDate).toBe("2024-05-02");
  });

  it("survives JSON transport without altering amounts or text", () => {
    const wb = workbook([...HEADER,
      ["2024-05-02", "Ünïcode & Co", "ref #123, 50% off", "Plantation Expenses", "1234567.89", "", ""],
    ]);
    const wire = JSON.parse(JSON.stringify(extractWorkbook(wb))) as { sheets: { rows: unknown[][] }[] };
    const [line] = parseSheetMatrix(wire.sheets[0].rows, "SAVINGS", { month: 5, year: 2024 }).lines;
    expect(line.name).toBe("Ünïcode & Co");
    expect(line.description).toBe("ref #123, 50% off");
    expect(line.debit).toBe(1234567.89);
  });

  it("carries every sheet and drops only the empty ones", () => {
    const wb = workbook([...HEADER, ["2024-05-02", "A", "x", "Bank Charges", "1", "", ""]], "May");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[null]]), "Blank");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [...HEADER, ["2024-06-02", "B", "y", "Bank Charges", "2", "", ""]]), "Jun");
    const names = extractWorkbook(wb).sheets.map((s) => s.name);
    expect(names).toEqual(["May", "Jun"]);
  });

  it("preserves the footer rows the totals-row guard depends on", () => {
    // An amount with no date/description/name/voucher/account type.
    const wb = workbook([...HEADER,
      ["2024-05-02", "A", "x", "Bank Charges", "100", "", ""],
      ["", "", "", "", "438219700.68", "", ""],
    ]);
    const wire = JSON.parse(JSON.stringify(extractWorkbook(wb))) as { sheets: { rows: unknown[][] }[] };
    const lines = parseSheetMatrix(wire.sheets[0].rows, "SAVINGS", { month: 5, year: 2024 }).lines;
    const footer = lines.find((l) => l.debit === 438219700.68)!;
    expect(footer).toBeDefined();
    expect(footer.rawDate).toBe("");        // still detectable as a footer
    expect(footer.description).toBe("");
  });
});
