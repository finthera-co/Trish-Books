import * as XLSX from "xlsx";

/**
 * Generic financial-report Excel exporter — the .xlsx counterpart to
 * `reportPdf.ts`.
 *
 * Two entry points, same output shape:
 *
 *  - `downloadReportExcel(container, meta)` scrapes the statement table(s)
 *    already rendered on screen, so the workbook always matches what the
 *    report shows. Use it for reports that render every row.
 *  - `downloadDataExcel(meta, columns, rows)` builds the sheet from the
 *    report's own data. Use it where the DOM is not the full picture —
 *    paginated registers, virtualised tables.
 *
 * Displayed currency/percentage text ("LKR 1,234.00", "(LKR 500.00)",
 * "12.5%") is converted back to real numbers with an Excel number format, so
 * the workbook can be summed and pivoted rather than just read.
 */

const MONEY_FORMAT = "#,##0.00;(#,##0.00)";
const PERCENT_FORMAT = "0.0%";

/** Placeholders used for "no value" across the reports. */
const BLANKS = new Set(["", "—", "–", "-", "n/a", "N/A", "N/a"]);

const CURRENCY_PREFIX_RE = /^(LKR|Rs\.?|USD|EUR|GBP|INR|AUD|SGD|JPY|AED|A\$|S\$|[$€£₹¥])\s*/i;

export interface ReportExcelMeta {
  companyName?: string | null;
  address?: string | null;
  phone?: string | null;
  taxId?: string | null;
  title: string;
  subtitle?: string;
  dateLine?: string;
  /** Suggested download name. A missing/other extension is normalised to .xlsx. */
  fileName: string;
  /** Worksheet tab name — trimmed to Excel's 31-char limit. */
  sheetName?: string;
}

type SheetCell = { v: string | number | null; z?: string };

/**
 * Parse a rendered amount back to a number. Returns the sign-corrected value
 * plus whether the text carried an explicit currency/parenthesis marker —
 * used to avoid turning identifiers (account codes, invoice numbers) into
 * numbers just because they happen to be digits.
 */
function parseNumeric(raw: string): { value: number; explicit: boolean } | null {
  let t = raw.trim();
  let negative = false;
  let explicit = false;

  if (t.startsWith("(") && t.endsWith(")")) {
    negative = true;
    explicit = true;
    t = t.slice(1, -1).trim();
  }
  if (CURRENCY_PREFIX_RE.test(t)) {
    explicit = true;
    t = t.replace(CURRENCY_PREFIX_RE, "").trim();
  }
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1).trim();
  }
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(t) && !/^\d+(\.\d+)?$/.test(t)) return null;

  const value = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, explicit };
}

/** Percentages always convert — the `%` sign is unambiguous. */
function parsePercent(raw: string): number | null {
  const t = raw.trim();
  if (!t.endsWith("%")) return null;
  const parsed = parseNumeric(t.slice(0, -1));
  return parsed ? parsed.value / 100 : null;
}

/**
 * Turn displayed cell text into a typed sheet cell. `numericColumn` marks
 * columns the report itself right-aligns, i.e. amount columns.
 */
function toSheetCell(text: string, numericColumn: boolean): SheetCell {
  if (BLANKS.has(text)) return { v: null };

  const pct = parsePercent(text);
  if (pct !== null) return { v: pct, z: PERCENT_FORMAT };

  const num = parseNumeric(text);
  if (num && (numericColumn || num.explicit)) return { v: num.value, z: MONEY_FORMAT };

  return { v: text };
}

const cellText = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * Read a rendered table into a rectangular grid, expanding colspan/rowspan
 * into merge ranges so section headers and total rows keep their span.
 */
function extractTable(table: HTMLTableElement): { grid: SheetCell[][]; merges: XLSX.Range[] } {
  // Right-aligned columns are declared on the <th> elements, same convention
  // the PDF exporter reads.
  const headerCells = Array.from(table.tHead?.rows[0]?.cells ?? []);
  const rightAlignedColumn = headerCells.map((th) => th.className.includes("text-right"));

  const grid: (SheetCell | undefined)[][] = [];
  const merges: XLSX.Range[] = [];
  const rows = Array.from(table.rows);

  rows.forEach((tr, r) => {
    if (!grid[r]) grid[r] = [];
    let c = 0;
    Array.from(tr.cells).forEach((cell) => {
      while (grid[r][c] !== undefined) c++;

      const isHeader = cell.tagName === "TH";
      const numericColumn =
        !isHeader && (cell.className.includes("text-right") || rightAlignedColumn[c] === true);
      const text = cellText(cell);
      grid[r][c] = isHeader ? { v: text || null } : toSheetCell(text, numericColumn);

      const colSpan = cell.colSpan || 1;
      const rowSpan = cell.rowSpan || 1;
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (!grid[r + dr]) grid[r + dr] = [];
          grid[r + dr][c + dc] = { v: null };
        }
      }
      if (colSpan > 1 || rowSpan > 1) {
        merges.push({ s: { r, c }, e: { r: r + rowSpan - 1, c: c + colSpan - 1 } });
      }
      c += colSpan;
    });
  });

  const width = grid.reduce((w, row) => Math.max(w, row.length), 0);
  const filled = grid.map((row) =>
    Array.from({ length: width }, (_, i) => row[i] ?? { v: null })
  );
  return { grid: filled, merges };
}

/** Heading block: company identity, report title, basis line. */
function buildHeading(meta: ReportExcelMeta): SheetCell[][] {
  const lines: string[] = [];
  if (meta.companyName) lines.push(meta.companyName);
  if (meta.address) lines.push(...meta.address.split("\n").map((s) => s.trim()).filter(Boolean));
  const contact = [meta.phone, meta.taxId ? `TIN: ${meta.taxId}` : null].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);
  if (lines.length) lines.push("");
  lines.push(meta.title);
  if (meta.subtitle) lines.push(meta.subtitle);
  if (meta.dateLine) lines.push(meta.dateLine);
  lines.push("All amounts in LKR");
  lines.push(`Generated on ${new Date().toLocaleString()}`);
  lines.push("");
  return lines.map((text) => [{ v: text || null }]);
}

function normaliseFileName(name: string): string {
  const stripped = name.replace(/\.(pdf|csv|xlsx?)$/i, "");
  // Windows/macOS reject these in filenames.
  return `${stripped.replace(/[\\/:*?"<>|]/g, "-").trim() || "Report"}.xlsx`;
}

function sheetNameOf(meta: ReportExcelMeta): string {
  const raw = meta.sheetName ?? meta.title;
  return raw.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "Report";
}

/** Assemble the heading + section grids into a workbook and download it. */
function writeWorkbook(meta: ReportExcelMeta, sections: { grid: SheetCell[][]; merges: XLSX.Range[] }[]) {
  const heading = buildHeading(meta);
  const grid: SheetCell[][] = [...heading];
  const merges: XLSX.Range[] = [];

  sections.forEach((section, i) => {
    if (i > 0) grid.push([{ v: null }]);
    const offset = grid.length;
    section.merges.forEach((m) =>
      merges.push({ s: { r: m.s.r + offset, c: m.s.c }, e: { r: m.e.r + offset, c: m.e.c } })
    );
    grid.push(...section.grid);
  });

  const width = grid.reduce((w, row) => Math.max(w, row.length), 1);

  // Heading lines span the full table width so they stay centred over it.
  if (width > 1) {
    heading.forEach((row, r) => {
      if (row[0].v != null) merges.push({ s: { r, c: 0 }, e: { r, c: width - 1 } });
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(grid.map((row) => row.map((cell) => cell.v)));

  // Re-apply number formats — aoa_to_sheet only carries values.
  grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (!cell.z) return;
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref]) ws[ref].z = cell.z;
    });
  });

  ws["!merges"] = merges;
  ws["!cols"] = Array.from({ length: width }, (_, c) => {
    const longest = grid.reduce((max, row) => {
      const cell = row[c];
      if (!cell || cell.v == null) return max;
      // Merged heading text would otherwise blow the first column out.
      if (c === 0 && isHeadingRow(row)) return max;
      return Math.max(max, String(cell.v).length);
    }, 0);
    return { wch: Math.min(Math.max(longest + 2, 10), 48) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetNameOf(meta));
  XLSX.writeFile(wb, normaliseFileName(meta.fileName));
}

/** The single-cell rows prepended before the tables — merged, so not sized. */
function isHeadingRow(row: SheetCell[]): boolean {
  return row.length === 1 || row.slice(1).every((c) => c.v == null);
}

/**
 * Export the report currently rendered inside `container`.
 * Returns false when there is nothing to export.
 */
export function downloadReportExcel(
  container: HTMLElement,
  meta: ReportExcelMeta,
  selector = "table"
): boolean {
  const tables = Array.from(container.querySelectorAll<HTMLTableElement>(selector));
  if (tables.length === 0) return false;

  const sections = tables.map(extractTable).filter((s) => s.grid.length > 0);
  if (sections.length === 0) return false;

  writeWorkbook(meta, sections);
  return true;
}

export interface DataColumn<T> {
  header: string;
  /** Right-aligned amount columns get the currency number format. */
  numeric?: boolean;
  percent?: boolean;
  value: (row: T) => string | number | null;
}

/**
 * Export from the report's own data rather than the DOM — for paginated or
 * virtualised tables where the rendered rows are only part of the report.
 */
export function downloadDataExcel<T>(
  meta: ReportExcelMeta,
  columns: DataColumn<T>[],
  rows: T[],
  totalRow?: (string | number | null)[]
): boolean {
  if (rows.length === 0) return false;

  const toCell = (raw: string | number | null, col: DataColumn<T>): SheetCell => {
    if (raw == null || raw === "") return { v: null };
    if (typeof raw === "number") {
      if (col.percent) return { v: raw / 100, z: PERCENT_FORMAT };
      return { v: raw, z: col.numeric ? MONEY_FORMAT : undefined };
    }
    return { v: raw };
  };

  const grid: SheetCell[][] = [
    columns.map((c) => ({ v: c.header })),
    ...rows.map((row) => columns.map((c) => toCell(c.value(row), c))),
  ];
  if (totalRow) grid.push(totalRow.map((raw, i) => toCell(raw, columns[i] ?? { header: "", value: () => null })));

  writeWorkbook(meta, [{ grid, merges: [] }]);
  return true;
}
