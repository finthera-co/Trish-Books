import {
  downloadWorkbook, moneyCell, balanceCell, textCell, headingRowCount, sheetRef, withLink,
  type SheetCell, type WorkbookSheet, type ReportExcelMeta,
} from "@/lib/reportExcel";
import { openingSplit, closingSplit, type TrialBalanceGroupBlock, type TrialBalanceGrandTotal } from "@/lib/trialBalanceModel";
import { fingerprintFor, logExport, type TrialBalanceExportMeta } from "@/lib/trialBalanceExport";
import { GL_DATE_FORMAT, GL_REPORT_CURRENCY, type GLReportRow } from "@/lib/glReportModel";
import { format as formatDate, parseISO } from "date-fns";

export interface CompanyIdentity {
  company_name?: string | null;
  address?: string | null;
  phone?: string | null;
  tax_id?: string | null;
}

const TB_HEADERS = [
  ["", "", "Opening Balance", "", "Transactions", "", "Closing Balance", ""],
  ["No", "Ledger Name", "Debit", "Credit", "Debit", "Credit", "Debit", "Credit"],
];

/** Spans the "Opening Balance" / "Transactions" / "Closing Balance" captions
 * over their Debit+Credit pair. Row-relative — buildSheet re-bases them below
 * the company heading block. */
const TB_HEADER_MERGES = [
  { s: { r: 0, c: 2 }, e: { r: 0, c: 3 } },
  { s: { r: 0, c: 4 }, e: { r: 0, c: 5 } },
  { s: { r: 0, c: 6 }, e: { r: 0, c: 7 } },
];

const GL_HEADERS = ["Account", "Type", "Date", "Num", "Adj", "Name", "Memo", "Split", "Debit", "Credit", "Balance"];

function glDate(iso: string): string {
  try {
    return formatDate(parseISO(iso), GL_DATE_FORMAT);
  } catch {
    return iso;
  }
}

export const TB_SHEET_NAME = "Trial Balance";
export const GL_SHEET_NAME = "General Ledger";

/** Row index, inside a sheet's own section grid, keyed by account id. */
export type SheetAnchors = Map<string, number>;

export interface SheetGrid {
  grid: SheetCell[][];
  anchors: SheetAnchors;
}

/**
 * Trial Balance sheet. Rendered from the same group blocks the screen uses, so
 * the workbook cannot drift from the report it was downloaded off. Also returns
 * where each account landed, so the General Ledger sheet can link back to it.
 */
export function buildTrialBalanceSheetGrid(
  groups: TrialBalanceGroupBlock[],
  grand: TrialBalanceGrandTotal,
  fingerprintLine: string
): SheetGrid {
  const grid: SheetCell[][] = TB_HEADERS.map((row) => row.map(textCell));
  const anchors: SheetAnchors = new Map();

  for (const g of groups) {
    grid.push([{ v: null }, textCell(g.label), ...Array(6).fill({ v: null })]);
    for (const r of g.rows) {
      const open = openingSplit(r);
      const close = closingSplit(r);
      anchors.set(r.account_id, grid.length);
      grid.push([
        textCell(r.account_code),
        textCell(r.account_name),
        moneyCell(open.debit), moneyCell(open.credit),
        moneyCell(r.period_debit), moneyCell(r.period_credit),
        moneyCell(close.debit), moneyCell(close.credit),
      ]);
    }
    grid.push([
      { v: null }, textCell(`Total ${g.label}`),
      moneyCell(g.opening_debit), moneyCell(g.opening_credit),
      moneyCell(g.period_debit), moneyCell(g.period_credit),
      moneyCell(g.closing_debit), moneyCell(g.closing_credit),
    ]);
    grid.push([{ v: null }]);
  }

  grid.push([
    { v: null }, textCell("TOTAL"),
    balanceCell(grand.opening_debit), balanceCell(grand.opening_credit),
    balanceCell(grand.period_debit), balanceCell(grand.period_credit),
    balanceCell(grand.closing_debit), balanceCell(grand.closing_credit),
  ]);
  grid.push([{ v: null }]);
  grid.push([textCell(fingerprintLine)]);
  return { grid, anchors };
}

/**
 * General Ledger sheet. The account label carries its tree depth as leading
 * spaces rather than spilling into extra columns, so Debit/Credit/Balance stay
 * in one column each and the sheet stays sortable and summable in Excel.
 *
 * Anchors record where each account's section header landed. First write wins:
 * a parent's "- Other" pseudo-child reports the same account id as the parent,
 * and the section header — which covers the whole subtree — is the row a reader
 * following a link from the Trial Balance wants to land on.
 */
export function buildGeneralLedgerSheetGrid(rows: readonly GLReportRow[], fingerprintLine: string): SheetGrid {
  const grid: SheetCell[][] = [GL_HEADERS.map(textCell)];
  const anchors: SheetAnchors = new Map();

  for (const r of rows) {
    if (r.kind === "account-header" && r.accountId && !anchors.has(r.accountId)) {
      anchors.set(r.accountId, grid.length);
    }
    if (r.kind === "txn") {
      const t = r.txn;
      if (r.isLoadingTxns || !t) continue;
      grid.push([
        { v: null },
        textCell(t.txn_type),
        textCell(glDate(t.entry_date)),
        textCell(t.num),
        textCell(t.is_adjusting ? "Y" : ""),
        textCell(t.entity_name),
        textCell(t.memo),
        textCell(t.split_text),
        moneyCell(t.debit),
        moneyCell(t.credit),
        balanceCell(t.running_balance),
      ]);
      continue;
    }
    const indent = "    ".repeat(Math.max(0, r.depth - 1));
    grid.push([
      textCell(indent + (r.label ?? "")),
      ...Array(7).fill({ v: null }),
      moneyCell(r.debit),
      moneyCell(r.credit),
      balanceCell(r.balance),
    ]);
  }

  grid.push([{ v: null }]);
  grid.push([textCell(fingerprintLine)]);
  return { grid, anchors };
}

/**
 * Point cells on one sheet at rows on the other, mirroring the on-screen
 * drill-through. Columns are linked individually rather than the whole row, so
 * a reader still selects amounts normally; only the code, the name and the two
 * closing figures navigate — the same three things that are clickable in the app.
 *
 * A missing anchor leaves the cell untouched. A link that resolves to the wrong
 * row is worse than no link, so nothing is guessed.
 */
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

/** No, Ledger Name, Closing Debit, Closing Credit. */
const TB_LINK_COLUMNS = [0, 1, 6, 7];
/** The account label on a General Ledger section header. */
const GL_LINK_COLUMNS = [0];

export interface TrialBalanceWorkbookInput {
  company: CompanyIdentity | null | undefined;
  meta: TrialBalanceExportMeta;
  groups: TrialBalanceGroupBlock[];
  grand: TrialBalanceGrandTotal;
  /** Full General Ledger for the same range and filters. */
  glRows: readonly GLReportRow[];
  glFingerprintLine: string;
}

/**
 * One workbook, two tabs: the Trial Balance and the General Ledger that backs
 * it, over the same date range and the same account population. Downloading a
 * trial balance without the ledger behind it makes the figures unauditable —
 * the reviewer has to come back and ask for the detail separately.
 */
export function downloadTrialBalanceWorkbook(input: TrialBalanceWorkbookInput): boolean {
  const { company, meta, groups, grand, glRows, glFingerprintLine } = input;
  const fp = fingerprintFor(meta, grand);
  const dateLine = `For the period ${meta.dateFrom} — ${meta.dateTo}`;
  const identity = {
    companyName: company?.company_name,
    address: company?.address,
    phone: company?.phone,
    taxId: company?.tax_id,
  };
  const namePrefix = company?.company_name ? `${company.company_name} — ` : "";
  const fileName = `${namePrefix}Trial Balance & General Ledger ${meta.dateFrom} to ${meta.dateTo}.xlsx`;

  const tbMeta: ReportExcelMeta = {
    ...identity,
    title: TB_SHEET_NAME,
    subtitle: `Grouped by ${meta.groupBy === "parent" ? "parent account" : meta.groupBy} · click a ledger code, name or closing balance to jump to that account in the General Ledger`,
    dateLine,
    sheetName: TB_SHEET_NAME,
    fileName,
  };
  const glMeta: ReportExcelMeta = {
    ...identity,
    title: GL_SHEET_NAME,
    subtitle: `Every posted entry behind the Trial Balance · amounts in ${GL_REPORT_CURRENCY} · click an account name to jump back`,
    dateLine,
    sheetName: GL_SHEET_NAME,
    fileName,
  };

  const tb = buildTrialBalanceSheetGrid(groups, grand, fp.line);
  const gl = buildGeneralLedgerSheetGrid(glRows, glFingerprintLine);

  // Section rows sit below each sheet's heading block, and Excel rows are
  // 1-based — hence the offset applied to every anchor.
  const tbOffset = headingRowCount(tbMeta) + 1;
  const glOffset = headingRowCount(glMeta) + 1;

  for (const [accountId, tbRowIndex] of tb.anchors) {
    const glRowIndex = gl.anchors.get(accountId);
    if (glRowIndex === undefined) continue;
    linkColumns(tb.grid, tbRowIndex, TB_LINK_COLUMNS, sheetRef(GL_SHEET_NAME, glRowIndex + glOffset), "Open this ledger in the General Ledger");
    linkColumns(gl.grid, glRowIndex, GL_LINK_COLUMNS, sheetRef(TB_SHEET_NAME, tbRowIndex + tbOffset), "Back to this account on the Trial Balance");
  }

  const sheets: WorkbookSheet[] = [
    { meta: tbMeta, sections: [{ grid: tb.grid, merges: TB_HEADER_MERGES }] },
    { meta: glMeta, sections: [{ grid: gl.grid, merges: [] }] },
  ];

  const written = downloadWorkbook(fileName, sheets);
  if (written) void logExport(meta, "xlsx", fp.hash, grand);
  return written;
}
