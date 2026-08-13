import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { normalizeKey } from "@/lib/pettyCashImportParser";
import type { ParsedRow, ImportDateFormat } from "@/lib/pettyCashImportParser";

export type PCImportBatch = Database["public"]["Tables"]["petty_cash_import_batches"]["Row"];
export type PCImportLine = Database["public"]["Tables"]["petty_cash_import_lines"]["Row"];
export type PCAccountMap = Database["public"]["Tables"]["petty_cash_account_map"]["Row"];

export type PCImportLineFilter = "all" | "ok" | "suspense" | "blocked" | "excluded" | "duplicate";

export type ResolveSummary = {
  batch_id: string;
  total: number;
  ok: number;
  suspense: number;
  blocked: number;
  excluded: number;
  posted: number;
  duplicates: number;
  blocked_by_code: Record<string, number>;
  unmapped_account_types: string[];
};

export type PostSummary = {
  batch_id: string;
  vouchers_created: number;
  receipts_created: number;
  journal_entries: number;
  lines_posted: number;
  lines_excluded: number;
  total_out: number;
  total_in: number;
  net_movement: number;
  opening_balance: number;
  closing_balance: number;
};

/**
 * Turns the machine-readable codes the import RPCs raise into something a
 * person can act on. The raw text names the fix but leads with a code and a
 * PL/pgSQL context line, which is not what belongs in a toast.
 */
function humanizeImportError(raw: string): string {
  const msg = raw || "";

  // Unique violation on ux_pc_import_batch_hash.
  if (msg.includes("ux_pc_import_batch_hash") || msg.includes("duplicate key")) {
    return "This file has already been imported. Open Petty Cash Imports to view, discard, or reverse it.";
  }
  if (msg.includes("BATCH_POSTED")) {
    return "This import is posted to the ledger. Reverse it instead — reversing writes correcting entries and leaves an audit trail.";
  }
  if (msg.includes("BLOCKED_LINES")) {
    const n = msg.match(/BLOCKED_LINES:\s*(\d+)/);
    return `${n ? n[1] : "Some"} line(s) are still blocked. Fix the account, exclude the row, or discard the batch before posting.`;
  }
  if (msg.includes("INSUFFICIENT_FUND")) {
    return msg.replace(/^INSUFFICIENT_FUND:\s*/, "").split("\n")[0];
  }
  if (msg.includes("ACCOUNT_NOT_POSTABLE")) {
    return "That is a header account and cannot be posted to. Map to one of its children instead.";
  }
  if (msg.includes("PETTY_CASH_GL_TARGET")) {
    return "That account is registered as a petty cash fund, so it cannot be the contra side of a petty cash movement.";
  }
  if (msg.includes("ACCOUNT_INACTIVE")) {
    return "That account is inactive. Reactivate it, or pick another.";
  }
  if (msg.includes("ACCOUNT_EXISTS")) {
    return msg.replace(/^ACCOUNT_EXISTS:\s*/, "").split("\n")[0];
  }
  if (msg.includes("EMPTY_MATCH_KEY")) {
    return "An account type needs at least one letter or digit.";
  }
  if (msg.includes("SUSPENSE_NOT_CONFIGURED")) {
    return "No suspense account is configured. Set one under Settings → Account Mapping before importing.";
  }
  if (msg.includes("BATCH_NOT_RESOLVED")) {
    return "This batch has not been resolved yet, or has already been posted.";
  }
  if (msg.includes("BATCH_NOT_POSTED")) {
    return "Only a posted import can be reversed.";
  }
  if (msg.includes("NOT_AUTHORIZED")) {
    return "You do not have access to this import batch.";
  }
  if (msg.includes("PERIOD_LOCKED")) {
    return msg.replace(/^PERIOD_LOCKED:\s*/, "").split("\n")[0];
  }
  return msg.replace(/^[A-Z_]+:\s*/, "").split("\n")[0];
}

// ─── Batches ───
export function usePCImportBatches(pettyCashAccountId?: string) {
  return useQuery({
    queryKey: ["pc_import_batches", pettyCashAccountId],
    queryFn: async () => {
      let q = supabase
        .from("petty_cash_import_batches")
        .select("*, petty_cash_accounts(account_name), imported_user:imported_by(first_name, last_name)")
        .order("created_at", { ascending: false });
      if (pettyCashAccountId) q = q.eq("petty_cash_account_id", pettyCashAccountId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function usePCImportBatch(batchId?: string) {
  return useQuery({
    queryKey: ["pc_import_batch", batchId],
    enabled: !!batchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_import_batches")
        .select("*, petty_cash_accounts(account_name, account_id, float_amount)")
        .eq("id", batchId!)
        .single();
      if (error) throw error;

      const { data: counts, error: cErr } = await supabase
        .from("petty_cash_import_lines")
        .select("status, is_duplicate")
        .eq("batch_id", batchId!);
      if (cErr) throw cErr;

      const tally = { ok: 0, suspense: 0, blocked: 0, excluded: 0, posted: 0, pending: 0, duplicates: 0 };
      for (const l of counts ?? []) {
        if (l.status in tally) tally[l.status as keyof typeof tally] += 1;
        if (l.is_duplicate) tally.duplicates += 1;
      }
      return { ...data, counts: tally, total: counts?.length ?? 0 };
    },
  });
}

export function usePCImportLines(batchId?: string, filter: PCImportLineFilter = "all") {
  return useQuery({
    queryKey: ["pc_import_lines", batchId, filter],
    enabled: !!batchId,
    queryFn: async () => {
      let q = supabase
        .from("petty_cash_import_lines")
        .select("*, accounts:resolved_account_id(account_name, account_code, account_type)")
        .eq("batch_id", batchId!)
        .order("row_no");
      if (filter === "duplicate") q = q.eq("is_duplicate", true);
      else if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

// ─── Staging ───
export type CreateBatchInput = {
  pettyCashAccountId: string;
  fileName: string;
  fileHash: string;
  sheetName: string;
  dateFormat: ImportDateFormat;
  amountOrientation: "contra" | "fund";
  rows: ParsedRow[];
};

const CHUNK = 500;

export function useCreatePCImportBatch() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateBatchInput): Promise<{ batchId: string; summary: ResolveSummary }> => {
      const { data: user } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", (await supabase.auth.getUser()).data.user!.id)
        .single();

      const { data: batch, error } = await supabase
        .from("petty_cash_import_batches")
        .insert({
          tenant_id: appUser!.tenant_id,
          petty_cash_account_id: input.pettyCashAccountId,
          file_name: input.fileName,
          file_hash: input.fileHash,
          sheet_name: input.sheetName,
          date_format: input.dateFormat,
          amount_orientation: input.amountOrientation,
          row_count: input.rows.length,
          imported_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;

      try {
        for (let i = 0; i < input.rows.length; i += CHUNK) {
          const chunk = input.rows.slice(i, i + CHUNK).map((r) => ({
            batch_id: batch.id,
            tenant_id: appUser!.tenant_id,
            row_no: r.rowNo,
            raw_date: r.rawDate,
            raw_voucher_no: r.rawVoucherNo,
            raw_name: r.rawName,
            raw_description: r.rawDescription,
            raw_account_type: r.rawAccountType,
            raw_debit: r.rawDebit,
            raw_credit: r.rawCredit,
            parsed_date: r.parsedDate,
          }));
          const { error: lineErr } = await supabase.from("petty_cash_import_lines").insert(chunk);
          if (lineErr) throw lineErr;
        }

        const { data: summary, error: rErr } = await supabase.rpc("resolve_petty_cash_import_lines", {
          p_batch_id: batch.id,
        });
        if (rErr) throw rErr;

        return { batchId: batch.id, summary: summary as unknown as ResolveSummary };
      } catch (e) {
        // Never leave a half-staged batch behind, and never leave the file
        // hash locked by a batch that does not represent a complete upload.
        await supabase.rpc("discard_petty_cash_import_batch", {
          p_batch_id: batch.id,
          p_reason: "Staging failed part-way through",
        });
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_import_batches"] });
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

export function useResolvePCImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.rpc("resolve_petty_cash_import_lines", { p_batch_id: batchId });
      if (error) throw error;
      return data as unknown as ResolveSummary;
    },
    onSuccess: (_, batchId) => {
      qc.invalidateQueries({ queryKey: ["pc_import_lines", batchId] });
      qc.invalidateQueries({ queryKey: ["pc_import_batch", batchId] });
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

export function usePostPCImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.rpc("post_petty_cash_import_batch", { p_batch_id: batchId });
      if (error) throw error;
      return data as unknown as PostSummary;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pc_import_batches"] });
      qc.invalidateQueries({ queryKey: ["pc_import_batch", res.batch_id] });
      qc.invalidateQueries({ queryKey: ["pc_import_lines", res.batch_id] });
      qc.invalidateQueries({ queryKey: ["pc_vouchers"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      qc.invalidateQueries({ queryKey: ["pc_ledger"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success(
        `Imported — ${res.vouchers_created} voucher(s), ${res.receipts_created} receipt(s) posted`,
      );
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

export function useDiscardPCImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, reason }: { batchId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("discard_petty_cash_import_batch", {
        p_batch_id: batchId,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return data as unknown as { batch_id: string; file_name: string; lines_deleted: number; hash_released: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_import_batches"] });
      toast.success("Import discarded. You can upload this file again.");
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

export function useRevertPCImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, reason }: { batchId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("revert_petty_cash_import_batch", {
        p_batch_id: batchId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as unknown as {
        batch_id: string;
        entries_reversed: number;
        vouchers_reversed: number;
        closing_balance: number;
      };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pc_import_batches"] });
      qc.invalidateQueries({ queryKey: ["pc_vouchers"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      qc.invalidateQueries({ queryKey: ["pc_ledger"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success(
        `Reversed ${res.entries_reversed} entr(ies) and ${res.vouchers_reversed} voucher(s). This file can be uploaded again.`,
      );
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

// ─── Line-level edits ───
export function useUpdatePCImportLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lineId, accountId }: { lineId: string; accountId: string }) => {
      const { error } = await supabase
        .from("petty_cash_import_lines")
        .update({
          resolved_account_id: accountId,
          resolution_tier: "manual",
          status: "ok",
          error_code: null,
          error_message: null,
        })
        .eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_import_lines"] });
      qc.invalidateQueries({ queryKey: ["pc_import_batch"] });
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

export function useExcludePCImportLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lineIds: string[]) => {
      const { error } = await supabase
        .from("petty_cash_import_lines")
        .update({ status: "excluded" })
        .in("id", lineIds);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_import_lines"] });
      qc.invalidateQueries({ queryKey: ["pc_import_batch"] });
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

/**
 * Restoring puts a line back to 'pending' rather than guessing what it was.
 * The caller re-resolves, which re-derives ok / suspense / blocked from the
 * current mappings — the same answer the resolver would give a fresh upload.
 */
export function useRestorePCImportLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lineIds: string[]) => {
      const { error } = await supabase
        .from("petty_cash_import_lines")
        .update({ status: "pending" })
        .in("id", lineIds);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_import_lines"] });
      qc.invalidateQueries({ queryKey: ["pc_import_batch"] });
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

// ─── Learned mappings ───
export function usePCAccountMap() {
  return useQuery({
    queryKey: ["pc_account_map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_account_map")
        .select("*, accounts:account_id(account_name, account_code)")
        .order("match_type")
        .order("match_key");
      if (error) throw error;
      return data;
    },
  });
}

export function useUpsertPCAccountMap() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      matchType: "account_type" | "description";
      matchKey: string; // canonicalized again by the DB trigger
      accountId: string;
      displayLabel?: string;
    }) => {
      const { data: user } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", (await supabase.auth.getUser()).data.user!.id)
        .single();

      const { error } = await supabase.from("petty_cash_account_map").upsert(
        {
          tenant_id: appUser!.tenant_id,
          match_type: input.matchType,
          match_key: input.matchKey,
          display_label: input.displayLabel ?? input.matchKey,
          account_id: input.accountId,
          created_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,match_type,match_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_account_map"] });
      qc.invalidateQueries({ queryKey: ["pc_account_type_registry"] });
      qc.invalidateQueries({ queryKey: ["pc_unmapped_types"] });
      toast.success("Mapping saved — the next import will resolve this automatically");
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

export function useDeletePCAccountMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("petty_cash_account_map").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_account_map"] });
      qc.invalidateQueries({ queryKey: ["pc_account_type_registry"] });
      qc.invalidateQueries({ queryKey: ["pc_unmapped_types"] });
      toast.success("Mapping removed");
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

// ─── Suspense clearing ───
export function useSuspenseLines(pettyCashAccountId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["pc_suspense_lines", pettyCashAccountId, appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data: settings } = await supabase
        .from("account_settings")
        .select("suspense_account_id")
        .eq("tenant_id", appUser!.tenant_id)
        .maybeSingle();
      if (!settings?.suspense_account_id) return [];

      let q = supabase
        .from("petty_cash_import_lines")
        .select(
          "*, petty_cash_import_batches!inner(file_name, petty_cash_account_id, petty_cash_accounts(account_name))",
        )
        .eq("status", "posted")
        .eq("resolved_account_id", settings.suspense_account_id)
        .order("parsed_date");
      if (pettyCashAccountId) {
        q = q.eq("petty_cash_import_batches.petty_cash_account_id", pettyCashAccountId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
}

export function useReclassifySuspenseLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lineIds: string[]; accountId: string; remember: boolean }) => {
      const { data, error } = await supabase.rpc("reclassify_petty_cash_suspense_lines", {
        p_line_ids: input.lineIds,
        p_account_id: input.accountId,
        p_remember: input.remember,
      });
      if (error) throw error;
      return data as unknown as {
        journal_entry_id: string;
        lines_reclassified: number;
        mappings_learned: number;
      };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pc_suspense_lines"] });
      qc.invalidateQueries({ queryKey: ["pc_account_map"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success(
        `Reclassified ${res.lines_reclassified} line(s)` +
          (res.mappings_learned > 0 ? ` — ${res.mappings_learned} mapping(s) remembered` : ""),
      );
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}

// ─── Account type registry ───
export type PCAccountTypeRow = {
  id: string;
  display_label: string;
  match_key: string;
  match_type: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  account_type: string | null;
  hit_count: number;
  last_used_at: string | null;
  seen_in_imports: number;
};

export type PCAccountSuggestion = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  confidence: number;
  reason: string;
};

export function usePCAccountTypeRegistry() {
  return useQuery({
    queryKey: ["pc_account_type_registry"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("petty_cash_account_type_registry");
      if (error) throw error;
      return (data ?? []) as unknown as PCAccountTypeRow[];
    },
  });
}

/** Common labels offered as a starting list. Reference data — never auto-applied. */
export function usePCTypeTemplate() {
  return useQuery({
    queryKey: ["pc_type_template"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("petty_cash_type_template")
        .select("label, sort_order")
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Advisory candidates for one label. Suggestions are never applied on their
 * own — the caller renders them for a human to accept or override.
 */
export function usePCAccountSuggestions(label: string, limit = 5) {
  const key = label.trim();
  return useQuery({
    queryKey: ["pc_account_suggestions", key, limit],
    enabled: key.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("suggest_petty_cash_account", {
        p_label: key,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as unknown as PCAccountSuggestion[];
    },
  });
}

/** Labels seen in staged sheets that have no mapping yet. */
export function useUnmappedAccountTypes() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["pc_unmapped_types", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const [{ data: lines, error: lErr }, { data: maps, error: mErr }] = await Promise.all([
        supabase
          .from("petty_cash_import_lines")
          .select("raw_account_type")
          .eq("tenant_id", appUser!.tenant_id)
          .not("raw_account_type", "is", null),
        supabase.from("petty_cash_account_map").select("match_key").eq("match_type", "account_type"),
      ]);
      if (lErr) throw lErr;
      if (mErr) throw mErr;

      const mapped = new Set((maps ?? []).map((m) => m.match_key));
      const seen = new Map<string, { label: string; count: number }>();
      for (const l of lines ?? []) {
        const label = (l.raw_account_type ?? "").trim();
        const key = normalizeKey(label);
        if (!key || mapped.has(key)) continue;
        const e = seen.get(key) ?? { label, count: 0 };
        e.count += 1;
        seen.set(key, e);
      }
      return [...seen.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.count - a.count);
    },
  });
}

export function useCreatePCExpenseAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (label: string) => {
      const { data, error } = await supabase.rpc("create_petty_cash_expense_account", {
        p_label: label,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["pc_account_suggestions"] });
      toast.success("Account created");
    },
    onError: (e: Error) => toast.error(humanizeImportError(e.message)),
  });
}
