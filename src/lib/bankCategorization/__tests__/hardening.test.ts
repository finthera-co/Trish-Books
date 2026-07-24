import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { roundAmount } from "../normalize";
import { parseSheetMatrix } from "../parser";
import { classifyLine } from "../resolve";
import { computeControlTotals } from "../validate";
import { MAX_POSTABLE_AMOUNT } from "../types";
import { makeCtx, makeLine } from "./helpers";

const ROOT = resolvePath(__dirname, "../../../../");
const HARDENING_SQL = readFileSync(
  resolvePath(ROOT, "supabase/migrations/20260721000004_bank_import_hardening.sql"), "utf8");
const POSTING_SQL = readFileSync(
  resolvePath(ROOT, "supabase/migrations/20260721000001_bank_import_posting_rpc.sql"), "utf8");
const UNDO_SQL = readFileSync(
  resolvePath(ROOT, "supabase/migrations/20260722000002_bank_import_undo_hardening.sql"), "utf8");
const TXSYNC_SQL = readFileSync(
  resolvePath(ROOT, "supabase/migrations/20260722000003_bank_import_transactions_sync.sql"), "utf8");

describe("roundAmount — ledger 2dp scale", () => {
  it("rounds to exactly two decimals", () => {
    expect(roundAmount(1.005)).toBe(1.01);
    expect(roundAmount(1.004)).toBe(1.0);
    expect(roundAmount(1234.567)).toBe(1234.57);
    expect(roundAmount(0.1 + 0.2)).toBe(0.3);
  });
  it("is idempotent", () => {
    for (const n of [1.005, 99.999, 0.001, 12345.678, 0]) {
      expect(roundAmount(roundAmount(n))).toBe(roundAmount(n));
    }
  });
  it("passes through non-finite unchanged", () => {
    expect(Number.isNaN(roundAmount(NaN))).toBe(true);
  });
});

describe("parser stores ledger-exact amounts", () => {
  it("rounds amounts at parse time so line and journal agree", () => {
    const matrix = [
      ["Date", "Description", "Account Type", "Debit", "Credit"],
      ["2024-05-02", "odd cents", "Salary", "100.005", ""],
      ["2024-05-03", "third", "Salary", "33.333", ""],
    ];
    const { lines } = parseSheetMatrix(matrix, "May 2024", { month: 5, year: 2024 });
    expect(lines[0].debit).toBe(100.01);
    expect(lines[1].debit).toBe(33.33);
    // Every stored amount must already be at 2dp — the DB CHECK enforces this.
    for (const l of lines) expect(l.debit).toBe(roundAmount(l.debit));
  });

  it("control totals over many odd-cent rows stay ledger-exact", () => {
    const header = [["Date", "Description", "Account Type", "Debit", "Credit"]];
    const rows = Array.from({ length: 500 }, (_, i) => [
      "2024-05-02", `row ${i}`, "Salary", String(10.005 + i / 1000), "",
    ]);
    const { lines } = parseSheetMatrix([...header, ...rows], "May 2024", { month: 5, year: 2024 });
    const totals = computeControlTotals(lines);
    // Sum of rounded values must equal the reported total to the cent.
    const manual = roundAmount(lines.reduce((s, l) => s + l.debit, 0));
    expect(totals.totalDebit).toBe(manual);
  });
});

describe("blocked: amount overflow", () => {
  it("blocks amounts at or above the NUMERIC(14,2) ceiling", () => {
    const r = classifyLine(makeLine({ debit: MAX_POSTABLE_AMOUNT, rawAccountType: "Salary" }), makeCtx());
    expect(r).toEqual({ kind: "blocked", reason: "amount_overflow" });
  });
  it("allows the largest postable amount just below it", () => {
    const ctx = makeCtx({ amountCeiling: MAX_POSTABLE_AMOUNT });
    const r = classifyLine(makeLine({ debit: 999_999_999_999.99, rawAccountType: "Salary" }), ctx);
    expect(r.kind).toBe("resolved");
  });
  it("overflow outranks a valid category (never posts truncated)", () => {
    const r = classifyLine(makeLine({ credit: 5e12, rawAccountType: "Salary" }), makeCtx());
    expect(r.kind).toBe("blocked");
  });
});

describe("suspense: future-dated lines", () => {
  it("routes a line dated after the cut-off to suspense", () => {
    const ctx = makeCtx({ maxDate: "2024-05-15" });
    const r = classifyLine(makeLine({ debit: 100, txnDate: "2024-05-20", rawAccountType: "Salary" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "future_date" });
  });
  it("accepts a line on the cut-off date itself", () => {
    const ctx = makeCtx({ maxDate: "2024-05-15" });
    const r = classifyLine(makeLine({ debit: 100, txnDate: "2024-05-15", rawAccountType: "Salary" }), ctx);
    expect(r.kind).toBe("resolved");
  });
  it("without maxDate the gate is inert (engine never reads the clock)", () => {
    const r = classifyLine(makeLine({ debit: 100, txnDate: "2024-05-20", rawAccountType: "Salary" }), makeCtx());
    expect(r.kind).toBe("resolved");
  });
});

// ─── Guards that live in SQL: assert they exist and cannot be quietly dropped ──
describe("database integrity guards are declared", () => {
  it("amount CHECK constraints pin sign, scale and ledger fit", () => {
    expect(HARDENING_SQL).toMatch(/bank_statement_lines_amounts_nonneg/);
    expect(HARDENING_SQL).toMatch(/bank_statement_lines_amounts_scale/);
    expect(HARDENING_SQL).toMatch(/bank_statement_lines_amounts_fit_ledger/);
    expect(HARDENING_SQL).toMatch(/debit = round\(debit, 2\)/);
  });

  it("posted lines and batches are immutable via BEFORE UPDATE OR DELETE triggers", () => {
    expect(HARDENING_SQL).toMatch(/BEFORE UPDATE OR DELETE ON public\.bank_statement_lines/);
    expect(HARDENING_SQL).toMatch(/BEFORE UPDATE OR DELETE ON public\.bank_statement_batches/);
    expect(HARDENING_SQL).toMatch(/IMMUTABLE_POSTED_LINE/);
    expect(HARDENING_SQL).toMatch(/IMMUTABLE_POSTED_BATCH/);
  });

  it("concurrent same-period imports are blocked by a partial unique index", () => {
    expect(HARDENING_SQL).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*uq_bank_statement_active_period[\s\S]*WHERE is_active/);
    expect(HARDENING_SQL).toMatch(/PERIOD_ALREADY_IMPORTED/);
  });

  it("the void path reverses rather than deletes, and demands a reason", () => {
    expect(HARDENING_SQL).toMatch(/void_bank_statement_batch/);
    expect(HARDENING_SQL).toMatch(/REASON_REQUIRED/);
    expect(HARDENING_SQL).toMatch(/jl\.credit, jl\.debit/);        // sides swapped
    expect(HARDENING_SQL).toMatch(/HAS_RECLASSIFICATIONS/);
    expect(HARDENING_SQL).not.toMatch(/DELETE FROM public\.journal_entries/);
  });

  it("posted-total reconciliation is exact, with no tolerance window", () => {
    expect(POSTING_SQL).toMatch(/POSTED_TOTAL_MISMATCH/);
    expect(POSTING_SQL).toMatch(/BATCH_NOT_BALANCED/);
    // A tolerance multiplier would mask the rounding drift this check exists for.
    expect(POSTING_SQL).not.toMatch(/0\.01 \* GREATEST/);
  });

  it("teaching binds the variant to a real account, atomically with clearing", () => {
    // The earlier implementation wrote a `cleared_<variant>` category with no
    // account behind it, so the variant returned to Suspense on the next run.
    expect(POSTING_SQL).toMatch(/p_teach_variant\s+TEXT DEFAULT NULL/);
    expect(POSTING_SQL).toMatch(/bank_category_canonical_map/);
    expect(POSTING_SQL).toMatch(/bank_category_account_map/);
    expect(POSTING_SQL).not.toMatch(/cleared_/);
    // Variants must be stored normalized, or they can never match on re-import.
    expect(POSTING_SQL).toMatch(/bank_normalize_text\(p_teach_variant\)/);
  });

  it("the SQL normalizer mirrors normalizeText (NFKC, case, whitespace, punctuation)", () => {
    const fn = POSTING_SQL.slice(POSTING_SQL.indexOf("FUNCTION public.bank_normalize_text"));
    expect(fn).toMatch(/normalize\(COALESCE\(p_input, ''\), NFKC\)/);
    expect(fn).toMatch(/lower\(/);
    expect(fn).toMatch(/'\\s\+', ' ', 'g'/);
    expect(fn).toMatch(/\[\.,;:!-\]\+\$/);
  });

  it("cross-tenant account and line guards are present in the posting RPC", () => {
    expect(POSTING_SQL).toMatch(/CROSS_TENANT_ACCOUNT/);
    expect(POSTING_SQL).toMatch(/CROSS_TENANT_LINE/);
  });

  it("undo (delete) is gated by closed-period, reconciliation and reclass guards", () => {
    // Deleting posted GL entries is only safe in an open, unreconciled state.
    const undo = UNDO_SQL.slice(UNDO_SQL.indexOf("FUNCTION public.undo_bank_statement_batch"));
    expect(undo).toMatch(/CLOSED_PERIOD/);
    expect(undo).toMatch(/RECONCILED/);
    expect(undo).toMatch(/HAS_RECLASSIFICATIONS/);
    // Reconciliation is detected through both link tables.
    expect(undo).toMatch(/bank_feed_transactions/);
    expect(undo).toMatch(/reconciliation_transactions/);
    // Only a posted batch may be undone.
    expect(undo).toMatch(/NOT_POSTED/);
  });

  it("reverse also refuses to post into a closed period", () => {
    const rev = UNDO_SQL.slice(UNDO_SQL.indexOf("FUNCTION public.void_bank_statement_batch"));
    expect(rev).toMatch(/CLOSED_PERIOD/);
    expect(rev).toMatch(/REASON_REQUIRED/);
    // Reverse keeps originals, so it swaps debit/credit rather than deleting.
    expect(rev).toMatch(/jl\.credit, jl\.debit/);
    expect(rev).not.toMatch(/DELETE FROM public\.journal_entries/);
  });

  it("undo deletes statement lines before their referenced journal entries", () => {
    // The lines FK-reference journal_entries with no cascade; wrong order aborts.
    const undo = UNDO_SQL.slice(UNDO_SQL.indexOf("FUNCTION public.undo_bank_statement_batch"));
    const lineDel = undo.indexOf("DELETE FROM public.bank_statement_lines");
    const jeDel = undo.indexOf("DELETE FROM public.journal_entries");
    expect(lineDel).toBeGreaterThan(-1);
    expect(jeDel).toBeGreaterThan(lineDel);
  });

  it("undo rebuilds the budget cache after deleting entries", () => {
    const undo = UNDO_SQL.slice(UNDO_SQL.indexOf("FUNCTION public.undo_bank_statement_batch"));
    expect(undo).toMatch(/recalc_budget_consumption/);
  });

  it("bank imports feed the transactions cash-flow table, driven by batch status", () => {
    // The legacy per-entry trigger can't see bulk-inserted lines; the sync is
    // driven off the batch status transition instead, after lines exist.
    expect(TXSYNC_SQL).toMatch(/AFTER UPDATE OF status ON public\.bank_statement_batches/);
    expect(TXSYNC_SQL).toMatch(/status = 'posted' AND OLD\.status = 'processing'/);
    // Reverse / undo remove the cash-flow rows again.
    expect(TXSYNC_SQL).toMatch(/status IN \('superseded', 'undone'\)/);
    // Only posted entries sync (drafts excluded).
    expect(TXSYNC_SQL).toMatch(/je\.status = 'posted'/);
    // Income recognised on Income/Other Income (the legacy 'Revenue' check missed it).
    expect(TXSYNC_SQL).toMatch(/'Income','Other Income'/);
    // Only the category side, never the bank line.
    expect(TXSYNC_SQL).toMatch(/jl\.account_id <> v_bank/);
  });

  it("clearing a suspense item moves its cash-flow row without double-counting", () => {
    expect(TXSYNC_SQL).toMatch(/AFTER UPDATE OF reclass_journal_entry_id ON public\.bank_statement_lines/);
    // Rebuild = delete the old row then insert from the final account.
    const fn = TXSYNC_SQL.slice(TXSYNC_SQL.indexOf("trg_bank_line_reclass_sync"));
    expect(fn).toMatch(/DELETE FROM public\.transactions/);
    // A non-income/expense final account (e.g. a fixed asset) drops from cash flow.
    expect(fn).toMatch(/account_subtype, ''\) <> 'Suspense'/);
  });

  it("the legacy per-entry sync is suppressed during bulk import", () => {
    expect(TXSYNC_SQL).toMatch(/current_setting\('app\.bank_import_bulk', true\) = '1'/);
  });

  it("privileged RPCs are not callable directly by end users", () => {
    expect(POSTING_SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.import_bank_statement_post[\s\S]*authenticated/);
    expect(HARDENING_SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.claim_bank_statement_periods[\s\S]*authenticated/);
  });

  it("every new SECURITY DEFINER function pins search_path", () => {
    const defs = HARDENING_SQL.split("CREATE OR REPLACE FUNCTION").slice(1);
    const definers = defs.filter((d) => /SECURITY DEFINER/.test(d));
    expect(definers.length).toBeGreaterThan(0);
    for (const d of definers) expect(d).toMatch(/SET search_path = public/);
  });
});
