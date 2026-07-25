/**
 * Bank Statement Categorization Engine — shared types.
 *
 * This folder is pure TypeScript with zero I/O so it can be unit-tested and
 * bundled into the `import-bank-statement` edge function. A verbatim copy
 * lives at supabase/functions/_shared/bankCategorization/ (same convention as
 * taxEngine.ts) — keep both in sync.
 *
 * Design principle: the engine never guesses an account's MEANING. A line
 * either matches an exact, auditable rule (Tier 1/2); or — when nothing matches
 * but the description is usable — an account NAMED from that description is
 * auto-generated and posted to, with its classification fixed by cash direction
 * (Tier 4, "derive"); or it goes to Suspense with a reason code (Tier 3); or it
 * is blocked as corrupt. Deriving never infers what kind of account it is, only
 * what to call it. Fuzzy/AI logic may only produce suggestions on suspense items.
 */

export const ENGINE_VERSION = "bank-cat-1.1.0";

/**
 * Ledger amounts are stored in journal_lines as NUMERIC(14,2) — twelve integer
 * digits and exactly two decimals. Anything at or above this cannot be posted
 * without silent truncation, so it is BLOCKED rather than rounded away.
 */
export const MAX_POSTABLE_AMOUNT = 1_000_000_000_000; // 1e12, exclusive bound

/** Canonical category the source workbook itself marks as suspense. */
export const SUSPENSE_CATEGORY = "suspense";

export type Side = "debit" | "credit";
export type ExpectedSide = Side | "either";

export type SuspenseReason =
  | "unknown_category_variant" // account_type present but no canonical mapping
  | "unmapped_category" // canonical category known, tenant has no account mapped
  | "no_category_no_rule" // no account_type and no exact rule matched
  | "conflicting_rules" // two active same-priority rules matched
  | "side_mismatch" // line sits on the wrong Dr/Cr side for its mapping
  | "amount_over_ceiling" // amount exceeds the per-line ceiling
  | "out_of_period_date" // date parses but falls outside the sheet's period
  | "inactive_account_mapping" // mapping/account inactive or not postable
  | "future_date" // dated after the batch's cut-off (keying error)
  | "source_marked_suspense"; // the workbook itself categorized it as suspense

export type BlockReason =
  | "both_sides_populated" // debit AND credit both > 0
  | "no_amount" // neither side populated / zero amount
  | "invalid_amount" // negative or non-finite amount
  | "amount_overflow" // exceeds NUMERIC(14,2) — cannot post without truncation
  | "unparseable_date"; // date missing or unparseable

export interface Suggestion {
  accountId: string;
  label: string;
  /** Where the suggestion came from, e.g. "conflicting_rule". Never authoritative. */
  source: string;
}

export type Resolution =
  | { kind: "resolved"; accountId: string; ruleId: string; tier: 1 | 2 }
  // Auto-generated (Tier 4): no mapping matched, but the description is usable,
  // so a ledger named from it is created and posted to. `side` fixes the
  // classification — debit (money out) → Expense, credit (money in) → Income.
  | { kind: "derive"; accountName: string; side: Side }
  | { kind: "suspense"; reason: SuspenseReason; suggestions: Suggestion[] }
  | { kind: "blocked"; reason: BlockReason };

/** One parsed statement row, normalized but not yet resolved. */
export interface ParsedLine {
  sheetName: string;
  /** 1-based row number in the source sheet (for audit / error messages). */
  rowIndex: number;
  /** Declared period for the sheet (confirmed by the user at upload). */
  periodMonth: number; // 1–12
  periodYear: number;
  /** ISO yyyy-mm-dd, or null when the cell could not be parsed. */
  txnDate: string | null;
  rawDate: string;
  description: string;
  name: string;
  voucherNo: string;
  rawAccountType: string;
  /** NaN when the cell held a non-numeric value. */
  debit: number;
  credit: number;
  bankFee: number | null;
  balance: number | null;
  /** B/F and opening-balance rows: never categorized, never posted. */
  isExcluded: boolean;
  parseFlags: string[];
}

export interface CanonicalMapEntry {
  id: string;
  /** Stored pre-normalized (normalizeText). */
  rawVariant: string;
  canonicalCategory: string;
}

export interface AccountMapEntry {
  id: string;
  canonicalCategory: string;
  accountId: string;
  expectedSide: ExpectedSide;
  isActive: boolean;
}

export interface CategorizationRule {
  id: string;
  matchField: "description" | "name";
  /** Stored pre-normalized (normalizeText). Exact match only — no fuzz. */
  matchValue: string;
  accountId: string;
  expectedSide: ExpectedSide;
  priority: number;
  isActive: boolean;
}

export interface AccountMeta {
  id: string;
  isActive: boolean;
  isPostable: boolean;
  isControlAccount: boolean;
}

export interface ResolutionContext {
  /** key: normalized raw variant */
  canonicalMap: Map<string, CanonicalMapEntry>;
  /** key: canonical category */
  accountMap: Map<string, AccountMapEntry>;
  rules: CategorizationRule[];
  /** key: account id — used to gate inactive / non-postable mappings */
  accounts: Map<string, AccountMeta>;
  /** Per-line amount ceiling; amounts above it go to Suspense even when matched. */
  amountCeiling: number;
  /** Latest acceptable transaction date (ISO yyyy-mm-dd). Lines dated after
   * this are keying errors and go to Suspense. Supplied by the caller so the
   * engine stays pure and deterministic — it never reads the clock itself. */
  maxDate?: string;
}

export interface ResolvedLine {
  line: ParsedLine;
  resolution: Resolution | null; // null for excluded (B/F) rows
  canonicalCategory: string | null;
}

export interface BatchDuplicate {
  key: string;
  rowRefs: Array<{ sheetName: string; rowIndex: number }>;
}

export interface BalanceDiscontinuity {
  sheetName: string;
  rowIndex: number;
  expected: number;
  actual: number;
}

export interface BatchValidation {
  totalDebit: number;
  totalCredit: number;
  /** Count of includable (non-excluded) lines. */
  rowCount: number;
  excludedCount: number;
  duplicates: BatchDuplicate[];
  discontinuities: BalanceDiscontinuity[];
}
