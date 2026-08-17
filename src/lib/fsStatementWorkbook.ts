import {
  downloadWorkbook, moneyCell, balanceCell, textCell, headingRowCount, sheetRef, withLink,
  MONEY_FORMAT, type SheetCell, type WorkbookSheet, type ReportExcelMeta,
} from "@/lib/reportExcel";
import { fingerprintFor, logExport, type FsExportMeta } from "@/lib/fsStatementExport";
import { generatedSentence, periodSentence } from "@/lib/reportHeading";
import type { FsStatementLine, FsStatementAccount } from "@/hooks/useFinancialStatements";

/**
 * The .xlsx counterpart of `exportSociPdf` — a statement of profit or loss and
 * other comprehensive income as a workbook rather than a picture of one.
 *
 * Three tabs, in the order a reviewer reads them:
 *
 *  1. **Profit or Loss and OCI** — the statutory face. Entity identity, title,
 *     period caption, comparative column, note references. Amounts are real
 *     numbers carrying the bracketed-negative accounting format, so the sheet
 *     can be footed and re-cast rather than only read (LKAS 1.51 identification,
 *     .38 comparatives, .82–.85 the face of the statement).
 *  2. **Notes to the Statement** — the ledgers behind each line, cross-linked
 *     both ways with the face (LKAS 1.113 cross-referencing). Every block foots
 *     with a live `SUM()` so the disclosure proves itself in the reader's Excel,
 *     not just in ours.
 *  3. **Basis and Audit Trail** — basis of preparation, presentation currency,
 *     the reporting and comparative periods, preparer, document fingerprint and
 *     every coverage issue in force at export time.
 *
 * Emphasis (bold subtotals, double rules) is deliberately not attempted: the
 * SheetJS build in use writes values, formats and links but not cell styles, and
 * a subtotal that merely *looks* like a detail line is better than one faked
 * with markers a formula would then choke on. Structure is carried by the
 * labels, the note column and the totals themselves.
 */

export const SOCI_FACE_SHEET = "Profit or Loss and OCI";
export const SOCI_NOTES_SHEET = "Notes to the Statement";
export const SOCI_AUDIT_SHEET = "Basis and Audit Trail";

/** Earnings per share: 2dp, brackets for a loss, no thousands separator. */
const EPS_FORMAT = "0.00;(0.00)";
const PERCENT_FORMAT = "0.00%";

const yearOf = (iso: string | null | undefined): string => (iso ? iso.slice(0, 4) : "");

function epsCell(n: number | null | undefined): SheetCell {
  if (n == null) return { v: null };
  return { v: n, z: EPS_FORMAT };
}

/** Server-side margins arrive as percentages (24.22); Excel wants the ratio. */
function marginCell(n: number | null | undefined): SheetCell {
  if (n == null) return { v: null };
  return { v: n / 100, z: PERCENT_FORMAT };
}

/** The amount cell for a statement line, by line type. A detail line blanks a
 * zero — unmapped and genuinely nil look the same in the ledger — while a
 * computed subtotal shows 0.00, because that is an answer rather than a gap. */
function lineAmountCell(line: FsStatementLine, value: number | null): SheetCell {
  if (line.line_type === "per_share") return epsCell(value);
  return line.line_type === "detail" ? moneyCell(value) : balanceCell(value);
}

/** Row index inside a sheet's own section grid, keyed by statement line. */
export type LineAnchors = Map<string, number>;

export interface SheetGrid {
  grid: SheetCell[][];
  anchors: LineAnchors;
  /** Excel outline level per grid row — 1 marks a ledger nested under its line. */
  levels?: number[];
}

export interface SociWorkbookInput {
  lines: FsStatementLine[];
  meta: FsExportMeta;
  /** Ledgers under each line, keyed by line id — the Notes tab. */
  accounts?: Map<string, FsStatementAccount[]>;
}

/**
 * The face of the statement. Column order matches the screen exactly —
 * label, note, current, comparative, current margin, comparative margin — so a
 * reader can lay the workbook next to the report and reconcile column by column.
 */
export function buildSociFaceGrid(
  lines: FsStatementLine[],
  meta: FsExportMeta,
  fingerprintLine: string,
  accounts?: Map<string, FsStatementAccount[]>,
  rowOffset = 1
): SheetGrid {
  const hasCmp = Boolean(meta.cmpDateTo);
  const currencyCaption = meta.currencyCaption?.trim() || "LKR";
  const curYear = yearOf(meta.dateTo);
  const cmpYear = yearOf(meta.cmpDateTo);

  const width = hasCmp ? 6 : 4;
  const pad = (row: SheetCell[]): SheetCell[] =>
    row.length >= width ? row.slice(0, width) : [...row, ...Array(width - row.length).fill({ v: null } as SheetCell)];

  const grid: SheetCell[][] = [];
  const anchors: LineAnchors = new Map();
  const levels: number[] = [];
  const push = (row: SheetCell[], level = 0) => { grid.push(pad(row)); levels.push(level); };
  // The figure column: C with a comparative, C without — both, as it happens.
  const AMT_COL = "C";
  const CMP_COL = "D";

  push([textCell(`Reporting period: ${periodSentence(meta.dateFrom, meta.dateTo).replace(/^For the period /, "")}`)]);
  if (hasCmp) {
    push([textCell(`Comparative period: ${periodSentence(meta.cmpDateFrom, meta.cmpDateTo).replace(/^For the period /, "")}`)]);
  }
  push([]);

  // Two header rows: the periods, then the classic amount-column caption the
  // statement carries ("Rs.  Cts.") under each figure column.
  push(hasCmp
    ? ["", "Note", curYear, cmpYear, `% ${curYear}`, `% ${cmpYear}`].map(textCell)
    : ["", "Note", curYear, "%"].map(textCell));
  push(hasCmp
    ? ["", "", currencyCaption, currencyCaption, "of revenue", "of revenue"].map(textCell)
    : ["", "", currencyCaption, "of revenue"].map(textCell));

  for (const l of lines) {
    if (l.line_type === "spacer") {
      push([]);
      continue;
    }
    anchors.set(l.line_id, grid.length);

    const kids = accounts?.get(l.line_id) ?? [];
    // Children are written immediately below, so the line's own figure can be
    // a live SUM over them — the face then re-proves itself in the reader's
    // Excel instead of asking to be trusted. Cached value stays our own, so it
    // reads correctly before any recalculation.
    const firstKidRow = grid.length + rowOffset + 1;
    const lastKidRow = firstKidRow + kids.length - 1;

    const amount = (value: number | null, col: string): SheetCell => {
      const cell = lineAmountCell(l, value);
      if (kids.length === 0) return cell;
      // A summed line always shows its figure, zero included: with the ledgers
      // visible underneath, a blank would read as "no data" rather than "nil".
      return { ...balanceCell(value ?? 0), f: `SUM(${col}${firstKidRow}:${col}${lastKidRow})` };
    };

    const row: SheetCell[] = [
      textCell(l.label),
      textCell(l.note_ref),
      amount(l.current_value, AMT_COL),
    ];
    if (hasCmp) row.push(amount(l.compare_value, CMP_COL));
    row.push(l.show_margin ? marginCell(l.current_margin) : { v: null });
    if (hasCmp) row.push(l.show_margin ? marginCell(l.compare_margin) : { v: null });
    push(row);

    for (const a of kids) {
      const kid: SheetCell[] = [
        textCell(`    ${a.account_code}  ${a.account_name}`),
        { v: null },
        balanceCell(a.current_value),
      ];
      if (hasCmp) kid.push(balanceCell(a.compare_value));
      kid.push({ v: null });
      if (hasCmp) kid.push({ v: null });
      push(kid, 1);
    }
  }

  push([]);
  for (const note of meta.footerNotes) push([textCell(note)]);
  push([textCell(fingerprintLine)]);
  if (meta.ackNote) push([textCell(meta.ackNote)]);

  return { grid, anchors, levels };
}

const NOTES_WIDTH_WITH_CMP = 7;
const NOTES_WIDTH = 4;

/**
 * The ledgers behind every line that has any, one block per note.
 *
 * `rowOffset` is the 1-based Excel row that grid row 0 will land on once the
 * company heading is prepended — the SUM and variance formulas are written as
 * real cell references, so they have to be absolute from the start.
 */
export function buildSociNotesGrid(
  lines: FsStatementLine[],
  accounts: Map<string, FsStatementAccount[]>,
  hasCmp: boolean,
  rowOffset: number
): SheetGrid {
  const width = hasCmp ? NOTES_WIDTH_WITH_CMP : NOTES_WIDTH;
  const pad = (row: SheetCell[]): SheetCell[] =>
    row.length >= width ? row.slice(0, width) : [...row, ...Array(width - row.length).fill({ v: null } as SheetCell)];

  const grid: SheetCell[][] = [];
  const anchors: LineAnchors = new Map();

  grid.push(pad((hasCmp
    ? ["Note", "Code", "Ledger account", "Current", "Comparative", "Change", "Change %"]
    : ["Note", "Code", "Ledger account", "Current"]).map(textCell)));

  for (const l of lines) {
    const kids = accounts.get(l.line_id) ?? [];
    if (kids.length === 0) continue;

    anchors.set(l.line_id, grid.length);
    grid.push(pad([textCell(l.note_ref), { v: null }, textCell(l.label)]));

    const firstRow = grid.length + rowOffset;
    for (const a of kids) {
      const r = grid.length + rowOffset;
      const row: SheetCell[] = [
        { v: null },
        textCell(a.account_code),
        textCell(a.account_name),
        balanceCell(a.current_value),
      ];
      if (hasCmp) {
        row.push(balanceCell(a.compare_value));
        row.push(changeCell(a.current_value, a.compare_value, `D${r}-E${r}`));
        row.push(changePercentCell(a.current_value, a.compare_value, `IF(E${r}=0,"",(D${r}-E${r})/ABS(E${r}))`));
      }
      grid.push(pad(row));
    }
    const lastRow = grid.length + rowOffset - 1;

    // The block foots itself: a live SUM, cached with our own total, so a
    // reader's Excel re-proves the disclosure rather than trusting the file.
    const totalRow = grid.length + rowOffset;
    const curSum = sum(kids.map((a) => a.current_value));
    const cmpSum = sum(kids.map((a) => a.compare_value));
    const total: SheetCell[] = [
      { v: null },
      { v: null },
      textCell(`Total — ${l.label}`),
      { v: curSum, z: MONEY_FORMAT, f: `SUM(D${firstRow}:D${lastRow})` },
    ];
    if (hasCmp) {
      total.push({ v: cmpSum, z: MONEY_FORMAT, f: `SUM(E${firstRow}:E${lastRow})` });
      total.push(changeCell(curSum, cmpSum, `D${totalRow}-E${totalRow}`));
      total.push(changePercentCell(curSum, cmpSum, `IF(E${totalRow}=0,"",(D${totalRow}-E${totalRow})/ABS(E${totalRow}))`));
    }
    grid.push(pad(total));
    grid.push(pad([]));
  }

  return { grid, anchors };
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((t, v) => t + (v ?? 0), 0);
}

function changeCell(cur: number | null, cmp: number | null, formula: string): SheetCell {
  return { ...balanceCell((cur ?? 0) - (cmp ?? 0)), f: formula };
}

function changePercentCell(cur: number | null, cmp: number | null, formula: string): SheetCell {
  const base = Math.abs(cmp ?? 0);
  if (base < 0.005) return { v: null };
  return { v: ((cur ?? 0) - (cmp ?? 0)) / base, z: PERCENT_FORMAT, f: formula };
}

/**
 * Basis of preparation, scope and audit trail. Everything a reader needs to
 * know what these figures are — and are not — before quoting them, including
 * the coverage issues that were outstanding when the file was written.
 */
export function buildSociAuditGrid(meta: FsExportMeta, fingerprintLine: string): SheetCell[][] {
  const rows: SheetCell[][] = [];
  const pair = (label: string, value: string | null | undefined) => {
    if (!value) return;
    rows.push([textCell(label), textCell(value)]);
  };
  const heading = (text: string) => {
    rows.push([{ v: null }, { v: null }]);
    rows.push([textCell(text), { v: null }]);
  };

  rows.push([textCell("Reporting entity"), { v: null }]);
  pair("Entity", meta.company?.companyName);
  pair("Registered address", meta.company?.address?.replace(/\n/g, ", "));
  pair("Registration number", meta.company?.registrationNumber);
  pair("Taxpayer identification", meta.company?.taxId);
  pair("Telephone", meta.company?.phone);

  heading("Basis of preparation");
  pair("Statement", meta.title);
  pair("Reporting period", periodSentence(meta.dateFrom, meta.dateTo).replace(/^For the period /, ""));
  pair(
    "Comparative period",
    meta.cmpDateTo
      ? periodSentence(meta.cmpDateFrom, meta.cmpDateTo).replace(/^For the period /, "")
      : "None presented"
  );
  pair("Basis of accounting", "Accrual basis — income and expenses recognised in the period they arise, irrespective of receipt or payment");
  pair("Presentation currency", "Sri Lanka Rupees (LKR)");
  pair("Rounding", "Amounts are presented in full rupees to two decimal places; no rounding has been applied to the underlying ledger");
  pair("Sign convention", "Figures in brackets indicate deductions or losses");
  pair("Source", "Compiled from the posted general ledger of this entity by Finthera; unposted and draft entries are excluded");
  pair(
    "Scope",
    "This is the statement of profit or loss and other comprehensive income only. It is not a complete set of financial statements, which additionally requires a statement of financial position, a statement of changes in equity, a statement of cash flows and the accompanying notes."
  );
  pair("Assurance", "Management-prepared and unaudited unless separately reported on by an auditor");

  heading("Audit trail");
  pair("Statement code", meta.statementCode);
  pair("Prepared by", meta.preparedBy || "—");
  pair("Generated", generatedSentence(meta.preparedBy).replace(/^Generated /, ""));
  pair("Document fingerprint", fingerprintLine);
  pair("Acknowledgement", meta.ackNote);

  heading("Coverage checks at the time of export");
  if (meta.warnings.length === 0) {
    rows.push([textCell("Result"), textCell("No coverage issues — every ledger with movement in the period is mapped to a line of this statement, and the statement ties to the trial balance.")]);
  } else {
    meta.warnings.forEach((w, i) => rows.push([textCell(`Issue ${i + 1}`), textCell(w)]));
  }

  if (meta.footerNotes.length > 0) {
    heading("Statement notes");
    meta.footerNotes.forEach((n, i) => rows.push([textCell(`Note ${i + 1}`), textCell(n)]));
  }

  return rows;
}

/** The face columns that navigate to the note: the label and the note ref. */
const FACE_LINK_COLUMNS = [0, 1];
/** The note block's own note ref and line label, linking back to the face. */
const NOTES_LINK_COLUMNS = [0, 2];

function linkColumns(
  grid: SheetCell[][],
  rowIndex: number,
  columns: readonly number[],
  target: string,
  tooltip: string
): void {
  const row = grid[rowIndex];
  if (!row) return;
  for (const c of columns) {
    if (row[c]) row[c] = withLink(row[c], target, tooltip);
  }
}

/**
 * Build and download the workbook. Returns false when there is nothing to
 * write, so the caller can leave the button inert rather than handing the user
 * an empty file.
 */
export function downloadSociWorkbook(input: SociWorkbookInput): boolean {
  const { lines, meta, accounts } = input;
  if (lines.length === 0) return false;

  const fp = fingerprintFor(meta, lines);
  const hasCmp = Boolean(meta.cmpDateTo);
  const identity = {
    companyName: meta.company?.companyName,
    address: meta.company?.address,
    phone: meta.company?.phone,
    taxId: meta.company?.taxId,
  };
  const periodLine = meta.periodCaption
    ? `${meta.periodCaption} ${yearOf(meta.dateTo)}`
    : periodSentence(meta.dateFrom, meta.dateTo);
  const basisLine = "Accrual basis  ·  All amounts in LKR  ·  Figures in brackets indicate deductions";
  const generatedLine = generatedSentence(meta.preparedBy);
  const namePrefix = meta.company?.companyName ? `${meta.company.companyName} — ` : "";
  const fileName = `${namePrefix}Statement of Comprehensive Income ${meta.dateFrom} to ${meta.dateTo}.xlsx`;

  const faceMeta: ReportExcelMeta = {
    ...identity,
    title: meta.title,
    subtitle: "Profit or Loss and Other Comprehensive Income",
    dateLine: periodLine,
    basisLine,
    generatedLine,
    sheetName: SOCI_FACE_SHEET,
    fileName,
  };
  const notesMeta: ReportExcelMeta = {
    ...identity,
    title: "Notes to the Statement of Comprehensive Income",
    subtitle: `The ledger accounts making up each line · click a note reference to jump back to the face of the statement`,
    dateLine: periodLine,
    basisLine,
    generatedLine,
    sheetName: SOCI_NOTES_SHEET,
    fileName,
  };
  const auditMeta: ReportExcelMeta = {
    ...identity,
    title: "Basis of Preparation and Audit Trail",
    dateLine: periodLine,
    basisLine,
    generatedLine,
    sheetName: SOCI_AUDIT_SHEET,
    fileName,
  };

  // Section rows sit below each sheet's heading block, and Excel rows are
  // 1-based — hence the offset applied to every anchor and formula.
  const faceOffset = headingRowCount(faceMeta) + 1;
  const notesOffset = headingRowCount(notesMeta) + 1;

  const face = buildSociFaceGrid(lines, meta, fp.line, accounts, faceOffset);
  const notes = accounts && accounts.size > 0
    ? buildSociNotesGrid(lines, accounts, hasCmp, notesOffset)
    : null;

  if (notes) {
    for (const [lineId, notesRow] of notes.anchors) {
      const faceRow = face.anchors.get(lineId);
      if (faceRow === undefined) continue;
      linkColumns(face.grid, faceRow, FACE_LINK_COLUMNS, sheetRef(SOCI_NOTES_SHEET, notesRow + notesOffset), "See the ledgers behind this line");
      linkColumns(notes.grid, notesRow, NOTES_LINK_COLUMNS, sheetRef(SOCI_FACE_SHEET, faceRow + faceOffset), "Back to this line on the face of the statement");
    }
  }

  const sheets: WorkbookSheet[] = [
    {
      meta: faceMeta,
      sections: [{
        grid: face.grid,
        merges: [],
        levels: face.levels,
      }],
    },
    ...(notes ? [{ meta: notesMeta, sections: [{ grid: notes.grid, merges: [] }] }] : []),
    { meta: auditMeta, sections: [{ grid: buildSociAuditGrid(meta, fp.line), merges: [] }] },
  ];

  const written = downloadWorkbook(fileName, sheets);
  if (written) void logExport(meta, "xlsx", fp.hash, lines);
  return written;
}
