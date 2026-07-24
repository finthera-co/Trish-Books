import { describe, it, expect, beforeEach, vi } from "vitest";
import * as XLSX from "xlsx";
import { downloadReportExcel, downloadDataExcel } from "./reportExcel";

// Capture workbooks instead of hitting the filesystem/download path.
const { written } = vi.hoisted(() => ({ written: [] as { wb: XLSX.WorkBook; name: string }[] }));

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return {
    ...actual,
    writeFile: (wb: XLSX.WorkBook, name: string) => {
      written.push({ wb, name });
    },
  };
});

/** The sheet of the most recent export, as a raw array-of-arrays. */
function lastSheet() {
  const { wb, name } = written[written.length - 1];
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  return { ws, aoa, fileName: name };
}

/** Row index of the row whose first cell equals `label`. */
const rowOf = (aoa: unknown[][], label: string) => aoa.findIndex((r) => r[0] === label);

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

beforeEach(() => {
  written.length = 0;
  document.body.innerHTML = "";
});

describe("downloadReportExcel", () => {
  // Mirrors the Trial Balance / Balance Sheet markup: right-aligned amount
  // columns, a colspan section header, and a colspan totals row.
  const TRIAL_BALANCE = `
    <table class="data-table">
      <thead>
        <tr>
          <th class="w-24">Code</th>
          <th>Account Name</th>
          <th class="text-right w-36">Debit</th>
          <th class="text-right w-36">Credit</th>
          <th class="text-right w-24">% Depr.</th>
        </tr>
      </thead>
      <tbody>
        <tr><td colspan="5" class="font-semibold bg-muted/40">Assets</td></tr>
        <tr>
          <td class="font-mono">1000</td>
          <td>Cash at Bank</td>
          <td class="text-right font-mono">LKR 1,250,000.50</td>
          <td class="text-right font-mono">—</td>
          <td class="text-right">12.5%</td>
        </tr>
        <tr>
          <td class="font-mono">1200</td>
          <td>Accumulated Depreciation</td>
          <td class="text-right font-mono">—</td>
          <td class="text-right font-mono">(LKR 45,000.00)</td>
          <td class="text-right">0%</td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="font-bold">
          <td colspan="2">Totals</td>
          <td class="text-right font-mono">LKR 1,250,000.50</td>
          <td class="text-right font-mono">(LKR 45,000.00)</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;

  it("converts rendered currency text back to numbers", () => {
    const host = mount(TRIAL_BALANCE);
    expect(
      downloadReportExcel(host, { title: "Trial Balance", fileName: "tb.xlsx" }, "table.data-table")
    ).toBe(true);

    const { aoa } = lastSheet();
    const cash = aoa[rowOf(aoa, "1000")];
    expect(cash[2]).toBe(1250000.5);
    // "—" is an empty cell, not the literal dash.
    expect(cash[3]).toBeNull();
  });

  it("reads parenthesised amounts as negative", () => {
    const host = mount(TRIAL_BALANCE);
    downloadReportExcel(host, { title: "Trial Balance", fileName: "tb.xlsx" }, "table.data-table");

    const { aoa } = lastSheet();
    expect(aoa[rowOf(aoa, "1200")][3]).toBe(-45000);
  });

  it("keeps identifier columns as text", () => {
    const host = mount(TRIAL_BALANCE);
    downloadReportExcel(host, { title: "Trial Balance", fileName: "tb.xlsx" }, "table.data-table");

    // Account code 1000 is left-aligned and carries no currency marker — it
    // must not become the number 1000 (leading zeros would be lost).
    const { aoa } = lastSheet();
    expect(aoa[rowOf(aoa, "1000")][0]).toBe("1000");
  });

  it("stores percentages as fractions with a percent format", () => {
    const host = mount(TRIAL_BALANCE);
    downloadReportExcel(host, { title: "Trial Balance", fileName: "tb.xlsx" }, "table.data-table");

    const { ws, aoa } = lastSheet();
    const r = rowOf(aoa, "1000");
    expect(aoa[r][4]).toBeCloseTo(0.125);
    expect(ws[XLSX.utils.encode_cell({ r, c: 4 })].z).toBe("0.0%");
  });

  it("applies the currency number format to amount cells", () => {
    const host = mount(TRIAL_BALANCE);
    downloadReportExcel(host, { title: "Trial Balance", fileName: "tb.xlsx" }, "table.data-table");

    const { ws, aoa } = lastSheet();
    const r = rowOf(aoa, "1000");
    expect(ws[XLSX.utils.encode_cell({ r, c: 2 })].z).toBe("#,##0.00;(#,##0.00)");
  });

  it("records merges for colspan section and total rows", () => {
    const host = mount(TRIAL_BALANCE);
    downloadReportExcel(host, { title: "Trial Balance", fileName: "tb.xlsx" }, "table.data-table");

    const { ws, aoa } = lastSheet();
    const sectionRow = rowOf(aoa, "Assets");
    const totalsRow = rowOf(aoa, "Totals");
    const merges = ws["!merges"] ?? [];
    expect(merges).toContainEqual({ s: { r: sectionRow, c: 0 }, e: { r: sectionRow, c: 4 } });
    expect(merges).toContainEqual({ s: { r: totalsRow, c: 0 }, e: { r: totalsRow, c: 1 } });
  });

  it("writes the statement heading above the table", () => {
    const host = mount(TRIAL_BALANCE);
    downloadReportExcel(
      host,
      {
        companyName: "Acme (Pvt) Ltd",
        taxId: "123456789",
        title: "Trial Balance",
        subtitle: "Closing balances by account",
        dateLine: "As at Jul 24, 2026",
        fileName: "tb.xlsx",
      },
      "table.data-table"
    );

    const { aoa } = lastSheet();
    const headings = aoa.slice(0, rowOf(aoa, "Code")).map((r) => r[0]);
    expect(headings).toContain("Acme (Pvt) Ltd");
    expect(headings).toContain("TIN: 123456789");
    expect(headings).toContain("Trial Balance");
    expect(headings).toContain("As at Jul 24, 2026");
  });

  it("normalises the file extension and strips illegal characters", () => {
    const host = mount(TRIAL_BALANCE);
    downloadReportExcel(
      host,
      { title: "Balance Sheet", fileName: "Acme/Co — Balance Sheet 2026-07-24.pdf" },
      "table.data-table"
    );
    expect(lastSheet().fileName).toBe("Acme-Co — Balance Sheet 2026-07-24.xlsx");
  });

  it("returns false when the report rendered no table", () => {
    const host = mount(`<p>No journal entries found.</p>`);
    expect(downloadReportExcel(host, { title: "Trial Balance", fileName: "tb.xlsx" })).toBe(false);
    expect(written).toHaveLength(0);
  });

  it("exports every table in the container", () => {
    const host = mount(TRIAL_BALANCE + TRIAL_BALANCE);
    downloadReportExcel(host, { title: "Trial Balance", fileName: "tb.xlsx" }, "table.data-table");

    const { aoa } = lastSheet();
    expect(aoa.filter((r) => r[0] === "Code")).toHaveLength(2);
  });
});

describe("downloadDataExcel", () => {
  type Row = { customer: string; current: number; overdue: number | null };

  const columns = [
    { header: "Customer", value: (r: Row) => r.customer },
    { header: "Current", numeric: true, value: (r: Row) => r.current },
    { header: "120+ Days", numeric: true, value: (r: Row) => r.overdue },
  ];

  it("writes numbers with the currency format and appends the total row", () => {
    const ok = downloadDataExcel<Row>(
      { title: "AR Aging Report", dateLine: "As of 2026-07-24", fileName: "ar.xlsx" },
      columns,
      [
        { customer: "Blue Ltd", current: 1500.25, overdue: null },
        { customer: "Green Co", current: 0, overdue: 320 },
      ],
      ["TOTAL", 1500.25, 320]
    );
    expect(ok).toBe(true);

    const { ws, aoa } = lastSheet();
    const blue = rowOf(aoa, "Blue Ltd");
    expect(aoa[blue][1]).toBe(1500.25);
    expect(aoa[blue][2]).toBeNull();
    expect(ws[XLSX.utils.encode_cell({ r: blue, c: 1 })].z).toBe("#,##0.00;(#,##0.00)");

    const total = aoa[rowOf(aoa, "TOTAL")];
    expect(total[1]).toBe(1500.25);
    expect(total[2]).toBe(320);
  });

  it("returns false with no rows", () => {
    expect(
      downloadDataExcel<Row>({ title: "AR Aging Report", fileName: "ar.xlsx" }, columns, [])
    ).toBe(false);
    expect(written).toHaveLength(0);
  });
});
