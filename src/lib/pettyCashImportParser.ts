/**
 * Petty cash workbook parser.
 *
 * Pure functions only — no React, no Supabase, no side effects. Everything
 * here runs on an untrusted user file, and everything it produces is a
 * *preview*: the authoritative amount and date interpretation is redone in
 * Postgres by fn_parse_import_amount and the resolver. Keep the two in step.
 *
 * The one thing this file decides on its own is the date format, because only
 * the whole file can answer that question. When it cannot answer it
 * deterministically, it says so and the upload is refused rather than guessing
 * — a misread date silently books a transaction into the wrong period, and can
 * slip past a period-lock check that should have failed.
 */
import * as XLSX from "xlsx";

export type ImportDateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "EXCEL_SERIAL";

export type ParsedRow = {
  rowNo: number;
  rawDate: string;
  rawVoucherNo: string;
  rawName: string;
  rawDescription: string;
  rawAccountType: string;
  rawDebit: string;
  rawCredit: string;
  /** Single-amount sheets only; empty when the file has Debit/Credit. */
  rawAmount: string;
  parsedDate: string | null; // ISO yyyy-mm-dd
  debit: number | null;
  credit: number | null;
  amount: number | null;
};

/**
 * Which amount shape the file carries. A sheet has either Debit and Credit, or
 * a single Amount column — never both — and the direction of a single-amount
 * row cannot be read off the data, so the caller must declare it.
 */
export type AmountShape = "debit_credit" | "single";

export type DateFormatVerdict =
  | { kind: "resolved"; format: ImportDateFormat }
  | { kind: "ambiguous"; sample: string[] }
  | { kind: "conflicting"; evidenceDayFirst: string; evidenceMonthFirst: string };

export type ParseResult = {
  headerMap: Record<string, number>;
  /** debit_credit when both amount columns are present, single when only Amount is. */
  amountShape: AmountShape;
  missingColumns: string[];
  rows: ParsedRow[];
  dateVerdict: DateFormatVerdict;
  fileHash: string;
  sheetNames: string[];
  sheetName: string;
};

/** Same rules as the Postgres fn_normalize_import_key, so both agree on a match. */
export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HEADER_SYNONYMS: Record<string, string[]> = {
  date: ["date", "txn date", "transaction date", "voucher date"],
  voucher_no: ["voucher no", "voucher number", "vno", "cheque no", "chq no", "cheque number", "ref", "reference"],
  name: ["name", "paid to", "payee", "particulars"],
  description: ["description", "narration", "details", "remarks"],
  account_type: ["account type", "account", "gl account", "expense type", "head"],
  debit: ["debit", "dr", "payment", "paid out"],
  credit: ["credit", "cr", "receipt", "received"],
  amount: ["amount", "value", "total", "amount rs", "amount lkr"],
};

/**
 * Mirrors fn_parse_import_amount in Postgres.
 *
 * Blank and dash placeholders are a real zero. `(1,234.50)` is the accounting
 * negative and is returned as -1234.50 rather than silently absolute-valued,
 * so the resolver can block it with AMOUNT_NEGATIVE. Anything else that is not
 * a number returns null → AMOUNT_NOT_NUMERIC.
 */
export function parseImportAmount(raw: string): number | null {
  let v = (raw ?? "").toString().trim().toLowerCase();
  if (v === "") return 0;

  v = v.replace(/රු/g, "");
  v = v.replace(/lkr|rs\.|rs/g, "");
  v = v.replace(/\s/g, "");

  if (["", "-", "–", "—", "n/a", "na"].includes(v)) return 0;

  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.replace(/^\(|\)$/g, "");
  }
  if (/^[-–—]/.test(v)) {
    negative = true;
    v = v.slice(1);
  } else if (v.startsWith("+")) {
    v = v.slice(1);
  }

  v = v.replace(/,/g, "");

  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return negative ? -n : n;
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Splits a d/m/y-shaped cell into its three numeric components, or null. */
function splitDateParts(raw: string): [number, number, number] | null {
  const m = raw.trim().match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Decides the file's date format from all of its date cells at once.
 *
 * A cell whose first component is > 12 proves day-first; a cell whose second
 * component is > 12 proves month-first. If both proofs appear the file mixes
 * two formats and no single interpretation is correct, so it conflicts. If
 * neither appears every date is genuinely ambiguous and the user must choose.
 */
export function decideDateFormat(rawDates: string[], anyCellWasDate: boolean): DateFormatVerdict {
  const nonEmpty = rawDates.map((d) => (d ?? "").trim()).filter((d) => d !== "");
  if (anyCellWasDate) return { kind: "resolved", format: "EXCEL_SERIAL" };
  if (nonEmpty.length === 0) return { kind: "resolved", format: "DD/MM/YYYY" };

  if (nonEmpty.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    return { kind: "resolved", format: "YYYY-MM-DD" };
  }

  let dayFirst: string | null = null;
  let monthFirst: string | null = null;

  for (const d of nonEmpty) {
    const parts = splitDateParts(d);
    if (!parts) continue;
    const [a, b] = parts;
    if (a > 12 && a <= 31) dayFirst ??= d;
    if (b > 12 && b <= 31) monthFirst ??= d;
  }

  if (dayFirst && monthFirst) {
    return { kind: "conflicting", evidenceDayFirst: dayFirst, evidenceMonthFirst: monthFirst };
  }
  if (dayFirst) return { kind: "resolved", format: "DD/MM/YYYY" };
  if (monthFirst) return { kind: "resolved", format: "MM/DD/YYYY" };
  return { kind: "ambiguous", sample: nonEmpty.slice(0, 3) };
}

/** Applies a settled format to one cell. Returns null when unreadable. */
export function parseDateCell(raw: string, format: ImportDateFormat): string | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return isRealDate(y, m, d) ? iso(y, m, d) : null;
  }

  const parts = splitDateParts(v);
  if (!parts) return null;
  const [a, b, c] = parts;

  // A four-digit leading component is a year however the file is labelled.
  if (a > 31) return isRealDate(a, b, c) ? iso(a, b, c) : null;

  let year = c;
  if (year < 100) year += year < 70 ? 2000 : 1900;

  const [day, month] = format === "MM/DD/YYYY" ? [b, a] : [a, b];
  return isRealDate(year, month, day) ? iso(year, month, day) : null;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  return String(v).trim();
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function parsePettyCashWorkbook(
  file: File,
  opts?: { sheetName?: string; dateFormat?: Exclude<ImportDateFormat, "EXCEL_SERIAL"> },
): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const fileHash = await sha256Hex(buf);

  const wb = XLSX.read(buf, { cellDates: true, cellNF: false, raw: false });
  const sheetNames = wb.SheetNames;
  const sheetName = opts?.sheetName && sheetNames.includes(opts.sheetName) ? opts.sheetName : sheetNames[0];
  const sheet = wb.Sheets[sheetName];

  const empty: ParseResult = {
    headerMap: {},
    amountShape: "debit_credit",
    missingColumns: ["date", "debit/credit or amount"],
    rows: [],
    dateVerdict: { kind: "resolved", format: "DD/MM/YYYY" },
    fileHash,
    sheetNames,
    sheetName,
  };
  if (!sheet) return empty;

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
  if (grid.length === 0) return empty;

  // The header is the first row that maps at least three known columns —
  // sheets routinely carry a title and a blank line above it.
  let headerRowIdx = -1;
  let headerMap: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const candidate: Record<string, number> = {};
    grid[i].forEach((cell, col) => {
      const key = normalizeKey(cellText(cell));
      if (!key) return;
      for (const [canonical, synonyms] of Object.entries(HEADER_SYNONYMS)) {
        if (candidate[canonical] === undefined && synonyms.includes(key)) candidate[canonical] = col;
      }
    });
    if (Object.keys(candidate).length >= 3) {
      headerRowIdx = i;
      headerMap = candidate;
      break;
    }
  }

  if (headerRowIdx === -1) return empty;

  // A file needs a date, and one of the two amount shapes. Debit/Credit wins
  // when both are present, since it carries direction in the data itself.
  const hasDebitCredit = headerMap.debit !== undefined && headerMap.credit !== undefined;
  const hasAmount = headerMap.amount !== undefined;
  const amountShape: AmountShape = hasDebitCredit ? "debit_credit" : "single";

  const missingColumns: string[] = [];
  if (headerMap.date === undefined) missingColumns.push("date");
  if (!hasDebitCredit && !hasAmount) missingColumns.push("debit/credit or amount");
  if (missingColumns.length > 0) {
    return { ...empty, headerMap, amountShape, missingColumns, sheetName };
  }

  const at = (row: unknown[], key: string): string =>
    headerMap[key] === undefined ? "" : cellText(row[headerMap[key]]);

  type Staged = { rowNo: number; cells: Record<string, string>; dateWasDate: boolean };
  const staged: Staged[] = [];

  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    const cells = {
      date: at(row, "date"),
      voucher_no: at(row, "voucher_no"),
      name: at(row, "name"),
      description: at(row, "description"),
      account_type: at(row, "account_type"),
      debit: at(row, "debit"),
      credit: at(row, "credit"),
      amount: at(row, "amount"),
    };
    // Skip only rows where every cell we care about is empty. A row that
    // merely lacks an account must still reach the resolver so the user sees
    // it — including a merged "Total" row, which will block on ACCOUNT_*.
    if (Object.values(cells).every((v) => v === "")) continue;

    const dateCell = headerMap.date === undefined ? null : row[headerMap.date];
    staged.push({ rowNo: i + 1, cells, dateWasDate: dateCell instanceof Date });
  }

  const anyCellWasDate = staged.some((s) => s.dateWasDate);
  const detected = decideDateFormat(
    staged.map((s) => s.cells.date),
    anyCellWasDate,
  );

  // An explicit user choice settles an ambiguous file; it never overrides a
  // verdict the file itself proved, and it cannot rescue a conflicting file.
  const effectiveFormat: ImportDateFormat =
    detected.kind === "resolved"
      ? detected.format
      : detected.kind === "ambiguous"
        ? (opts?.dateFormat ?? "DD/MM/YYYY")
        : "DD/MM/YYYY";

  const rows: ParsedRow[] = staged.map((s) => ({
    rowNo: s.rowNo,
    rawDate: s.cells.date,
    rawVoucherNo: s.cells.voucher_no,
    rawName: s.cells.name,
    rawDescription: s.cells.description,
    rawAccountType: s.cells.account_type,
    rawDebit: s.cells.debit,
    rawCredit: s.cells.credit,
    rawAmount: s.cells.amount,
    parsedDate: detected.kind === "conflicting" ? null : parseDateCell(s.cells.date, effectiveFormat),
    debit: parseImportAmount(s.cells.debit),
    credit: parseImportAmount(s.cells.credit),
    amount: parseImportAmount(s.cells.amount),
  }));

  return {
    headerMap,
    amountShape,
    missingColumns: [],
    rows,
    dateVerdict: detected,
    fileHash,
    sheetNames,
    sheetName,
  };
}
