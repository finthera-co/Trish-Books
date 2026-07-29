// ═══════════════════════════════════════════════════════════════════════════
// import-bank-statement — parse → categorize → validate → post, WHOLE workbook.
//
// A bank's whole financial year is one giant sheet (50k+ rows) whose rows span
// every month. Posting cost grows with batch size, so a single 50k transaction
// is unsafe. This function downloads and parses the workbook ONCE, groups rows
// by their own calendar month, and posts EACH month as its own atomic batch
// (separate transaction). 50k lines become ~12 batches of a few thousand, each
// independently re-runnable — a failure on one month leaves the others posted.
// Parsing once (vs the old call-per-month design) removes the repeated ~200 MB
// parse peak and 12× file download.
//
// The server re-parses the file itself — client rows are never trusted.
//
// Input:  { storage_path, bank_account_id, posting_mode?, periods? }
//   periods (optional) restricts to specific {year,month}s so one failed month
//   can be re-run without re-posting the rest.
//   Also accepts the older per-month client's { period, include_undated } — a
//   deployed-function/stale-client mismatch would otherwise post the whole
//   workbook on the first of its 12 calls.
// Output: { ok, engine_version, months: [ per-month result … ], undated_held }
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
    // ONE call handles the WHOLE workbook. The file is downloaded and parsed
    // ONCE; rows are grouped by their own calendar month and each month posts as
    // its own atomic batch. (Previously the client called once per month, which
    // re-downloaded and re-parsed the entire file every time — 12× the I/O and a
    // ~200 MB parse peak per call.) `periods`, when given, restricts to specific
    // months so a single failed month can be re-run without re-posting the rest.
    const body = await req.json();
    const { storage_path, bank_account_id, posting_mode, periods, period, include_undated } = body as {
      storage_path: string;
      bank_account_id: string;
      posting_mode?: "auto_post" | "draft";
      periods?: { year: number; month: number }[];
      // Legacy (pre parse-once) client fields — see the compatibility note below.
      period?: { year: number; month: number };
      include_undated?: boolean;
    };
    if (!storage_path || !bank_account_id) {
      return json({ ok: false, error: "storage_path and bank_account_id are required" }, 200);
    }

    // ── Backward compatibility with the per-month client ──────────────────
    // The older client calls this function ONCE PER MONTH with `period`
    // (singular) plus `include_undated`. `periods` is optional here and its
    // absence means "post every month", so ignoring the unknown `period` key
    // made call #1 post the WHOLE workbook and calls #2..#12 get rejected by
    // the period claim — 12 posted batches and 132 PERIOD_ALREADY_IMPORTED
    // failures from one upload. Honour the legacy key instead: a stale client
    // posts exactly the month it asked for.
    const legacySingle = !(periods && periods.length) && !!period;
    const wantPeriods = legacySingle ? [period!] : periods;
    // Undated/corrupt rows ride with the earliest posted month. The legacy
    // client decides that itself (it passes include_undated only on month #1).
    const foldUndated = legacySingle ? include_undated === true : true;
    if (!storage_path.startsWith(`${tenantId}/`)) {
      return json({ ok: false, error: "storage_path outside tenant folder" }, 200);
    }

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth() + 1;

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

    // ── Download + parse the whole workbook ONCE ──────────────────────────
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

    const allLines: ParsedLine[] = [];
    const parseErrors: string[] = [];
    {
      // Scope the workbook/matrix so they can be GC'd after parsing — they are
      // the ~200 MB memory peak; the parsed lines that survive are far lighter.
      const wb = XLSX.read(await fileBlob.arrayBuffer(), { type: "array", cellDates: true });
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        if (!ws) continue;
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
        const nonEmpty = matrix.some((r) => (r ?? []).some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
        if (!nonEmpty) continue;
        // A neutral period; each line is re-stamped with its own month below.
        const result = parseSheetMatrix(matrix, name, { month: 1, year: 2000 });
        parseErrors.push(...result.errors);
        allLines.push(...result.lines);
      }
    }
    if (parseErrors.length > 0) {
      return json({ ok: false, error: parseErrors.join("; "), parse_errors: parseErrors }, 200);
    }
    if (allLines.length === 0) {
      return json({ ok: false, error: "No data rows found in the workbook" }, 200);
    }

    // ── Group rows by their own calendar month; undated/corrupt rows ride
    //    along with the earliest posted month so they are still recorded/held.
    const groups = new Map<string, ParsedLine[]>(); // "YYYY-MM" → lines
    const undated: ParsedLine[] = [];
    for (const line of allLines) {
      if (!line.txnDate) { if (!line.isExcluded) undated.push(line); continue; }
      const [y, m] = line.txnDate.split("-").map(Number);
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const arr = groups.get(key);
      if (arr) arr.push(line); else groups.set(key, [line]);
    }
    let monthKeys = [...groups.keys()].sort();
    if (wantPeriods && wantPeriods.length) {
      const want = new Set(wantPeriods.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`));
      monthKeys = monthKeys.filter((k) => want.has(k));
    }
    if (monthKeys.length === 0) {
      return json({ ok: false, error: "No dated rows to import in the workbook" }, 200);
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
          .select("id, is_active, is_postable, is_control_account, account_name, account_code")
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
          accountName: a.account_name,
          accountCode: a.account_code,
        }])
      ),
      amountCeiling: Number(settings.bank_import_amount_ceiling ?? 100000000),
      maxDate: todayIso,
    };

    const sanitizeAmount = (n: number) =>
      Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;

    // ── Post ONE month as its own atomic batch. Never throws — every failure
    //    (claim conflict, insert, posting) is caught and returned so one month
    //    failing leaves the others posted and independently re-runnable. ───────
    async function postMonth(lines: ParsedLine[], y: number, m: number): Promise<Record<string, unknown>> {
      const label = `${y}-${String(m).padStart(2, "0")}`;
      let localBatchId: string | null = null;
      try {
        if (lines.length > MAX_ROWS_PER_MONTH) {
          return { sheet_name: label, ok: false, error: `Month ${label} has ${lines.length} rows; the limit is ${MAX_ROWS_PER_MONTH} per month.` };
        }
        // Each line already stamped with this month by the caller.
        const resolved: ResolvedLine[] = resolveBatch(lines, ctx);
        const batch = validateBatch(lines);

        const duplicateRows = new Set<string>();
        for (const dup of batch.duplicates) {
          for (const ref of dup.rowRefs) duplicateRows.add(`${ref.sheetName}|${ref.rowIndex}`);
        }

        // Tier 4: get-or-create an auto-generated ledger per distinct derive target.
        const deriveTargets = new Map<string, { derive_key: string; name: string; side: "debit" | "credit" }>();
        for (const r of resolved) {
          if (r.resolution?.kind === "derive") {
            const derive_key = deriveAccountKey(r.resolution.accountName);
            deriveTargets.set(`${derive_key}|${r.resolution.side}`, { derive_key, name: r.resolution.accountName, side: r.resolution.side });
          }
        }
        const deriveAccountByKey = new Map<string, string>();
        if (deriveTargets.size > 0) {
          const { data: derivedRows, error: derErr } = await admin.rpc("get_or_create_derived_accounts", {
            p_tenant_id: tenantId, p_actor_user_id: actorId, p_items: [...deriveTargets.values()],
          });
          if (derErr) return { sheet_name: label, ok: false, error: `Could not create auto-generated ledgers: ${derErr.message}` };
          for (const row of (derivedRows ?? []) as { derive_key: string; side: string; account_id: string }[]) {
            deriveAccountByKey.set(`${row.derive_key}|${row.side}`, row.account_id);
          }
        }

        const sheetPeriods = [{ sheet_name: label, month: m, year: y }];
        const { data: batchRow, error: batchErr } = await admin
          .from("bank_statement_batches")
          .insert({
            tenant_id: tenantId, bank_account_id, storage_path,
            file_name: storage_path.split("/").pop() ?? storage_path,
            sheet_periods: sheetPeriods, status: "processing", posting_mode: posting_mode ?? null,
            engine_version: ENGINE_VERSION, total_debit: batch.totalDebit, total_credit: batch.totalCredit,
            row_count: batch.rowCount, created_by: actorId,
          })
          .select("id").single();
        if (batchErr || !batchRow) return { sheet_name: label, ok: false, error: `Could not create batch: ${batchErr?.message}` };
        localBatchId = batchRow.id as string;
        batchId = localBatchId; // for the outer catch's cleanup

        const { error: claimErr } = await admin.rpc("claim_bank_statement_periods", {
          p_batch_id: localBatchId, p_periods: sheetPeriods,
        });
        if (claimErr) {
          await admin.from("bank_statement_batches").update({ status: "failed", error_message: claimErr.message }).eq("id", localBatchId);
          return { sheet_name: label, ok: false, batch_id: localBatchId, error: claimErr.message };
        }

        const lineRows = resolved.map(({ line, resolution, canonicalCategory }) => {
          const flags: string[] = [...line.parseFlags];
          if (duplicateRows.has(`${line.sheetName}|${line.rowIndex}`)) flags.push("duplicate_in_batch");
          let resolutionTier: number | null = null;
          let resolvedAccountId: string | null = null;
          let resolvedByMapId: string | null = null;
          if (resolution?.kind === "resolved") {
            resolutionTier = resolution.tier; resolvedAccountId = resolution.accountId; resolvedByMapId = resolution.ruleId;
          } else if (resolution?.kind === "derive") {
            resolutionTier = 4;
            resolvedAccountId = deriveAccountByKey.get(`${deriveAccountKey(resolution.accountName)}|${resolution.side}`) ?? null;
          } else if (resolution?.kind === "suspense") {
            resolutionTier = 3;
          }
          return {
            tenant_id: tenantId, batch_id: localBatchId, sheet_name: line.sheetName,
            period_month: line.periodMonth, period_year: line.periodYear, row_index: line.rowIndex,
            txn_date: line.txnDate, raw_date: line.rawDate, description: line.description, name: line.name,
            voucher_no: line.voucherNo, raw_account_type: line.rawAccountType, canonical_category: canonicalCategory,
            debit: sanitizeAmount(line.debit), credit: sanitizeAmount(line.credit),
            bank_fee: line.bankFee, balance: line.balance, is_excluded: line.isExcluded,
            resolution_tier: resolutionTier, resolved_account_id: resolvedAccountId, resolved_by_map_id: resolvedByMapId,
            suspense_reason: resolution?.kind === "suspense" ? resolution.reason : null,
            block_reason: resolution?.kind === "blocked" ? resolution.reason : null,
            suggestions: resolution?.kind === "suspense" ? resolution.suggestions : [],
            validation_flags: flags, engine_version: ENGINE_VERSION,
          };
        });

        for (let i = 0; i < lineRows.length; i += INSERT_CHUNK) {
          const { error: insErr } = await admin.from("bank_statement_lines").insert(lineRows.slice(i, i + INSERT_CHUNK));
          if (insErr) {
            await admin.from("bank_statement_batches").update({ status: "failed", error_message: insErr.message }).eq("id", localBatchId);
            return { sheet_name: label, ok: false, batch_id: localBatchId, error: `Could not store lines: ${insErr.message}` };
          }
        }

        const { data: summary, error: postErr } = await admin.rpc("import_bank_statement_post", {
          p_batch_id: localBatchId, p_actor_user_id: actorId,
        });
        if (postErr) {
          await admin.from("bank_statement_batches").update({ status: "failed", error_message: postErr.message }).eq("id", localBatchId);
          return { sheet_name: label, ok: false, batch_id: localBatchId, error: postErr.message };
        }

        return {
          sheet_name: label, ok: true, batch_id: localBatchId, summary,
          control_totals: { total_debit: batch.totalDebit, total_credit: batch.totalCredit, row_count: batch.rowCount, excluded_count: batch.excludedCount },
          duplicates: batch.duplicates, balance_discontinuities: batch.discontinuities,
          // What posted vs the sheet's own printed bottom line.
          totals_rows: batch.totalsRows, reconciliation: batch.reconciliation,
        };
      } catch (e) {
        if (localBatchId) {
          await admin.from("bank_statement_batches").update({ status: "failed", error_message: String(e) }).eq("id", localBatchId);
        }
        return { sheet_name: label, ok: false, batch_id: localBatchId, error: String(e) };
      }
    }

    // ── Post every month (sequential; each its own transaction) ───────────
    const months: Record<string, unknown>[] = [];
    for (let i = 0; i < monthKeys.length; i++) {
      const [y, m] = monthKeys[i].split("-").map(Number);
      if (y > curYear || (y === curYear && m > curMonth)) {
        months.push({ sheet_name: monthKeys[i], ok: false, error: `Period ${monthKeys[i]} is in the future.` });
        continue;
      }
      // The earliest posted month also carries the undated/corrupt rows (held).
      const monthLines = foldUndated && i === 0
        ? [...groups.get(monthKeys[i])!, ...undated]
        : groups.get(monthKeys[i])!;
      for (const l of monthLines) { l.periodYear = y; l.periodMonth = m; } // stamp own month
      months.push(await postMonth(monthLines, y, m));
    }

    // The legacy per-month client reads ok / batch_id / summary / control_totals
    // at the TOP level (it only ever asked for one month), not out of months[].
    // Without this echo its result cards all read 0 — and the "Check DB" button
    // never renders — even though the import posted cleanly.
    if (legacySingle) {
      return json({
        ...(months[0] ?? {}), engine_version: ENGINE_VERSION, months,
        undated_held: foldUndated ? undated.length : 0,
      });
    }

    return json({
      ok: months.some((r) => r.ok), engine_version: ENGINE_VERSION, months,
      undated_held: foldUndated ? undated.length : 0,
    });
  } catch (e) {
    if (batchId) {
      await admin.from("bank_statement_batches")
        .update({ status: "failed", error_message: String(e) }).eq("id", batchId);
    }
    return json({ ok: false, batch_id: batchId, error: String(e) }, 200);
  }
});
