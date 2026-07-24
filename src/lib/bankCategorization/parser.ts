/**
 * Workbook parser core — operates on plain row matrices (unknown[][]) so it
 * has no SheetJS dependency and is identical between browser and edge
 * function. Callers extract matrices with XLSX.utils.sheet_to_json(sheet,
 * { header: 1, raw: true }) and pass them here.
 *
 * Columns are located BY HEADER NAME, never by position — the real workbook
 * reorders Debit/Credit/Total/Bank Fee between months.
 */

import { normalizeText, parseAmountCell, roundAmount } from "./normalize.ts";
import type { ParsedLine } from "./types.ts";

export interface ColumnMap {
  headerRowIndex: number; // 0-based index into the matrix
  date: number;
  description: number;
  accountType: number;
  debit: number;
  credit: number;
  name: number | null;
  voucherNo: number | null;
  bankFee: number | null;
  balance: number | null;
}

export interface SheetParseResult {
  lines: ParsedLine[];
  errors: string[];
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/** Derive a {month, year} guess from a sheet title like "June 24" or
 * "October 2024 " (trailing space). Null when undecidable — the upload UI
 * always asks the user to confirm either way. */
export function parseSheetPeriod(sheetName: string): { month: number; year: number } | null {
  const norm = normalizeText(sheetName);
  const tokens = norm.split(/[\s\-_/,]+/).filter(Boolean);
  let month: number | null = null;
  let year: number | null = null;
  for (const t of tokens) {
    if (month === null && MONTHS[t] !== undefined) {
      month = MONTHS[t];
      continue;
    }
    if (year === null && /^\d{4}$/.test(t)) {
      year = Number(t);
      continue;
    }
    if (year === null && /^\d{2}$/.test(t)) {
      year = 2000 + Number(t);
    }
  }
  if (month === null || year === null) return null;
  return { month, year };
}

const BF_PATTERNS = [/^b\s*\/\s*f\b/, /\bopening balance\b/, /\bopenning balance\b/, /^balance b\s*\/\s*f\b/];

export function isBroughtForwardText(text: string): boolean {
  const norm = normalizeText(text);
  if (!norm) return false;
  return BF_PATTERNS.some((re) => re.test(norm));
}

const HEADER_ALIASES: Record<string, keyof Omit<ColumnMap, "headerRowIndex">> = {
  date: "date",
  description: "description",
  "account type": "accountType",
  "a/c type": "accountType",
  category: "accountType",
  debit: "debit",
  credit: "credit",
  name: "name",
  "voucher no": "voucherNo",
  "voucher no.": "voucherNo",
  "voucher number": "voucherNo",
  "bank fee": "bankFee",
  "bank fees": "bankFee",
  balance: "balance",
};

/**
 * Find the header row by scanning the first 5 rows for a cell equal to "Date"
 * (case-insensitive, trimmed), then build a name→column map from that row.
 * Extra columns (the wide one-hot "CATAGORIES" matrix, Total, …) are ignored.
 */
export function findColumnMap(matrix: unknown[][]): ColumnMap | { error: string } {
  for (let r = 0; r < Math.min(5, matrix.length); r++) {
    const row = matrix[r] ?? [];
    const dateCol = row.findIndex((c) => normalizeText(typeof c === "string" ? c : "") === "date");
    if (dateCol === -1) continue;

    const map: Partial<Record<keyof Omit<ColumnMap, "headerRowIndex">, number>> = {};
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell !== "string") continue;
      const key = HEADER_ALIASES[normalizeText(cell)];
      // First occurrence wins; the one-hot matrix can repeat category words.
      if (key !== undefined && map[key] === undefined) map[key] = c;
    }
    const required: Array<keyof Omit<ColumnMap, "headerRowIndex">> = [
      "date", "description", "accountType", "debit", "credit",
    ];
    const missing = required.filter((k) => map[k] === undefined);
    if (missing.length > 0) {
      return { error: `Header row found but missing required column(s): ${missing.join(", ")}` };
    }
    return {
      headerRowIndex: r,
      date: map.date!,
      description: map.description!,
      accountType: map.accountType!,
      debit: map.debit!,
      credit: map.credit!,
      name: map.name ?? null,
      voucherNo: map.voucherNo ?? null,
      bankFee: map.bankFee ?? null,
      balance: map.balance ?? null,
    };
  }
  return { error: 'No header row found (no cell equal to "Date" in the first 5 rows)' };
}

/** Excel serial date → ISO. Serial 25569 = 1970-01-01 (1900 date system). */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2958465) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Parse a date cell into ISO yyyy-mm-dd, or null (→ line Blocked).
 * Accepts: Date instances (SheetJS cellDates), Excel serial numbers,
 * "yyyy-mm-dd", and day-first "dd/mm/yyyy" · "dd-mm-yyyy" · "dd.mm.yyyy"
 * (Sri Lankan convention — day-first is assumed for ambiguous forms).
 */
export function parseDateCell(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    // SheetJS produces dates at local/UTC midnight; take UTC parts first,
    // falling back to local when the time-of-day says it was local midnight.
    const useLocal = value.getUTCHours() >= 12;
    const y = useLocal ? value.getFullYear() : value.getUTCFullYear();
    const m = useLocal ? value.getMonth() + 1 : value.getUTCMonth() + 1;
    const d = useLocal ? value.getDate() : value.getUTCDate();
    return isValidYmd(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  if (typeof value === "number") return excelSerialToIso(value);
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return isValidYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  return null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/**
 * Parse one sheet's matrix into ParsedLines. Never throws on bad data —
 * corrupt cells surface as NaN amounts / null dates and are Blocked
 * downstream. Fully empty rows are skipped; B/F rows are marked excluded.
 */
export function parseSheetMatrix(
  matrix: unknown[][],
  sheetName: string,
  period: { month: number; year: number }
): SheetParseResult {
  const colMap = findColumnMap(matrix);
  if ("error" in colMap) {
    return { lines: [], errors: [`${sheetName}: ${colMap.error}`] };
  }

  const lines: ParsedLine[] = [];
  for (let r = colMap.headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const hasAny = row.some((c) => c !== null && c !== undefined && String(c).trim() !== "");
    if (!hasAny) continue;

    const description = cellText(row[colMap.description]);
    const rawAccountType = cellText(row[colMap.accountType]);
    const name = colMap.name !== null ? cellText(row[colMap.name]) : "";
    const isExcluded =
      isBroughtForwardText(description) ||
      isBroughtForwardText(rawAccountType) ||
      isBroughtForwardText(name);

    const rawDateCell = row[colMap.date];
    const bankFeeRaw = colMap.bankFee !== null ? parseAmountCell(row[colMap.bankFee]) : NaN;
    const balanceRaw = colMap.balance !== null ? parseAmountCell(row[colMap.balance]) : NaN;
    // Round to the ledger's 2dp scale HERE so the statement line and the
    // journal line it produces are byte-identical (see roundAmount).
    const debit = roundAmount(parseAmountCell(row[colMap.debit]));
    const credit = roundAmount(parseAmountCell(row[colMap.credit]));
    const flags: string[] = [];
    if (Number.isNaN(debit) || Number.isNaN(credit)) flags.push("unparseable_amount");

    lines.push({
      sheetName,
      rowIndex: r + 1, // 1-based, as shown in Excel
      periodMonth: period.month,
      periodYear: period.year,
      txnDate: parseDateCell(rawDateCell),
      rawDate: cellText(rawDateCell),
      description,
      name,
      voucherNo: colMap.voucherNo !== null ? cellText(row[colMap.voucherNo]) : "",
      rawAccountType,
      debit,
      credit,
      bankFee: Number.isFinite(bankFeeRaw) ? roundAmount(bankFeeRaw) : null,
      balance: Number.isFinite(balanceRaw) ? roundAmount(balanceRaw) : null,
      isExcluded,
      parseFlags: flags,
    });
  }
  return { lines, errors: [] };
}
