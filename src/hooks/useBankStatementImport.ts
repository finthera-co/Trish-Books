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
  parseSheetPeriod,
  type ParsedLine,
} from "@/lib/bankCategorization";

const BUCKET = "bank-statements";

// Guard rails mirrored from the edge function; enforced there too.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ROWS_PER_SHEET = 10_000;
export const MAX_SHEETS = 36;

export interface SheetPreview {
  sheet_name: string;
  month: number;
  year: number;
  row_count: number;
  excluded_count: number;
  header_ok: boolean;
  error?: string;
}

export interface WorkbookPreview {
  file: File;
  sheets: SheetPreview[];
}

/** Parse a workbook in the browser for the preview + per-sheet period confirm. */
export async function previewWorkbook(file: File): Promise<WorkbookPreview> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheets: SheetPreview[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
    const nonEmpty = matrix.some((r) => (r ?? []).some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
    if (!nonEmpty) continue;
    const guess = parseSheetPeriod(name);
    const period = guess ?? { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
    const result = parseSheetMatrix(matrix, name, period);
    const included = result.lines.filter((l: ParsedLine) => !l.isExcluded).length;
    const excluded = result.lines.length - included;
    const tooBig = matrix.length > MAX_ROWS_PER_SHEET;
    sheets.push({
      sheet_name: name,
      month: period.month,
      year: period.year,
      row_count: included,
      excluded_count: excluded,
      header_ok: result.errors.length === 0 && !tooBig,
      error: tooBig
        ? `${matrix.length} rows exceeds the ${MAX_ROWS_PER_SHEET}-row per-sheet limit`
        : result.errors[0],
    });
  }
  return { file, sheets };
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
}

export interface ImportResult {
  engine_version?: string;
  sheets: SheetResult[];
  posted_sheets: number;
  failed_sheets: number;
  totals: {
    posted_to_ledger_count: number;
    posted_to_ledger_value: number;
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
 * Imports a workbook one SHEET AT A TIME.
 *
 * Posting cost is superlinear in batch size (1k rows ≈ 0.5s, 33k ≈ 60s), and a
 * whole-workbook pass also holds the entire file in memory server-side. Each
 * monthly sheet is therefore its own atomic batch: ~2s each, bounded memory,
 * and a month that fails leaves the others posted and independently re-runnable.
 */
export function useImportBankStatement(onProgress?: (p: ImportProgress) => void) {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      file: File;
      bank_account_id: string;
      sheet_periods: { sheet_name: string; month: number; year: number }[];
      posting_mode?: "auto_post" | "draft";
    }): Promise<ImportResult> => {
      const tenant_id = appUser?.tenant_id;
      if (!tenant_id) throw new Error("No tenant");
      if (params.file.size > MAX_FILE_BYTES) {
        throw new Error(
          `Workbook is ${(params.file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB.`
        );
      }
      if (params.sheet_periods.length > MAX_SHEETS) {
        throw new Error(`${params.sheet_periods.length} sheets selected; the limit is ${MAX_SHEETS}.`);
      }

      // Upload once; every per-sheet call re-reads it server-side.
      const safe = params.file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const storage_path = `${tenant_id}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(storage_path, params.file, {
          contentType: params.file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          upsert: false,
        });
      if (upErr) throw upErr;

      const sheets: SheetResult[] = [];
      const totals: ImportResult["totals"] = {
        posted_to_ledger_count: 0, posted_to_ledger_value: 0,
        posted_to_suspense_count: 0, posted_to_suspense_value: 0,
        blocked_count: 0, excluded_count: 0, suspense_reasons: {},
      };
      let engine_version: string | undefined;

      // Sequential on purpose: each month claims its period and posts inside a
      // transaction. Running them in parallel would just contend on the same
      // tables for no wall-clock win.
      for (let i = 0; i < params.sheet_periods.length; i++) {
        const sp = params.sheet_periods[i];
        onProgress?.({ done: i, total: params.sheet_periods.length, current: sp.sheet_name });

        let res: SheetResult;
        try {
          const { data, error } = await supabase.functions.invoke("import-bank-statement", {
            body: {
              storage_path,
              bank_account_id: params.bank_account_id,
              sheet: sp,
              posting_mode: params.posting_mode,
            },
          });
          if (error) throw new Error(error.message);
          const d = data as any;
          engine_version = d?.engine_version ?? engine_version;
          res = {
            sheet_name: sp.sheet_name,
            ok: !!d?.ok,
            batch_id: d?.batch_id,
            error: d?.ok ? undefined : (d?.error || d?.parse_errors?.join("; ") || "Import failed"),
            summary: d?.summary,
            control_totals: d?.control_totals,
            duplicates: d?.duplicates,
            balance_discontinuities: d?.balance_discontinuities,
          };
        } catch (e) {
          // One month failing must not abandon the rest.
          res = { sheet_name: sp.sheet_name, ok: false, error: String(e instanceof Error ? e.message : e) };
        }

        if (res.ok && res.summary) {
          const s = res.summary as any;
          totals.posted_to_ledger_count += Number(s.posted_to_ledger_count ?? 0);
          totals.posted_to_ledger_value += Number(s.posted_to_ledger_value ?? 0);
          totals.posted_to_suspense_count += Number(s.posted_to_suspense_count ?? 0);
          totals.posted_to_suspense_value += Number(s.posted_to_suspense_value ?? 0);
          totals.blocked_count += Number(s.blocked_count ?? 0);
          totals.excluded_count += Number(s.excluded_count ?? 0);
          for (const [k, v] of Object.entries((s.suspense_reasons ?? {}) as Record<string, number>)) {
            totals.suspense_reasons[k] = (totals.suspense_reasons[k] ?? 0) + Number(v);
          }
        }
        sheets.push(res);
      }
      onProgress?.({ done: params.sheet_periods.length, total: params.sheet_periods.length, current: "" });

      return {
        engine_version,
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
