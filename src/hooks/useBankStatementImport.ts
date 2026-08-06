// ─────────────────────────────────────────────────────────────────────────────
// useBankStatementImport.ts
// Client hooks for the bank statement import pipeline: file upload to the
// private `bank-statements` bucket, invoking the import-bank-statement edge
// function, and the Suspense Clearing surface.
//
// The client parses the workbook with SheetJS only for the upload preview and
// per-sheet period confirmation. The SERVER re-parses the file for posting —
// client-computed rows are never trusted.
// ─────────────────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  normalizeText,
  parseSheetMatrix,
  type ParsedLine,
} from "@/lib/bankCategorization";

const MONTH_LABELS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const periodLabelOf = (p: { year: number; month: number }) => `${MONTH_LABELS[p.month]} ${p.year}`;

const BUCKET = "bank-statements";

// Guard rails mirrored from the edge function; enforced there too.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ROWS_PER_MONTH = 20_000;
export const MAX_SHEETS = 36;

export interface PeriodPreview {
  year: number;
  month: number;
  row_count: number;      // datable, includable rows in this month
  excluded_count: number; // B/F rows in this month
  too_big: boolean;
}

export interface WorkbookPreview {
  file: File;
  periods: PeriodPreview[];
  total_rows: number;
  dated_count: number;        // rows placed into a month (posted on import)
  excluded_count: number;     // B/F / opening-balance rows (never posted)
  undated_count: number;      // rows with no usable date (held for review)
  forward_filled_count: number; // blank-date rows that inherited the day above
  forward_filled_samples: string[]; // e.g. "May 2024 row 42" — go verify in Excel
  unparseable_date_samples: string[]; // sample raw date cells no format matched
  sheet_count: number;
  errors: string[];
}

/**
 * Parse a workbook in the browser for the preview, grouping rows by the MONTH
 * of their transaction date (across every sheet). A bank's whole-year file is
 * one giant sheet; the dates — not the sheet layout — drive the monthly chunks
 * that get imported. Undated/corrupt rows are counted separately (they are held
 * on import, folded into the earliest month).
 */
export async function previewWorkbook(file: File): Promise<WorkbookPreview> {
  const buf = await file.arrayBuffer();
  // `dense` keeps a tall sheet as row arrays rather than one object per cell
  // address — roughly a third off the parse peak on a 30k-row workbook. The
  // browser has more headroom than the edge runtime, but the preview parses
  // the same file, so it pays the same cost.
  const wb = XLSX.read(buf, { type: "array", cellDates: true, dense: true });
  const byPeriod = new Map<string, PeriodPreview>();
  const errors: string[] = [];
  let total = 0;
  let dated = 0;
  let excluded = 0;
  let undated = 0;
  let forwardFilled = 0;
  let sheetCount = 0;
  const forwardFilledSamples: string[] = [];
  const unparseableSamples: string[] = [];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
    const nonEmpty = matrix.some((r) => (r ?? []).some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
    if (!nonEmpty) continue;
    sheetCount++;
    // The declared period is irrelevant here — we regroup by each row's own date.
    const result = parseSheetMatrix(matrix, name, { month: 1, year: 2000 });
    errors.push(...result.errors);
    for (const line of result.lines as ParsedLine[]) {
      total++;
      if (line.parseFlags.includes("date_forward_filled")) {
        forwardFilled++;
        if (forwardFilledSamples.length < 10) forwardFilledSamples.push(`${line.sheetName} row ${line.rowIndex}`);
      }
      if (line.parseFlags.includes("unparseable_date") && unparseableSamples.length < 8 && line.rawDate) {
        if (!unparseableSamples.includes(line.rawDate)) unparseableSamples.push(line.rawDate);
      }
      if (!line.txnDate) { undated++; continue; }
      const [y, m] = line.txnDate.split("-").map(Number);
      const key = `${y}-${m}`;
      const p = byPeriod.get(key) ?? { year: y, month: m, row_count: 0, excluded_count: 0, too_big: false };
      if (line.isExcluded) { p.excluded_count++; excluded++; } else { p.row_count++; dated++; }
      byPeriod.set(key, p);
    }
  }

  const periods = [...byPeriod.values()]
    .map((p) => ({ ...p, too_big: p.row_count > MAX_ROWS_PER_MONTH }))
    .sort((a, b) => a.year - b.year || a.month - b.month);

  return {
    file, periods, total_rows: total,
    dated_count: dated, excluded_count: excluded, undated_count: undated,
    forward_filled_count: forwardFilled, forward_filled_samples: forwardFilledSamples,
    unparseable_date_samples: unparseableSamples,
    sheet_count: sheetCount, errors,
  };
}

/** What posted vs the figure the sheet printed at its own bottom. */
export interface TotalsReconciliation {
  computedDebit: number;
  computedCredit: number;
  declaredDebit: number | null;
  declaredCredit: number | null;
  debitMatches: boolean;
  creditMatches: boolean;
  matched: boolean;
}

/**
 * Rows a single edge invocation may post.
 *
 * The binding limit is CPU, not memory or wall clock: Supabase kills the worker
 * with "CPU Time exceeded" (HTTP 546) at roughly 2s of CPU **accumulated across
 * the whole request**. Reading the workbook is a fixed ~80% of the engine's CPU
 * and is paid again on every invocation, so the budget left for posting is the
 * scarce part. A 32,930-row single-sheet file died mid-way through its 7th
 * month for exactly this reason.
 *
 * Keeping the posted rows per call under this bound leaves comfortable headroom
 * for the re-read. It is deliberately conservative — a chunk too small only
 * costs one extra file read, while a chunk too large loses the whole call.
 */
export const MAX_ROWS_PER_CALL = 5_000;
/**
 * Backstop on months per call, independent of row count: each month costs a
 * batch insert, a period claim and a posting RPC, so the round trips add CPU
 * of their own. Set to a full year because that is the shape already proven in
 * production — a 12-month, 2,079-row workbook posts in one invocation well
 * inside budget — and lowering it would make ordinary imports pay extra
 * workbook re-reads for no benefit.
 */
export const MAX_MONTHS_PER_CALL = 12;

export interface PlannedPeriod {
  year: number;
  month: number;
  /** Present when planning from a preview; absent callers get one month/call. */
  row_count?: number;
}

/**
 * Greedily pack consecutive months into as few invocations as possible while
 * respecting {@link MAX_ROWS_PER_CALL}. Fewer chunks means fewer workbook
 * re-reads, so packing (rather than one-month-per-call) is the cheap path for
 * ordinary files: a 2,000-row year stays a single invocation exactly as before,
 * while a 33k-row year becomes several bounded ones.
 *
 * Exported for tests — the packing is the safety property, so it is asserted
 * directly rather than inferred from an import run.
 */
export function planImportChunks<T extends PlannedPeriod>(periods: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let rows = 0;
  for (const p of periods) {
    // An unknown row count is treated as a full budget: without the preview's
    // numbers we cannot prove a bigger chunk is safe, so we don't guess.
    const n = Number.isFinite(p.row_count) ? Number(p.row_count) : MAX_ROWS_PER_CALL;
    // A single month over budget still has to go in a call of its own; the
    // server splits nothing further, and one month is the atomic unit.
    if (current.length > 0 && (rows + n > MAX_ROWS_PER_CALL || current.length >= MAX_MONTHS_PER_CALL)) {
      chunks.push(current);
      current = [];
      rows = 0;
    }
    current.push(p);
    rows += n;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Version of the row-extract payload; must match the edge function's. */
export const EXTRACT_VERSION = 1;

export interface SheetExtract { name: string; rows: unknown[][] }
export interface WorkbookExtract { v: number; sheets: SheetExtract[] }

/**
 * A Date cell serialised for transport.
 *
 * `JSON.stringify(new Date(...))` emits `toISOString()`, which converts to UTC.
 * SheetJS builds date cells in LOCAL time, so a statement dated 01/05/2024 in a
 * UTC+5:30 browser would serialise as `2024-04-30T18:30:00Z` and import into the
 * WRONG MONTH — silently, and only for users east of UTC. Emitting the local
 * calendar date keeps the day the spreadsheet actually shows.
 */
export function serialiseDateCell(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Extract every sheet as a raw cell matrix, in the browser.
 *
 * A large .xlsx cannot be decoded inside an edge function: SheetJS exceeded
 * BOTH the memory and the CPU limit on a 32,930-row workbook, and the cost is
 * re-paid on every invocation, so chunking does not help. The browser has no
 * such caps. Only untyped cell values cross the wire — the server still does
 * all column detection, date parsing, categorisation, validation and posting.
 */
export function extractWorkbook(wb: XLSX.WorkBook): WorkbookExtract {
  const sheets: SheetExtract[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
    const nonEmpty = rows.some((r) => (r ?? []).some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
    if (!nonEmpty) continue;
    for (const row of rows) {
      if (!row) continue;
      for (let i = 0; i < row.length; i++) {
        if (row[i] instanceof Date) row[i] = serialiseDateCell(row[i] as Date);
      }
    }
    sheets.push({ name, rows });
  }
  return { v: EXTRACT_VERSION, sheets };
}

export interface SheetResult {
  sheet_name: string;
  ok: boolean;
  batch_id?: string;
  error?: string;
  summary?: Record<string, unknown>;
  control_totals?: Record<string, number>;
  duplicates?: { key: string; rowRefs: { sheetName: string; rowIndex: number }[] }[];
  balance_discontinuities?: { sheetName: string; rowIndex: number; expected: number; actual: number }[];
  totals_rows?: { sheetName: string; rowIndex: number; debit: number; credit: number }[];
  reconciliation?: TotalsReconciliation;
}

export interface ImportResult {
  engine_version?: string;
  sheets: SheetResult[];
  posted_sheets: number;
  failed_sheets: number;
  totals: {
    posted_to_ledger_count: number;
    posted_to_ledger_value: number;
    posted_to_generated_count: number;
    posted_to_generated_value: number;
    posted_to_suspense_count: number;
    posted_to_suspense_value: number;
    blocked_count: number;
    excluded_count: number;
    suspense_reasons: Record<string, number>;
  };
}

export interface ImportProgress {
  done: number;
  total: number;
  current: string;
}

/**
 * Imports a whole workbook in ONE server call. The edge function downloads and
 * parses the file ONCE, groups rows by their own transaction month, and posts
 * EACH month as its own atomic batch. A month that fails leaves the others
 * posted and independently re-runnable — parsing once (vs the old call-per-month
 * design) removes the repeated ~200 MB parse peak and the 12× file download,
 * which is what makes 50k–60k-row statements safe.
 */
export function useImportBankStatement(onProgress?: (p: ImportProgress) => void) {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      file: File;
      bank_account_id: string;
      periods: PeriodPreview[] | { year: number; month: number }[];
      posting_mode?: "auto_post" | "draft";
    }): Promise<ImportResult> => {
      const tenant_id = appUser?.tenant_id;
      if (!tenant_id) throw new Error("No tenant");
      if (params.file.size > MAX_FILE_BYTES) {
        throw new Error(
          `Workbook is ${(params.file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB.`
        );
      }
      if (params.periods.length > MAX_SHEETS) {
        throw new Error(`${params.periods.length} months in the file; the limit is ${MAX_SHEETS}.`);
      }

      const periods = [...params.periods].sort((a, b) => a.year - b.year || a.month - b.month);
      const chunks = planImportChunks(periods);

      // Upload the original workbook — it stays the audit record, and a
      // reviewer can always re-derive the extract from it.
      const safe = params.file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const stamp = Date.now();
      const storage_path = `${tenant_id}/${stamp}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(storage_path, params.file, {
          contentType: params.file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: false,
        });
      if (upErr) throw upErr;

      // Decode the workbook HERE, where there is no CPU or memory cap, and
      // upload the raw cell matrices for the server to parse. Every invocation
      // then reads cheap JSON instead of re-decoding the .xlsx.
      onProgress?.({ done: 0, total: periods.length, current: "Preparing rows…" });
      const extract_path = `${tenant_id}/${stamp}-${safe}.extract.json`;
      {
        const wb = XLSX.read(await params.file.arrayBuffer(), {
          type: "array", cellDates: true, dense: true, cellText: false, cellHTML: false,
        });
        const blob = new Blob([JSON.stringify(extractWorkbook(wb))], { type: "application/json" });
        const { error: exErr } = await supabase.storage
          .from(BUCKET).upload(extract_path, blob, { contentType: "application/json", upsert: false });
        if (exErr) throw exErr;
      }

      // One invocation per chunk. Each is independent and atomic per month, so
      // a chunk that fails leaves every other month posted and re-runnable —
      // and no single invocation can exhaust the edge runtime's CPU budget.
      const sheets: SheetResult[] = [];
      let engine_version: string | undefined;
      let posted = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        onProgress?.({
          done: posted,
          total: periods.length,
          current: chunks.length > 1
            ? `Posting ${periodLabelOf(chunk[0])}${chunk.length > 1 ? `–${periodLabelOf(chunk[chunk.length - 1])}` : ""} (${i + 1}/${chunks.length})…`
            : "Parsing & posting all months…",
        });

        let d: any;
        try {
          const { data, error } = await supabase.functions.invoke("import-bank-statement", {
            body: {
              storage_path,
              extract_path,
              bank_account_id: params.bank_account_id,
              periods: chunk.map((p) => ({ year: p.year, month: p.month })),
              // Rows with no usable date belong to the whole import, not to a
              // chunk, so only the FIRST call adopts them. Sending this on
              // every chunk re-imports them once per call.
              include_undated: i === 0,
              posting_mode: params.posting_mode,
            },
          });
          if (error) throw new Error(error.message);
          d = data;
        } catch (e) {
          // A chunk that dies (worker killed => no response body) must not
          // abandon the rest; report its months and carry on.
          const msg = e instanceof Error ? e.message : String(e);
          for (const p of chunk) {
            sheets.push({ sheet_name: periodLabelOf(p), ok: false, error: msg });
          }
          continue;
        }

        if (d?.ok === false && !Array.isArray(d?.months)) {
          // A whole-request failure (config/parse/auth) before any month ran.
          const msg = d?.error || d?.parse_errors?.join("; ") || "Import failed";
          // Configuration errors will fail identically for every chunk — stop.
          if (i === 0) throw new Error(msg);
          for (const p of chunk) sheets.push({ sheet_name: periodLabelOf(p), ok: false, error: msg });
          continue;
        }

        engine_version = d?.engine_version ?? engine_version;
        for (const mo of (d?.months ?? []) as any[]) {
          sheets.push({
            sheet_name: mo.sheet_name,
            ok: !!mo.ok,
            batch_id: mo.batch_id,
            error: mo.ok ? undefined : (mo.error || "Import failed"),
            summary: mo.summary,
            control_totals: mo.control_totals,
            duplicates: mo.duplicates,
            balance_discontinuities: mo.balance_discontinuities,
            totals_rows: mo.totals_rows,
            reconciliation: mo.reconciliation,
          });
        }
        posted += chunk.length;
      }
      const d = { engine_version } as any;

      const totals: ImportResult["totals"] = {
        posted_to_ledger_count: 0, posted_to_ledger_value: 0,
        posted_to_generated_count: 0, posted_to_generated_value: 0,
        posted_to_suspense_count: 0, posted_to_suspense_value: 0,
        blocked_count: 0, excluded_count: 0, suspense_reasons: {},
      };
      for (const res of sheets) {
        if (!res.ok || !res.summary) continue;
        const s = res.summary as any;
        totals.posted_to_ledger_count += Number(s.posted_to_ledger_count ?? 0);
        totals.posted_to_ledger_value += Number(s.posted_to_ledger_value ?? 0);
        totals.posted_to_generated_count += Number(s.posted_to_generated_count ?? 0);
        totals.posted_to_generated_value += Number(s.posted_to_generated_value ?? 0);
        totals.posted_to_suspense_count += Number(s.posted_to_suspense_count ?? 0);
        totals.posted_to_suspense_value += Number(s.posted_to_suspense_value ?? 0);
        totals.blocked_count += Number(s.blocked_count ?? 0);
        totals.excluded_count += Number(s.excluded_count ?? 0);
        for (const [k, v] of Object.entries((s.suspense_reasons ?? {}) as Record<string, number>)) {
          totals.suspense_reasons[k] = (totals.suspense_reasons[k] ?? 0) + Number(v);
        }
      }
      onProgress?.({ done: periods.length || 1, total: periods.length || 1, current: "" });

      return {
        engine_version: d?.engine_version,
        sheets,
        posted_sheets: sheets.filter((s) => s.ok).length,
        failed_sheets: sheets.filter((s) => !s.ok).length,
        totals,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank_statement_batches"] });
      qc.invalidateQueries({ queryKey: ["suspense_lines"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Suspense Clearing ────────────────────────────────────────────────────────

export interface SuspenseLine {
  id: string;
  batch_id: string;
  sheet_name: string;
  txn_date: string | null;
  description: string;
  name: string;
  canonical_category: string | null;
  raw_account_type: string;
  debit: number;
  credit: number;
  suspense_reason: string | null;
  suggestions: { accountId: string; label: string; source: string }[];
  created_at: string;
}

export function useSuspenseLines() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["suspense_lines", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    // The list is only invalidated by import/clear mutations, so serve it from
    // cache when the user navigates back instead of re-fetching (and flashing
    // the loading state) on every remount. Key is tenant-scoped, so this is safe.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // New tables are not yet in the generated Supabase types (regenerate with
      // `supabase gen types` after the migration lands); cast until then.
      const { data, error } = await (supabase as any)
        .from("bank_statement_lines")
        .select("id, batch_id, sheet_name, txn_date, description, name, canonical_category, raw_account_type, debit, credit, suspense_reason, suggestions, created_at")
        .eq("needs_reclassification", true)
        .order("txn_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SuspenseLine[];
    },
  });
}

/** Clear suspense items to a final account. When `teach_variant` is supplied
 * the engine also learns that raw account_type → the chosen account, so the
 * same text resolves at Tier 1 next import. Both happen in one transaction. */
export function useClearSuspense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      line_ids: string[];
      target_account_id: string;
      note?: string;
      teach_variant?: string;
    }) => {
      const { data, error } = await (supabase as any).rpc("clear_suspense_lines", {
        p_line_ids: params.line_ids,
        p_target_account_id: params.target_account_id,
        p_note: params.note ?? null,
        p_teach_variant: params.teach_variant ?? null,
      });
      if (error) throw new Error(error.message);
      return data as { cleared: number; taught: boolean; taught_category: string | null };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["suspense_lines"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
      qc.invalidateQueries({ queryKey: ["bank_category_account_map"] });
      toast.success(
        `Cleared ${data?.cleared ?? 0} item(s) from Suspense` +
          (data?.taught ? " · engine will resolve this variant automatically next time" : "")
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Held rows (blocked, never posted) ───────────────────────────────────────

/** Why a row was refused. Kept in sync with the engine's BlockReason. */
export const BLOCK_REASON_LABELS: Record<string, { title: string; detail: string }> = {
  totals_row: {
    title: "Total / subtotal row",
    detail: "Carried an amount but no date, description, name, voucher or account type — the shape of a spreadsheet footer, not a transaction. Posting it would double-count the rows above it.",
  },
  both_sides_populated: {
    title: "Debit and credit both filled",
    detail: "A statement line moves money one way. With both columns filled the direction is ambiguous, so it cannot be posted.",
  },
  no_amount: {
    title: "No amount",
    detail: "Neither the debit nor the credit column held a value, so there is nothing to post. Usually a blank or separator row.",
  },
  invalid_amount: {
    title: "Invalid amount",
    detail: "The amount was negative or not a number.",
  },
  amount_overflow: {
    title: "Amount too large",
    detail: "Above the ledger's numeric limit; posting it would silently truncate the figure.",
  },
  unparseable_date: {
    title: "Unreadable date",
    detail: "The date cell could not be read in any recognised format, so the row cannot be placed in an accounting period.",
  },
};

export interface HeldLine {
  id: string;
  batch_id: string;
  sheet_name: string;
  row_index: number;
  period_year: number | null;
  period_month: number | null;
  txn_date: string | null;
  raw_date: string | null;
  description: string;
  name: string;
  voucher_no: string | null;
  raw_account_type: string;
  debit: number;
  credit: number;
  block_reason: string;
  validation_flags: string[];
  created_at: string;
  file_name: string | null;
  bank_account_id: string | null;
}

/**
 * Every row an import refused to post, straight from the database.
 *
 * The post-import summary screen is in-memory React state and disappears on
 * refresh or navigation; these rows are the durable record, so the count still
 * reconciles (`to ledgers + suspense + held = rows imported`) long after.
 */
export function useHeldLines() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["held_lines", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async (): Promise<HeldLine[]> => {
      // A plain .select() silently stops at 1000 rows; page explicitly so a
      // large import never appears to have fewer held rows than it has.
      const PAGE = 1000;
      const out: HeldLine[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from("bank_statement_lines")
          .select(
            "id, batch_id, sheet_name, row_index, period_year, period_month, txn_date, raw_date, description, name, voucher_no, raw_account_type, debit, credit, block_reason, validation_flags, created_at, bank_statement_batches(file_name, bank_account_id)"
          )
          .not("block_reason", "is", null)
          .order("created_at", { ascending: false })
          .order("sheet_name", { ascending: true })
          .order("row_index", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as any[];
        for (const r of rows) {
          out.push({
            ...r,
            debit: Number(r.debit ?? 0),
            credit: Number(r.credit ?? 0),
            validation_flags: r.validation_flags ?? [],
            file_name: r.bank_statement_batches?.file_name ?? null,
            bank_account_id: r.bank_statement_batches?.bank_account_id ?? null,
          });
        }
        if (rows.length < PAGE) break;
      }
      return out;
    },
  });
}

// ─── Tier-2 rules: exact description/name → account ──────────────────────────
// These cover the rows that carry no Account Type at all (cash deposits,
// transfers, customer deposits …). Without a rule they can only reach Suspense.

export interface CategorizationRuleRow {
  id: string;
  match_field: "description" | "name";
  match_value: string;
  account_id: string;
  expected_side: "debit" | "credit" | "either";
  priority: number;
  is_active: boolean;
  created_at: string;
}

export function useCategorizationRules() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["bank_categorization_rules", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bank_categorization_rules")
        .select("id, match_field, match_value, account_id, expected_side, priority, is_active, created_at")
        .order("priority")
        .order("match_value");
      if (error) throw error;
      return (data ?? []) as CategorizationRuleRow[];
    },
  });
}

export function useUpsertCategorizationRule() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: {
      id?: string;
      match_field: "description" | "name";
      match_value: string;
      account_id: string;
      expected_side: "debit" | "credit" | "either";
      priority: number;
      is_active?: boolean;
    }) => {
      const tenant_id = appUser?.tenant_id;
      if (!tenant_id) throw new Error("No tenant");
      // Match values are compared against normalized text, so store them
      // normalized — an un-normalized rule would silently never fire.
      const match_value = normalizeText(rule.match_value);
      if (!match_value) throw new Error("Match text is required");
      const payload = {
        tenant_id,
        match_type: "exact",
        match_field: rule.match_field,
        match_value,
        account_id: rule.account_id,
        expected_side: rule.expected_side,
        priority: rule.priority,
        is_active: rule.is_active ?? true,
        created_by: appUser?.id,
      };
      const q = rule.id
        ? (supabase as any).from("bank_categorization_rules").update(payload).eq("id", rule.id)
        : (supabase as any).from("bank_categorization_rules").insert(payload);
      const { error } = await q;
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank_categorization_rules"] });
      toast.success("Rule saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCategorizationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("bank_categorization_rules").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bank_categorization_rules"] });
      toast.success("Rule deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Unmatched descriptions from open suspense items, ranked by frequency and
 * value — the shortlist of rules worth creating next. */
export function useSuggestedRuleCandidates() {
  const { data: lines } = useSuspenseLines();
  return (lines ?? [])
    .filter((l) => l.suspense_reason === "no_category_no_rule")
    .reduce((acc, l) => {
      const key = normalizeText(l.description) || normalizeText(l.name);
      if (!key) return acc;
      const hit = acc.find((c) => c.match_value === key);
      const amt = Number(l.debit || 0) + Number(l.credit || 0);
      const side: "debit" | "credit" = Number(l.debit || 0) > 0 ? "debit" : "credit";
      if (hit) {
        hit.count++;
        hit.value += amt;
        if (hit.side !== side) hit.side = "either";
      } else {
        acc.push({ match_value: key, count: 1, value: amt, side });
      }
      return acc;
    }, [] as { match_value: string; count: number; value: number; side: "debit" | "credit" | "either" }[])
    .sort((a, b) => b.count - a.count || b.value - a.value);
}

/** One-click provisioning of the standard bank-import chart of accounts:
 * creates missing accounts, wires every canonical category to its ledger
 * account, and sets the two directional Unrecognized accounts. Idempotent. */
export function useSetupBankImportChart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("setup_bank_import_chart");
      if (error) throw new Error(error.message);
      return data as {
        accounts_created: number;
        categories_mapped: number;
        unrecognized_deposit_account_id: string;
        unrecognized_payment_account_id: string;
      };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["account_settings"] });
      qc.invalidateQueries({ queryKey: ["account_settings_completeness"] });
      toast.success(
        `Chart ready — ${data.accounts_created} account(s) created, ${data.categories_mapped} categor(ies) mapped`
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface BankImportRefs {
  /** journal_entry_id → statement payee (the Name column). */
  payee: Map<string, string>;
  /** journal_entry_id → cheque number (stored in voucher_no). */
  cheque: Map<string, string>;
}

/** Per-entry payee and cheque-number lookups for bank imports, so ledgers can
 * show dedicated Payee and Cheque No columns. Covers both the original posting
 * entry and any suspense-clearing reclass entry. */
export function useBankImportRefs() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["bank_import_refs", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async (): Promise<BankImportRefs> => {
      const { data, error } = await (supabase as any)
        .from("bank_statement_lines")
        .select("journal_entry_id, reclass_journal_entry_id, name, voucher_no");
      if (error) throw error;
      const payee = new Map<string, string>();
      const cheque = new Map<string, string>();
      for (const r of (data ?? []) as {
        journal_entry_id: string | null; reclass_journal_entry_id: string | null;
        name: string | null; voucher_no: string | null;
      }[]) {
        const nm = (r.name ?? "").trim();
        const chq = (r.voucher_no ?? "").trim();
        for (const id of [r.journal_entry_id, r.reclass_journal_entry_id]) {
          if (!id) continue;
          if (nm) payee.set(id, nm);
          if (chq) cheque.set(id, chq);
        }
      }
      return { payee, cheque };
    },
  });
}

/** @deprecated use {@link useBankImportRefs}. Kept for the payee-only callers. */
export function useBankImportPayees() {
  const q = useBankImportRefs();
  return { ...q, data: q.data?.payee } as typeof q & { data: Map<string, string> | undefined };
}

export interface VerifyCheck { name: string; ok: boolean; detail: string }
export interface VerifyReport {
  ok: boolean;
  batch_id: string;
  status: string;
  counts: {
    rows_expected: number; lines_in_db: number; excluded: number; blocked: number;
    posted_to_ledger: number; posted_to_suspense: number;
    journal_entries: number; journal_lines: number; transactions: number;
  };
  totals: { debit: number; credit: number; balanced: boolean };
  checks: VerifyCheck[];
  verified_at: string;
}

/** Independently re-reads the database and confirms an import actually persisted
 * — a per-check pass/fail report. Read-only; safe to run any time. */
export function useVerifyBankBatch() {
  return useMutation({
    mutationFn: async (batchId: string): Promise<VerifyReport> => {
      const { data, error } = await (supabase as any).rpc("verify_bank_import_batch", { p_batch_id: batchId });
      if (error) throw new Error(error.message);
      return data as VerifyReport;
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface BatchRow {
  id: string;
  bank_account_id: string;
  file_name: string | null;
  sheet_periods: { sheet_name: string; month: number; year: number }[];
  status: "processing" | "posted" | "failed" | "superseded" | "undone";
  posting_mode: string | null;
  total_debit: number;
  total_credit: number;
  row_count: number;
  summary: Record<string, unknown> | null;
  void_kind: "reversed" | "deleted" | null;
  void_reason: string | null;
  voided_at: string | null;
  error_message: string | null;
  engine_version: string | null;
  created_at: string;
  posted_at: string | null;
}

export function useBankStatementBatches() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["bank_statement_batches", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bank_statement_batches")
        .select("id, bank_account_id, file_name, sheet_periods, status, posting_mode, total_debit, total_credit, row_count, summary, void_kind, void_reason, voided_at, error_message, engine_version, created_at, posted_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as BatchRow[];
    },
  });
}

/** Undo an import — DELETES the journal entries and statement lines it created,
 * releasing the period. The batch row is kept as a history record. Refused if
 * any suspense item was already cleared (use reverse there). */
export function useUndoBankImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { batch_id: string; reason?: string }) => {
      const { data, error } = await (supabase as any).rpc("undo_bank_statement_batch", {
        p_batch_id: params.batch_id,
        p_reason: params.reason ?? null,
      });
      if (error) throw new Error(error.message);
      return data as { journal_entries_deleted: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["bank_statement_batches"] });
      qc.invalidateQueries({ queryKey: ["suspense_lines"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success(`Import undone — ${data?.journal_entries_deleted ?? 0} entr(ies) deleted`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Reverse an import — posts mirror journal entries (originals kept), for when
 * an import can no longer be cleanly deleted. Requires a reason. */
export function useVoidBankImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { batch_id: string; reason: string }) => {
      const { data, error } = await (supabase as any).rpc("void_bank_statement_batch", {
        p_batch_id: params.batch_id,
        p_reason: params.reason,
      });
      if (error) throw new Error(error.message);
      return data as { entries_reversed: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["bank_statement_batches"] });
      qc.invalidateQueries({ queryKey: ["suspense_lines"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success(`Import reversed — ${data?.entries_reversed ?? 0} reversal entr(ies) posted`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
