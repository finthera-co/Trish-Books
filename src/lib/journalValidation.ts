// Journal Entry Validation Engine
// Production-grade validation matching QuickBooks behavior

import { CONTROL_ACCOUNTS } from "./accountTypes";

export const EPSILON = 0.005;

export interface JournalLine {
  account_id: string;
  debit: number;
  credit: number;
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
      const isControl = CONTROL_ACCOUNTS.some((c) =>
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

  // Description
  const descErr = validateDescription(description);
  if (descErr) errors.push(descErr);

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
  if (!account.account_subtype) return null;
  const sub = account.account_subtype.toLowerCase();
  if (sub.includes("accounts receivable") || sub.includes("receivable")) return "AR";
  if (sub.includes("accounts payable") || sub.includes("payable")) return "AP";
  return null;
}

/** Get all active accounts for manual journal entries (including control accounts) */
export function getManualEntryAccounts(accounts: AccountInfo[]): AccountInfo[] {
  return accounts.filter((a) => a.is_active);
}

/** Check if an account requires subledger breakdown */
export function requiresSubledgerBreakdown(account: AccountInfo): string | null {
  if (!account.account_subtype) return null;
  const sub = account.account_subtype.toLowerCase();
  if (sub.includes("accounts receivable") || sub.includes("receivable")) return "customer";
  if (sub.includes("accounts payable") || sub.includes("payable")) return "vendor";
  if (sub.includes("inventory")) return "inventory";
  if (sub.includes("fixed asset") || sub.includes("accumulated depreciation")) return "fixed_asset";
  return null;
}
