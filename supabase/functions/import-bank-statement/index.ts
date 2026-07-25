// ═══════════════════════════════════════════════════════════════════════════
// import-bank-statement — parse → categorize → validate → post, ONE MONTH.
//
// A bank's whole financial year is one giant sheet (50k+ rows) whose rows span
// every month. Posting cost grows with batch size, so a single 50k transaction
// is unsafe. Instead the client drives ONE call per month; this function parses
// the workbook, keeps only the rows whose transaction DATE is in that month,
// and posts them as one atomic batch. 50k lines become ~12 batches of a few
// thousand, each ~2–3s, each independently re-runnable — and a failure on one
// month leaves the others posted.
//
// The server re-parses the file itself — client rows are never trusted.
//
// Input: { storage_path, bank_account_id, period: {year, month},
//          include_undated?, posting_mode? }
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
  deriveAccountKey,
  parseSheetMatrix,
  resolveBatch,
  validateBatch,
  type AccountMapEntry,
  type CanonicalMapEntry,
  type CategorizationRule,
  type ParsedLine,
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
const MAX_ROWS_PER_MONTH = 20_000;         // one month rarely exceeds a few thousand
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
    // One call = one PERIOD (year+month). A bank's whole-year workbook is a
    // single giant sheet whose rows span every month; the client drives one
    // call per month, and this function parses the file and posts only the rows
    // whose transaction date falls in that month. Each month is its own atomic
    // batch, so 50k+ lines never post in a single transaction.
    const body = await req.json();
    const { storage_path, bank_account_id, period, include_undated, posting_mode } = body as {
      storage_path: string;
      bank_account_id: string;
      period: { year: number; month: number };
      include_undated?: boolean;   // fold undated/corrupt rows into the earliest month
      posting_mode?: "auto_post" | "draft";
    };
    if (!storage_path || !bank_account_id || !period) {
      return json({ ok: false, error: "storage_path, bank_account_id and period are required" }, 200);
    }
    if (!storage_path.startsWith(`${tenantId}/`)) {
      return json({ ok: false, error: "storage_path outside tenant folder" }, 200);
    }

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const periodLabel = `${period.year}-${String(period.month).padStart(2, "0")}`;
    if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12 ||
        !Number.isInteger(period.year) || period.year < 1990 || period.year > 2100) {
      return json({ ok: false, error: `Invalid period ${periodLabel}` }, 200);
    }
    if (period.year > now.getUTCFullYear() ||
        (period.year === now.getUTCFullYear() && period.month > now.getUTCMonth() + 1)) {
      return json({ ok: false, error: `Period ${periodLabel} is in the future.` }, 200);
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

    // Parse every sheet, then keep only the rows whose transaction date falls
    // in this call's month (plus, on the earliest month, the undated/corrupt
    // rows so they are still recorded and held). Each parsed line is stamped
    // with THIS period so the engine's out-of-period gate is a no-op for the
    // rows we keep.
    const wb = XLSX.read(await fileBlob.arrayBuffer(), { type: "array", cellDates: true });
    const inThisMonth = (isoDate: string | null): boolean => {
      if (!isoDate) return false;
      const [y, m] = isoDate.split("-").map(Number);
      return y === period.year && m === period.month;
    };

    const periodLines: ParsedLine[] = [];
    const parseErrors: string[] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
      const nonEmpty = matrix.some((r) => (r ?? []).some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
      if (!nonEmpty) continue;
      const result = parseSheetMatrix(matrix, name, { month: period.month, year: period.year });
      parseErrors.push(...result.errors);
      for (const line of result.lines) {
        if (inThisMonth(line.txnDate)) periodLines.push(line);
        else if (include_undated && !line.txnDate && !line.isExcluded) periodLines.push(line);
      }
    }
    if (parseErrors.length > 0) {
      return json({ ok: false, error: parseErrors.join("; "), parse_errors: parseErrors }, 200);
    }
    if (periodLines.length > MAX_ROWS_PER_MONTH) {
      return json({
        ok: false,
        error: `Month ${periodLabel} has ${periodLines.length} rows; the limit is ${MAX_ROWS_PER_MONTH} per month.`,
      }, 200);
    }
    if (periodLines.length === 0) {
      return json({ ok: false, error: `No rows dated ${periodLabel} found in the workbook` }, 200);
    }
    const parsed = { lines: periodLines, errors: [] as string[] };

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

    // ── Tier 4: auto-generated ledgers ────────────────────────────────────
    // Every "derive" line names a ledger from its description; get-or-create one
    // account per distinct (name, direction) so unmapped-but-clear rows post to
    // a real account instead of Suspense. Direction fixes the classification.
    const deriveTargets = new Map<string, { derive_key: string; name: string; side: "debit" | "credit" }>();
    for (const r of resolved) {
      if (r.resolution?.kind === "derive") {
        const derive_key = deriveAccountKey(r.resolution.accountName);
        deriveTargets.set(`${derive_key}|${r.resolution.side}`, {
          derive_key, name: r.resolution.accountName, side: r.resolution.side,
        });
      }
    }
    const deriveAccountByKey = new Map<string, string>(); // `${derive_key}|${side}` → account_id
    if (deriveTargets.size > 0) {
      const { data: derivedRows, error: derErr } = await admin.rpc("get_or_create_derived_accounts", {
        p_tenant_id: tenantId,
        p_actor_user_id: actorId,
        p_items: [...deriveTargets.values()],
      });
      if (derErr) return json({ ok: false, error: `Could not create auto-generated ledgers: ${derErr.message}` }, 200);
      for (const row of (derivedRows ?? []) as { derive_key: string; side: string; account_id: string }[]) {
        deriveAccountByKey.set(`${row.derive_key}|${row.side}`, row.account_id);
      }
    }

    // ── Persist batch (one sheet = one batch) + lines ─────────────────────
    const sheetPeriods = [{ sheet_name: periodLabel, month: period.month, year: period.year }];
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
      return json({ ok: false, batch_id: batchId, sheet_name: periodLabel, error: claimErr.message }, 200);
    }

    const sanitizeAmount = (n: number) =>
      Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;

    const lineRows = resolved.map(({ line, resolution, canonicalCategory }) => {
      const flags: string[] = [...line.parseFlags];
      if (duplicateRows.has(`${line.sheetName}|${line.rowIndex}`)) flags.push("duplicate_in_batch");

      // Tier: 1/2 mapped, 3 suspense, 4 auto-generated; blocked/excluded → null.
      let resolutionTier: number | null = null;
      let resolvedAccountId: string | null = null;
      let resolvedByMapId: string | null = null;
      if (resolution?.kind === "resolved") {
        resolutionTier = resolution.tier;
        resolvedAccountId = resolution.accountId;
        resolvedByMapId = resolution.ruleId;
      } else if (resolution?.kind === "derive") {
        resolutionTier = 4;
        resolvedAccountId =
          deriveAccountByKey.get(`${deriveAccountKey(resolution.accountName)}|${resolution.side}`) ?? null;
      } else if (resolution?.kind === "suspense") {
        resolutionTier = 3;
      }

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
        resolution_tier: resolutionTier,
        resolved_account_id: resolvedAccountId,
        resolved_by_map_id: resolvedByMapId,
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
        return json({ ok: false, batch_id: batchId, sheet_name: periodLabel, error: `Could not store lines: ${insErr.message}` }, 200);
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
      return json({ ok: false, batch_id: batchId, sheet_name: periodLabel, error: postErr.message }, 200);
    }

    return json({
      ok: true,
      batch_id: batchId,
      sheet_name: periodLabel,
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
