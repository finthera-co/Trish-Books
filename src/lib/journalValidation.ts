// Journal Entry Validation Engine
// Production-grade validation matching QuickBooks behavior

import { CONTROL_ACCOUNT_SUBTYPES } from "./accountTypes";
import { detectSubledgerType } from "./accountMappingEngine";

export const EPSILON = 0.005;

/**
 * Cap on a single line's narration. journal_lines.memo is unbounded `text`, so
 * this is a product decision, not a schema one: the General Ledger and Account
 * Register render the memo in a fixed-width column, and a 4 KB paste there makes
 * the report unreadable long before it makes the database unhappy. Enforced on
 * both sides — this constant is mirrored in supabase/functions/validate-journal-entry.
 */
export const LINE_MEMO_MAX = 200;

/** Same floor the entry-level description has always had. */
export const LINE_MEMO_MIN = 3;

/**
 * Cap on the entry-level cheque number. Matches the
 * journal_entries_cheque_number_len CHECK constraint added in
 * 20260818000000_journal_entry_cheque_number.sql, and is mirrored in
 * supabase/functions/validate-journal-entry.
 */
export const CHEQUE_NUMBER_MAX = 50;

export interface JournalLine {
  account_id: string;
  debit: number;
  credit: number;
  /**
   * Per-line narration, stored in journal_lines.memo.
   *
   * Manual entries require one on every line — the create/edit forms have no
   * single entry-level description field, because one sentence stretched across
   * a five-line entry tells a reader nothing about any individual line. The
   * entry-level journal_entries.description is derived from the lines
   * (`deriveEntryDescription`) so the entry list, exports and the GL fallback
   * keep working unchanged.
   *
   * It stays optional on this type because system-generated lines (invoice and
   * payment postings, imports, depreciation) legitimately have none; those are
   * read through `resolveLineMemo`, which falls back to the entry description.
   */
  memo?: string | null;
}

export interface AccountInfo {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype: string | null;
  is_active: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// ── Core Validations ────────────────────────────────────────────────

/** Validate that total debits equal total credits */
export function validateBalance(lines: JournalLine[]): ValidationError | null {
  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);

  if (diff > EPSILON) {
    return {
      field: "balance",
      message: `Transaction is not balanced. Debits (LKR ${totalDebit.toFixed(2)}) must equal Credits (LKR ${totalCredit.toFixed(2)}). Difference: LKR ${diff.toFixed(2)}`,
      severity: "error",
    };
  }
  if (totalDebit === 0 && totalCredit === 0) {
    return {
      field: "balance",
      message: "Transaction cannot have zero amounts",
      severity: "error",
    };
  }
  return null;
}

/** Validate minimum lines (at least 2 lines, one debit one credit) */
export function validateMinimumLines(lines: JournalLine[]): ValidationError | null {
  const activeLines = lines.filter(
    (l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0)
  );
  if (activeLines.length < 2) {
    return {
      field: "lines",
      message: "A journal entry must have at least two lines",
      severity: "error",
    };
  }
  const hasDebit = activeLines.some((l) => Number(l.debit) > 0);
  const hasCredit = activeLines.some((l) => Number(l.credit) > 0);
  if (!hasDebit || !hasCredit) {
    return {
      field: "lines",
      message: "A journal entry must have at least one debit and one credit line",
      severity: "error",
    };
  }
  return null;
}

/** Validate each line has either debit OR credit, not both */
export function validateSingleSide(lines: JournalLine[]): ValidationError[] {
  return lines
    .map((l, i) => {
      if (Number(l.debit) > 0 && Number(l.credit) > 0) {
        return {
          field: `lines[${i}]`,
          message: `Line ${i + 1}: Cannot have both debit and credit amounts`,
          severity: "error" as const,
        };
      }
      return null;
    })
    .filter(Boolean) as ValidationError[];
}

/** Validate amounts are positive */
export function validatePositiveAmounts(lines: JournalLine[]): ValidationError[] {
  return lines
    .map((l, i) => {
      if (Number(l.debit) < 0 || Number(l.credit) < 0) {
        return {
          field: `lines[${i}]`,
          message: `Line ${i + 1}: Amounts must be positive numbers`,
          severity: "error" as const,
        };
      }
      return null;
    })
    .filter(Boolean) as ValidationError[];
}

/** Validate no duplicate accounts */
export function validateNoDuplicateAccounts(lines: JournalLine[]): ValidationError | null {
  const activeLines = lines.filter(
    (l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0)
  );
  const ids = activeLines.map((l) => l.account_id);
  if (new Set(ids).size !== ids.length) {
    return {
      field: "lines",
      message: "Each account should only appear once. Combine amounts on the same account into one line.",
      severity: "error",
    };
  }
  return null;
}

/** Validate accounts are active */
export function validateAccountStatus(
  lines: JournalLine[],
  accountsMap: Map<string, AccountInfo>
): ValidationError[] {
  return lines
    .map((l) => {
      if (!l.account_id) return null;
      const acc = accountsMap.get(l.account_id);
      if (!acc) {
        return {
          field: `account_${l.account_id}`,
          message: `Account not found: ${l.account_id}`,
          severity: "error" as const,
        };
      }
      if (!acc.is_active) {
        return {
          field: `account_${l.account_id}`,
          message: `Cannot post to inactive account: ${acc.account_code} – ${acc.account_name}`,
          severity: "error" as const,
        };
      }
      return null;
    })
    .filter(Boolean) as ValidationError[];
}

/** Validate control accounts — warn that subledger breakdown is required */
export function validateControlAccounts(
  lines: JournalLine[],
  accountsMap: Map<string, AccountInfo>,
  isSystemGenerated: boolean = false
): ValidationError[] {
  if (isSystemGenerated) return [];
  return lines
    .map((l) => {
      if (!l.account_id) return null;
      const acc = accountsMap.get(l.account_id);
      if (!acc || !acc.account_subtype) return null;
      const isControl = CONTROL_ACCOUNT_SUBTYPES.some((c) =>
        acc.account_subtype!.toLowerCase().includes(c.toLowerCase())
      );
      if (isControl) {
        return {
          field: `account_${l.account_id}`,
          message: `"${acc.account_name}" is a control account (${acc.account_subtype}). Sub-ledger breakdown is required.`,
          severity: "warning" as const,
        };
      }
      return null;
    })
    .filter(Boolean) as ValidationError[];
}

/** Validate entry date is not empty and not in a closed period */
export function validateDate(
  entryDate: string,
  closedPeriods?: { period_start: string; period_end: string }[]
): ValidationError | null {
  if (!entryDate) {
    return { field: "entry_date", message: "Transaction date is required", severity: "error" };
  }
  if (closedPeriods) {
    const d = new Date(entryDate);
    for (const p of closedPeriods) {
      const start = new Date(p.period_start);
      const end = new Date(p.period_end);
      if (d >= start && d <= end) {
        return {
          field: "entry_date",
          message: `Cannot post to a closed accounting period (${p.period_start} to ${p.period_end})`,
          severity: "error",
        };
      }
    }
  }
  return null;
}

/**
 * The description a line actually shows: its own memo, else the entry's.
 * Read paths must go through this so the UI, the exports and the SQL reports
 * agree on what a blank memo means — the same COALESCE the GL report RPC does.
 */
export function resolveLineMemo(
  lineMemo: string | null | undefined,
  entryDescription: string | null | undefined
): string {
  const own = (lineMemo ?? "").trim();
  if (own) return own;
  return (entryDescription ?? "").trim();
}

/** True when the line is showing the entry description rather than its own memo. */
export function isMemoInherited(lineMemo: string | null | undefined): boolean {
  return !(lineMemo ?? "").trim();
}

/**
 * Comparator for journal_lines.seq — the sole deterministic intra-entry line
 * order (see the column comment in 20260803000000_gl_report_foundation.sql).
 * An embedded PostgREST select returns lines in no guaranteed order, which was
 * invisible while every line shared one description and obvious once each line
 * has its own.
 */
export function bySeq(a: { seq?: number | null }, b: { seq?: number | null }): number {
  return Number(a.seq ?? 0) - Number(b.seq ?? 0);
}

/** Trim to storage form: blank becomes null, never an empty string. */
export function normalizeLineMemo(memo: string | null | undefined): string | null {
  const t = (memo ?? "").trim();
  return t.length > 0 ? t : null;
}

/**
 * journal_entries.description for an entry whose descriptions live on the lines.
 *
 * The column is NOT NULL and is what the entry list, search and every export
 * show, so it cannot simply be dropped. The first line's description is the
 * honest summary: it is the line the user wrote first, and the per-line detail
 * is still one click away in the expanded row and in the General Ledger.
 */
export function deriveEntryDescription(lines: JournalLine[]): string {
  const active = lines.filter(
    (l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0)
  );
  for (const l of active) {
    const memo = (l.memo ?? "").trim();
    if (memo) return memo;
  }
  // Fall back to any line with text at all, so a half-filled form still gets a
  // meaningful validation message rather than "Description is required".
  for (const l of lines) {
    const memo = (l.memo ?? "").trim();
    if (memo) return memo;
  }
  return "";
}

/**
 * Every posting line must say what it is. Applied to lines that carry an amount:
 * an empty spare row at the bottom of the grid is not an error.
 */
export function validateLineDescriptions(lines: JournalLine[]): ValidationError[] {
  return lines
    .map((l, i) => {
      const isActive = !!l.account_id || Number(l.debit) > 0 || Number(l.credit) > 0;
      if (!isActive) return null;
      const memo = (l.memo ?? "").trim();
      if (!memo) {
        return {
          field: `lines[${i}].memo`,
          message: `Line ${i + 1}: Description is required`,
          severity: "error" as const,
        };
      }
      if (memo.length < LINE_MEMO_MIN) {
        return {
          field: `lines[${i}].memo`,
          message: `Line ${i + 1}: Description must be at least ${LINE_MEMO_MIN} characters`,
          severity: "error" as const,
        };
      }
      if (memo.length > LINE_MEMO_MAX) {
        return {
          field: `lines[${i}].memo`,
          message: `Line ${i + 1}: Description must be ${LINE_MEMO_MAX} characters or fewer (currently ${memo.length})`,
          severity: "error" as const,
        };
      }
      return null;
    })
    .filter(Boolean) as ValidationError[];
}

/** Validate description is not empty */
export function validateDescription(description: string): ValidationError | null {
  if (!description.trim()) {
    return { field: "description", message: "Description is required", severity: "error" };
  }
  if (description.trim().length < 3) {
    return { field: "description", message: "Description must be at least 3 characters", severity: "error" };
  }
  return null;
}

// ── Full Validation Runner ──────────────────────────────────────────

export function validateJournalEntry(params: {
  /**
   * Entry-level description. Manual-entry callers derive this from the lines
   * (`deriveEntryDescription`) rather than collecting it separately.
   */
  description: string;
  entryDate: string;
  lines: JournalLine[];
  accountsMap: Map<string, AccountInfo>;
  closedPeriods?: { period_start: string; period_end: string }[];
  isSystemGenerated?: boolean;
}): ValidationResult {
  const { description, entryDate, lines, accountsMap, closedPeriods, isSystemGenerated } = params;
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Per-line descriptions — the only place a manual entry's narration is typed
  const lineDescErrors = validateLineDescriptions(lines);
  errors.push(...lineDescErrors);

  // Entry-level description. For manual entries this is derived from the lines,
  // so a failure here is the same fact the line errors already reported — raise
  // it only when the lines are fine and the caller still passed nothing, which
  // means a non-form caller built the entry itself.
  if (lineDescErrors.length === 0) {
    const descErr = validateDescription(description);
    if (descErr) errors.push(descErr);
  }

  // Date
  const dateErr = validateDate(entryDate, closedPeriods);
  if (dateErr) errors.push(dateErr);

  // Filter to lines with data
  const activeLines = lines.filter(
    (l) => l.account_id || Number(l.debit) > 0 || Number(l.credit) > 0
  );

  // Minimum lines
  const minErr = validateMinimumLines(activeLines);
  if (minErr) errors.push(minErr);

  // Single side
  errors.push(...validateSingleSide(lines));

  // Positive amounts
  errors.push(...validatePositiveAmounts(lines));

  // Balance
  const balErr = validateBalance(activeLines);
  if (balErr) errors.push(balErr);

  // Duplicate accounts
  const dupErr = validateNoDuplicateAccounts(activeLines);
  if (dupErr) errors.push(dupErr);

  // Account status
  errors.push(...validateAccountStatus(activeLines, accountsMap));

  // Control accounts
  const controlWarnings = validateControlAccounts(activeLines, accountsMap, isSystemGenerated);
  warnings.push(...controlWarnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Account Filtering Helpers ───────────────────────────────────────

/** Get accounts suitable for debit side based on common journal patterns */
export function getDebitSuggestedAccounts(accounts: AccountInfo[]): AccountInfo[] {
  // All active accounts can be debited, but prioritize: Assets, Expenses, COGS
  return accounts.filter((a) => a.is_active).sort((a, b) => {
    const priority: Record<string, number> = {
      Asset: 1,
      Expense: 2,
      "Cost of Goods Sold": 3,
      "Other Expense": 4,
      Liability: 5,
      Income: 6,
      Equity: 7,
      "Other Income": 8,
    };
    return (priority[a.account_type] || 99) - (priority[b.account_type] || 99);
  });
}

/** Get accounts suitable for credit side based on common journal patterns */
export function getCreditSuggestedAccounts(accounts: AccountInfo[]): AccountInfo[] {
  // All active accounts can be credited, but prioritize: Liabilities, Income, Bank
  return accounts.filter((a) => a.is_active).sort((a, b) => {
    const priority: Record<string, number> = {
      Liability: 1,
      Income: 2,
      Equity: 3,
      "Other Income": 4,
      Asset: 5,
      Expense: 6,
      "Cost of Goods Sold": 7,
      "Other Expense": 8,
    };
    return (priority[a.account_type] || 99) - (priority[b.account_type] || 99);
  });
}

/** Check if an account is a subledger (AR/AP) account */
export function isSubledgerAccount(account: AccountInfo): "AR" | "AP" | null {
  const stype = detectSubledgerType(account.account_subtype);
  if (stype === "customer") return "AR";
  if (stype === "vendor") return "AP";
  return null;
}

/** Get all active accounts for manual journal entries (including control accounts) */
export function getManualEntryAccounts(accounts: AccountInfo[]): AccountInfo[] {
  return accounts.filter((a) => a.is_active);
}

/** Check if an account requires subledger breakdown — uses mapping engine */
export function requiresSubledgerBreakdown(account: AccountInfo): string | null {
  const stype = detectSubledgerType(account.account_subtype);
  if (stype === "none") return null;
  // Map engine types to entity labels
  const labelMap: Record<string, string> = {
    customer: "customer",
    vendor: "vendor",
    inventory: "inventory",
    fixed_asset: "fixed_asset",
    asset_depreciation: "fixed_asset",
  };
  return labelMap[stype] || null;
}
