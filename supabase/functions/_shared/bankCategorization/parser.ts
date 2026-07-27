/**
 * Workbook parser core — operates on plain row matrices (unknown[][]) so it
 * has no SheetJS dependency and is identical between browser and edge
 * function. Callers extract matrices with XLSX.utils.sheet_to_json(sheet,
 * { header: 1, raw: true }) and pass them here.
 *
 * Bank-agnostic by design. Columns are located BY HEADER NAME (never position),
 * matched against a broad synonym set plus keyword fallbacks, so statements from
 * different banks parse without per-bank code: "Particulars"/"Narration" for the
 * description, "Withdrawal"/"Deposit" or "Dr"/"Cr" or a single signed "Amount"
 * for the money columns, and an optional "Account Type" column (the Sampath
 * payment-analysis workbook has one; most raw bank statements do not).
 */

import { normalizeText, parseAmountCell, roundAmount } from "./normalize.ts";
import type { ParsedLine } from "./types.ts";

export interface ColumnMap {
  headerRowIndex: number; // 0-based index into the matrix
  date: number;
  description: number;
  accountType: number | null;    // optional — many bank statements have none
  debit: number | null;          // separate debit / withdrawal column
  credit: number | null;         // separate credit / deposit column
  amount: number | null;         // single signed amount column (fallback)
  drCrIndicator: number | null;  // a "Dr"/"Cr" flag paired with `amount`
  name: number | null;
  voucherNo: number | null;
  bankFee: number | null;
  balance: number | null;
}

type ColKey = Exclude<keyof ColumnMap, "headerRowIndex">;

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

// Exact, normalized header → field. Broad on purpose: real statements vary the
// wording widely between banks. First occurrence of a field wins.
const HEADER_ALIASES: Record<string, ColKey> = {
  // date
  "date": "date", "txn date": "date", "transaction date": "date", "value date": "date",
  "posting date": "date", "post date": "date", "trans date": "date", "tran date": "date",
  "entry date": "date", "effective date": "date", "date time": "date",
  // description
  "description": "description", "particulars": "description", "narration": "description",
  "details": "description", "transaction details": "description", "remarks": "description",
  "memo": "description", "narrative": "description", "transaction description": "description",
  "description of transaction": "description", "transaction remarks": "description",
  // account type (optional)
  "account type": "accountType", "a/c type": "accountType", "ac type": "accountType",
  "category": "accountType", "type": "accountType", "account head": "accountType",
  "head": "accountType", "gl account": "accountType",
  // debit / withdrawal
  "debit": "debit", "debit amount": "debit", "withdrawal": "debit", "withdrawals": "debit",
  "withdrawal amount": "debit", "withdrawal (dr)": "debit", "dr": "debit", "paid out": "debit",
  "money out": "debit", "outflow": "debit", "debit (dr)": "debit", "amount debit": "debit",
  // credit / deposit
  "credit": "credit", "credit amount": "credit", "deposit": "credit", "deposits": "credit",
  "deposit amount": "credit", "deposit (cr)": "credit", "cr": "credit", "paid in": "credit",
  "money in": "credit", "inflow": "credit", "credit (cr)": "credit", "amount credit": "credit",
  // single signed amount + its Dr/Cr indicator
  "amount": "amount", "transaction amount": "amount", "txn amount": "amount",
  "amount (lkr)": "amount", "amount lkr": "amount", "value": "amount",
  "dr/cr": "drCrIndicator", "drcr": "drCrIndicator", "cr/dr": "drCrIndicator",
  "d/c": "drCrIndicator", "type dr/cr": "drCrIndicator", "debit/credit": "drCrIndicator",
  // reference / cheque — on a bank statement this is the cheque number
  "voucher no": "voucherNo", "voucher no.": "voucherNo", "voucher number": "voucherNo",
  "cheque no": "voucherNo", "cheque no.": "voucherNo", "cheque number": "voucherNo",
  "cheque": "voucherNo", "chq no": "voucherNo", "chq no.": "voucherNo",
  "check no": "voucherNo", "check number": "voucherNo", "instrument no": "voucherNo",
  "ref no": "voucherNo", "reference no": "voucherNo",
  // payee name
  "name": "name", "payee": "name", "payee name": "name", "beneficiary": "name",
  "counterparty": "name", "party": "name", "party name": "name",
  // bank fee / balance
  "bank fee": "bankFee", "bank fees": "bankFee",
  "balance": "balance", "running balance": "balance", "closing balance": "balance",
  "ledger balance": "balance", "available balance": "balance", "balance amount": "balance",
  "bal": "balance",
};

// Fallback for header wording not in the exact map: match on keywords, in
// priority order so the more specific field wins (e.g. "withdrawal amount" is a
// debit column, not a generic amount column).
function classifyHeader(h: string): ColKey | null {
  if (HEADER_ALIASES[h]) return HEADER_ALIASES[h];
  if (h === "") return null;
  if (/\b(dr\s*\/\s*cr|cr\s*\/\s*dr|d\s*\/\s*c)\b/.test(h)) return "drCrIndicator";
  if (/(withdraw|debit|\bdr\b|paid out|money out|outflow)/.test(h)) return "debit";
  if (/(deposit|credit|\bcr\b|paid in|money in|inflow)/.test(h)) return "credit";
  if (/balance/.test(h)) return "balance";
  if (/date/.test(h)) return "date";
  if (/(particular|narration|description|details|remark|memo|narrative)/.test(h)) return "description";
  if (/(cheque|chq|voucher|instrument|\bcheck\b|ref(erence)? no)/.test(h)) return "voucherNo";
  if (/(payee|beneficiary|counterparty|party name)/.test(h)) return "name";
  if (/(account type|a\/c type|category|account head)/.test(h)) return "accountType";
  if (/amount|value/.test(h)) return "amount";
  return null;
}

/**
 * Locate the header row and map each field to a column, bank-agnostically.
 * Scans the first 25 rows (statements often have a title/account block first),
 * scoring each candidate by how many known fields it contains, and picks the
 * best row that has the minimum viable set: a Date, a Description (or Name), and
 * at least one money column (Debit/Credit, or a single Amount). Everything else
 * — Account Type, cheque no, balance, one-hot category columns — is optional.
 */
export function findColumnMap(matrix: unknown[][]): ColumnMap | { error: string } {
  const scan = Math.min(25, matrix.length);
  let best: { r: number; map: Partial<Record<ColKey, number>>; score: number } | null = null;

  for (let r = 0; r < scan; r++) {
    const row = matrix[r] ?? [];
    const map: Partial<Record<ColKey, number>> = {};
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell !== "string") continue;
      const key = classifyHeader(normalizeText(cell));
      if (key && map[key] === undefined) { map[key] = c; score++; } // first occurrence wins
    }
    const hasDate = map.date !== undefined;
    const hasDesc = map.description !== undefined || map.name !== undefined;
    const hasAmount = map.debit !== undefined || map.credit !== undefined || map.amount !== undefined;
    if (hasDate && hasDesc && hasAmount && (best === null || score > best.score)) {
      best = { r, map, score };
    }
  }

  if (!best) {
    return { error: headerError(matrix, scan) };
  }
  const m = best.map;
  return {
    headerRowIndex: best.r,
    date: m.date!,
    description: m.description ?? m.name!, // fall back to the payee column
    accountType: m.accountType ?? null,
    debit: m.debit ?? null,
    credit: m.credit ?? null,
    amount: m.amount ?? null,
    drCrIndicator: m.drCrIndicator ?? null,
    name: m.name ?? null,
    voucherNo: m.voucherNo ?? null,
    bankFee: m.bankFee ?? null,
    balance: m.balance ?? null,
  };
}

/** Actionable message when no usable header row is found: say what is required
 * and echo the most header-like row we saw so the user can spot the mismatch. */
function headerError(matrix: unknown[][], scan: number): string {
  let sample: string[] = [];
  let bestCount = 0;
  for (let r = 0; r < scan; r++) {
    const row = matrix[r] ?? [];
    const texts = row.filter((c) => typeof c === "string" && c.trim() !== "").map((c) => String(c).trim());
    if (texts.length > bestCount) { bestCount = texts.length; sample = texts; }
  }
  const seen = sample.length ? ` Row seen: [${sample.slice(0, 12).join(", ")}].` : "";
  return (
    "Could not find the statement columns. Need a Date column, a Description/Particulars column, " +
    "and at least one money column (Debit & Credit, Withdrawal & Deposit, or a single Amount)." + seen
  );
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
 * Order three numbers into a valid ISO date, inferring which is day / month /
 * year from their magnitudes. Day-first is the Sri Lankan default for the
 * genuinely ambiguous case (both ≤ 12), but an out-of-range value forces the
 * only consistent reading — so US month-first rows are still recovered rather
 * than dropped. Returns null when no ordering is a real calendar date.
 */
function resolveNumericYmd(a: number, b: number, c: number): string | null {
  // Year-first: a is a full 4-digit year → (y, m, d).
  if (a >= 1000) {
    return isValidYmd(a, b, c) ? `${a}-${pad2(b)}-${pad2(c)}` : null;
  }
  // Otherwise c carries the year (2- or 4-digit); a and b are day/month.
  let y = c;
  if (y < 100) y += 2000;
  let d: number, mo: number;
  if (a > 12 && b <= 12) { d = a; mo = b; }        // a can only be the day
  else if (b > 12 && a <= 12) { mo = a; d = b; }   // b can only be the day (US m/d/y)
  else { d = a; mo = b; }                           // ambiguous → day-first (SL)
  return isValidYmd(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
}

/**
 * Parse a spelled-month date in any word order: "5 Jun 2024", "Jun 5, 2024",
 * "2024 June 5", "05-Jun-24", "1st April 2025". Tokenized so separators and
 * ordinal suffixes don't matter. Only fires when a real month WORD is present,
 * so it never misreads a numeric date.
 */
function parseMonthNameDate(s: string): string | null {
  const tokens = s.toLowerCase().split(/[\s,\-/.]+/).filter(Boolean);
  let mo: number | null = null, day: number | null = null, year: number | null = null;
  for (const t of tokens) {
    if (mo === null && MONTHS[t] !== undefined) { mo = MONTHS[t]; continue; }
    const numTok = t.replace(/(st|nd|rd|th)$/, ""); // 1st, 2nd, 23rd, 5th
    if (!/^\d+$/.test(numTok)) continue;
    const n = Number(numTok);
    if (numTok.length >= 3) { if (year === null) year = n; }        // 4-digit → year
    else if (day === null && n >= 1 && n <= 31) { day = n; }        // 1–31 → day
    else if (year === null) { year = n < 100 ? 2000 + n : n; }      // else → 2-digit year
  }
  if (mo === null || day === null || year === null) return null;
  if (year < 100) year += 2000;
  return isValidYmd(year, mo, day) ? `${year}-${pad2(mo)}-${pad2(day)}` : null;
}

/**
 * Parse a date cell into ISO yyyy-mm-dd, or null. Deliberately permissive —
 * every row a human would read as dated must resolve, or it is silently lost to
 * the per-month chunker. Accepts:
 *   • Date instances (SheetJS cellDates) and Excel serial numbers (num or text)
 *   • yyyy-mm-dd / yyyy/mm/dd / yyyy.mm.dd  (year-first)
 *   • dd/mm/yyyy · dd-mm-yy · dd.mm.yyyy and US mm/dd/yyyy (magnitude-inferred)
 *   • spelled months in any order ("5 Jun 2024", "June 5, 2024", "1st Apr 25")
 *   • any of the above with a trailing time component or stray quotes/spaces
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

  // Normalize: NFKC (full-width digits, NBSP), collapse whitespace, drop stray
  // quotes / a leading Excel text-marker apostrophe, then strip a trailing time.
  let s = String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  s = s.replace(/^['"]+/, "").replace(/["']+$/, "").trim();
  s = s.replace(/[ t]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([ap]\.?m\.?)?$/i, "").trim();
  if (s === "") return null;

  // Pure number as text → Excel serial, but only in a plausible date range so a
  // bare year ("2024") isn't mistaken for one.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n >= 20000 && n <= 60000 ? excelSerialToIso(n) : null;
  }

  const byName = parseMonthNameDate(s);
  if (byName) return byName;

  const m = s.match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})$/);
  if (m) return resolveNumericYmd(Number(m[1]), Number(m[2]), Number(m[3]));

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
  // Many statements print the date only on the first row of each day and leave
  // the rest blank; carry the last real date forward so those rows are not lost
  // to the per-month chunker. A present-but-unreadable date is NOT filled — it
  // is surfaced via the `unparseable_date` flag instead.
  let lastDate: string | null = null;

  for (let r = colMap.headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const hasAny = row.some((c) => c !== null && c !== undefined && String(c).trim() !== "");
    if (!hasAny) continue;

    const description = cellText(row[colMap.description]);
    const rawAccountType = colMap.accountType !== null ? cellText(row[colMap.accountType]) : "";
    const name = colMap.name !== null ? cellText(row[colMap.name]) : "";
    const isExcluded =
      isBroughtForwardText(description) ||
      isBroughtForwardText(rawAccountType) ||
      isBroughtForwardText(name);

    const rawDateCell = row[colMap.date];
    const rawDateText = cellText(rawDateCell);
    const bankFeeRaw = colMap.bankFee !== null ? parseAmountCell(row[colMap.bankFee]) : NaN;
    const balanceRaw = colMap.balance !== null ? parseAmountCell(row[colMap.balance]) : NaN;
    const flags: string[] = [];

    // Money columns, bank-agnostic. Round to the ledger's 2dp scale HERE so the
    // statement line and the journal line it produces are byte-identical.
    let debit = 0;
    let credit = 0;
    if (colMap.debit !== null || colMap.credit !== null) {
      // Separate Debit/Credit (or Withdrawal/Deposit, or Dr/Cr) columns.
      debit = colMap.debit !== null ? roundAmount(parseAmountCell(row[colMap.debit])) : 0;
      credit = colMap.credit !== null ? roundAmount(parseAmountCell(row[colMap.credit])) : 0;
    } else if (colMap.amount !== null) {
      // Single signed amount column. Split into a side using an explicit Dr/Cr
      // indicator when present, else by sign (negative = money out) — flagged.
      const amt = roundAmount(parseAmountCell(row[colMap.amount]));
      if (Number.isNaN(amt)) {
        debit = NaN; credit = NaN;
      } else if (amt !== 0) {
        let side: "debit" | "credit" | null = null;
        if (colMap.drCrIndicator !== null) {
          const ind = normalizeText(cellText(row[colMap.drCrIndicator]));
          if (/^(d|w|dr|debit|withdraw)/.test(ind)) side = "debit";
          else if (/^(c|dep|cr|credit|deposit)/.test(ind)) side = "credit";
        }
        if (side === null) {
          side = amt < 0 ? "debit" : "credit";
          flags.push("amount_sign_inferred");
        }
        const mag = Math.abs(amt);
        if (side === "debit") debit = mag; else credit = mag;
      }
    }
    if (Number.isNaN(debit) || Number.isNaN(credit)) flags.push("unparseable_amount");

    const hasAmount = (Number.isFinite(debit) && debit > 0) || (Number.isFinite(credit) && credit > 0);
    let txnDate = parseDateCell(rawDateCell);
    if (txnDate !== null) {
      lastDate = txnDate; // anchor for subsequent blank-date rows
    } else if (rawDateText === "" && !isExcluded && lastDate !== null && hasAmount) {
      // Blank date on a real transaction row (has a debit/credit) → inherit the
      // day above it. Rows with no amount are NOT dated — a stray/near-empty row
      // is not a transaction, so it is never given a fabricated date.
      txnDate = lastDate;
      flags.push("date_forward_filled");
    } else if (rawDateText !== "") {
      // A date was written but no format matched — flag it so it surfaces for
      // review rather than silently vanishing.
      flags.push("unparseable_date");
    }

    lines.push({
      sheetName,
      rowIndex: r + 1, // 1-based, as shown in Excel
      periodMonth: period.month,
      periodYear: period.year,
      txnDate,
      rawDate: rawDateText,
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
