// ═══════════════════════════════════════════════════════════════════════════
// import-bank-statement — parse → categorize → validate → post, ONE SHEET.
//
// Scope is deliberately a single monthly sheet, not the whole workbook. The
// cost of posting is superlinear in batch size (measured: 1k rows 0.45s,
// 3k 1.9s, 8k 12s, 33k 60s), and a whole-workbook import both blows the edge
// function's wall clock and holds the entire file in memory. One sheet posts
// in ~2s with bounded memory, so the client loops sheet by sheet and shows
// progress. Each month is its own atomic batch: a failure on one month leaves
// the others posted and re-runnable on its own.
//
// The server still re-parses the file itself — client rows are never trusted.
//
// Input: { storage_path, bank_account_id, sheet: {sheet_name, month, year},
//          posting_mode? }
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// SheetJS is vendored rather than pulled from a CDN: Supabase's bundler blocks
// cdn.sheetjs.com, and npm/esm.sh only carry 0.18.5. Vendoring also guarantees
// the server parses with the exact build the browser preview used — see
// ../_shared/vendor/README.md.
// deno-lint-ignore no-explicit-any
import * as XLSX from "../_shared/vendor/xlsx.mjs";
import {
  ENGINE_VERSION,
  buildCanonicalMap,
  parseSheetMatrix,
  resolveBatch,
  validateBatch,
  type AccountMapEntry,
  type CanonicalMapEntry,
  type CategorizationRule,
  type ResolutionContext,
  type ResolvedLine,
} from "../_shared/bankCategorization/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Guard rails. Without these a large or malformed workbook can exhaust the
// function's memory or wall clock with no useful error.
const MAX_FILE_BYTES = 25 * 1024 * 1024;   // 25 MB uploaded workbook
const MAX_ROWS_PER_SHEET = 10_000;         // ~18s post; typical sheet is ~3,000
const INSERT_CHUNK = 1_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let batchId: string | null = null;
  try {
    // ── Auth: user JWT, gated to finance roles (same pattern as post-invoice)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, 200);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 200);

    const { data: au } = await admin
      .from("users")
      .select("id, tenant_id, roles(role_name)")
      .eq("auth_user_id", user.id)
      .single();
    if (!au?.tenant_id) return json({ ok: false, error: "User not in a tenant" }, 200);
    // deno-lint-ignore no-explicit-any
    const role = (au as any).roles?.role_name as string | undefined;
    const allowed = ["Super Admin", "Primary Admin", "Company Admin", "Accountant"];
    if (!role || !allowed.includes(role)) {
      return json({ ok: false, error: `Role "${role || "unknown"}" cannot import bank statements` }, 200);
    }
    const tenantId = au.tenant_id as string;
    const actorId = au.id as string;

    // ── Input ─────────────────────────────────────────────────────────────
    const body = await req.json();
    const { storage_path, bank_account_id, sheet, posting_mode } = body as {
      storage_path: string;
      bank_account_id: string;
      sheet: { sheet_name: string; month: number; year: number };
      posting_mode?: "auto_post" | "draft";
    };
    if (!storage_path || !bank_account_id || !sheet?.sheet_name) {
      return json({ ok: false, error: "storage_path, bank_account_id and sheet are required" }, 200);
    }
    if (!storage_path.startsWith(`${tenantId}/`)) {
      return json({ ok: false, error: "storage_path outside tenant folder" }, 200);
    }

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    if (!Number.isInteger(sheet.month) || sheet.month < 1 || sheet.month > 12 ||
        !Number.isInteger(sheet.year) || sheet.year < 1990 || sheet.year > 2100) {
      return json({ ok: false, error: `Invalid period for sheet "${sheet.sheet_name}"` }, 200);
    }
    if (sheet.year > now.getUTCFullYear() ||
        (sheet.year === now.getUTCFullYear() && sheet.month > now.getUTCMonth() + 1)) {
      return json({
        ok: false,
        error: `Sheet "${sheet.sheet_name}" is dated ${sheet.year}-${String(sheet.month).padStart(2, "0")}, which is in the future.`,
      }, 200);
    }

    // ── Fail fast on configuration ────────────────────────────────────────
    const { data: settings } = await admin
      .from("account_settings")
      .select("bank_import_unrecognized_deposit_account_id, bank_import_unrecognized_payment_account_id, bank_import_posting_mode, bank_import_amount_ceiling")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!settings?.bank_import_unrecognized_deposit_account_id ||
        !settings?.bank_import_unrecognized_payment_account_id) {
      return json({
        ok: false,
        error: "Unrecognized Deposits / Unrecognized Payments accounts are not configured. " +
          "Run Bank Import chart setup, or set them in Settings → Account Mapping → Bank Import.",
      }, 200);
    }

    const { data: bankAcct } = await admin
      .from("accounts")
      .select("id, is_active, is_postable")
      .eq("id", bank_account_id)
      .eq("tenant_id", tenantId)
      .single();
    if (!bankAcct) return json({ ok: false, error: "Bank account not found" }, 200);
    if (!bankAcct.is_active || !bankAcct.is_postable) {
      return json({ ok: false, error: "Bank account must be active and postable" }, 200);
    }

    // ── Server-side parse of THIS SHEET ONLY (bounded memory) ─────────────
    const { data: fileBlob, error: dlErr } = await admin.storage
      .from("bank-statements")
      .download(storage_path);
    if (dlErr || !fileBlob) return json({ ok: false, error: `Could not read uploaded file: ${dlErr?.message}` }, 200);
    if (fileBlob.size > MAX_FILE_BYTES) {
      return json({
        ok: false,
        error: `Workbook is ${(fileBlob.size / 1048576).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB. Split it and import the parts separately.`,
      }, 200);
    }

    // `sheets:` makes SheetJS materialise only the sheet we need, so peak
    // memory tracks one month rather than the whole workbook.
    const wb = XLSX.read(await fileBlob.arrayBuffer(), {
      type: "array", cellDates: true, sheets: [sheet.sheet_name],
    });
    const ws = wb.Sheets[sheet.sheet_name];
    if (!ws) return json({ ok: false, error: `Sheet "${sheet.sheet_name}" not found in workbook` }, 200);

    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
    if (matrix.length > MAX_ROWS_PER_SHEET) {
      return json({
        ok: false,
        error: `Sheet "${sheet.sheet_name}" has ${matrix.length} rows; the limit is ${MAX_ROWS_PER_SHEET} per sheet. Split the month across sheets.`,
      }, 200);
    }

    const parsed = parseSheetMatrix(matrix, sheet.sheet_name, { month: sheet.month, year: sheet.year });
    if (parsed.errors.length > 0) {
      return json({ ok: false, error: parsed.errors.join("; "), parse_errors: parsed.errors }, 200);
    }
    if (parsed.lines.length === 0) {
      return json({ ok: false, error: `No data rows found in sheet "${sheet.sheet_name}"` }, 200);
    }

    // ── Load resolution context ───────────────────────────────────────────
    const [{ data: canonRows }, { data: mapRows }, { data: ruleRows }, { data: acctRows }] =
      await Promise.all([
        admin.from("bank_category_canonical_map")
          .select("id, tenant_id, raw_variant, canonical_category")
          .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
        admin.from("bank_category_account_map")
          .select("id, canonical_category, account_id, expected_side, is_active")
          .eq("tenant_id", tenantId),
        admin.from("bank_categorization_rules")
          .select("id, match_field, match_value, account_id, expected_side, priority, is_active")
          .eq("tenant_id", tenantId),
        admin.from("accounts")
          .select("id, is_active, is_postable, is_control_account")
          .eq("tenant_id", tenantId),
      ]);

    // Global rows first so tenant rows shadow them on the same variant.
    const canonEntries: CanonicalMapEntry[] = [
      ...(canonRows ?? []).filter((r) => r.tenant_id === null),
      ...(canonRows ?? []).filter((r) => r.tenant_id !== null),
    ].map((r) => ({ id: r.id, rawVariant: r.raw_variant, canonicalCategory: r.canonical_category }));

    const ctx: ResolutionContext = {
      canonicalMap: buildCanonicalMap(canonEntries),
      accountMap: new Map(
        (mapRows ?? []).map((r): [string, AccountMapEntry] => [r.canonical_category, {
          id: r.id,
          canonicalCategory: r.canonical_category,
          accountId: r.account_id,
          expectedSide: r.expected_side,
          isActive: r.is_active,
        }])
      ),
      rules: (ruleRows ?? []).map((r): CategorizationRule => ({
        id: r.id,
        matchField: r.match_field,
        matchValue: r.match_value,
        accountId: r.account_id,
        expectedSide: r.expected_side,
        priority: r.priority,
        isActive: r.is_active,
      })),
      accounts: new Map(
        (acctRows ?? []).map((a) => [a.id, {
          id: a.id,
          isActive: a.is_active,
          isPostable: a.is_postable,
          isControlAccount: a.is_control_account,
        }])
      ),
      amountCeiling: Number(settings.bank_import_amount_ceiling ?? 100000000),
      maxDate: todayIso,
    };

    // ── Resolve + validate (server-side truth) ────────────────────────────
    const resolved: ResolvedLine[] = resolveBatch(parsed.lines, ctx);
    const batch = validateBatch(parsed.lines);

    const duplicateRows = new Set<string>();
    for (const dup of batch.duplicates) {
      for (const ref of dup.rowRefs) duplicateRows.add(`${ref.sheetName}|${ref.rowIndex}`);
    }

    // ── Persist batch (one sheet = one batch) + lines ─────────────────────
    const sheetPeriods = [{ sheet_name: sheet.sheet_name, month: sheet.month, year: sheet.year }];
    const { data: batchRow, error: batchErr } = await admin
      .from("bank_statement_batches")
      .insert({
        tenant_id: tenantId,
        bank_account_id,
        storage_path,
        file_name: storage_path.split("/").pop() ?? storage_path,
        sheet_periods: sheetPeriods,
        status: "processing",
        posting_mode: posting_mode ?? null,
        engine_version: ENGINE_VERSION,
        total_debit: batch.totalDebit,
        total_credit: batch.totalCredit,
        row_count: batch.rowCount,
        created_by: actorId,
      })
      .select("id")
      .single();
    if (batchErr || !batchRow) return json({ ok: false, error: `Could not create batch: ${batchErr?.message}` }, 200);
    batchId = batchRow.id as string;

    // Claim the period. This is the race-free idempotency guard: a concurrent
    // import of the same month loses here rather than double-posting.
    const { error: claimErr } = await admin.rpc("claim_bank_statement_periods", {
      p_batch_id: batchId,
      p_periods: sheetPeriods,
    });
    if (claimErr) {
      await admin.from("bank_statement_batches")
        .update({ status: "failed", error_message: claimErr.message }).eq("id", batchId);
      return json({ ok: false, batch_id: batchId, sheet_name: sheet.sheet_name, error: claimErr.message }, 200);
    }

    const sanitizeAmount = (n: number) =>
      Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;

    const lineRows = resolved.map(({ line, resolution, canonicalCategory }) => {
      const flags: string[] = [...line.parseFlags];
      if (duplicateRows.has(`${line.sheetName}|${line.rowIndex}`)) flags.push("duplicate_in_batch");
      return {
        tenant_id: tenantId,
        batch_id: batchId,
        sheet_name: line.sheetName,
        period_month: line.periodMonth,
        period_year: line.periodYear,
        row_index: line.rowIndex,
        txn_date: line.txnDate,
        raw_date: line.rawDate,
        description: line.description,
        name: line.name,
        voucher_no: line.voucherNo,
        raw_account_type: line.rawAccountType,
        canonical_category: canonicalCategory,
        debit: sanitizeAmount(line.debit),
        credit: sanitizeAmount(line.credit),
        bank_fee: line.bankFee,
        balance: line.balance,
        is_excluded: line.isExcluded,
        resolution_tier: resolution === null ? null : resolution.kind === "resolved" ? resolution.tier : resolution.kind === "suspense" ? 3 : null,
        resolved_account_id: resolution?.kind === "resolved" ? resolution.accountId : null,
        resolved_by_map_id: resolution?.kind === "resolved" ? resolution.ruleId : null,
        suspense_reason: resolution?.kind === "suspense" ? resolution.reason : null,
        block_reason: resolution?.kind === "blocked" ? resolution.reason : null,
        suggestions: resolution?.kind === "suspense" ? resolution.suggestions : [],
        validation_flags: flags,
        engine_version: ENGINE_VERSION,
      };
    });

    for (let i = 0; i < lineRows.length; i += INSERT_CHUNK) {
      const { error: insErr } = await admin
        .from("bank_statement_lines").insert(lineRows.slice(i, i + INSERT_CHUNK));
      if (insErr) {
        await admin.from("bank_statement_batches")
          .update({ status: "failed", error_message: insErr.message }).eq("id", batchId);
        return json({ ok: false, batch_id: batchId, sheet_name: sheet.sheet_name, error: `Could not store lines: ${insErr.message}` }, 200);
      }
    }

    // ── Post — atomic for this sheet: fully posted or not at all ──────────
    const { data: summary, error: postErr } = await admin.rpc("import_bank_statement_post", {
      p_batch_id: batchId,
      p_actor_user_id: actorId,
    });
    if (postErr) {
      await admin.from("bank_statement_batches")
        .update({ status: "failed", error_message: postErr.message }).eq("id", batchId);
      return json({ ok: false, batch_id: batchId, sheet_name: sheet.sheet_name, error: postErr.message }, 200);
    }

    return json({
      ok: true,
      batch_id: batchId,
      sheet_name: sheet.sheet_name,
      engine_version: ENGINE_VERSION,
      summary,
      control_totals: {
        total_debit: batch.totalDebit,
        total_credit: batch.totalCredit,
        row_count: batch.rowCount,
        excluded_count: batch.excludedCount,
      },
      duplicates: batch.duplicates,
      balance_discontinuities: batch.discontinuities,
    });
  } catch (e) {
    if (batchId) {
      await admin.from("bank_statement_batches")
        .update({ status: "failed", error_message: String(e) }).eq("id", batchId);
    }
    return json({ ok: false, batch_id: batchId, error: String(e) }, 200);
  }
});
