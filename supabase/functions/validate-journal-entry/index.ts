import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

const EPSILON = 0.005;

// Mirrors LINE_MEMO_MIN / LINE_MEMO_MAX in src/lib/journalValidation.ts. The
// client enforces these for the error message; this side enforces them because
// the client is not the only thing that can call this function.
const LINE_MEMO_MIN = 3;
const LINE_MEMO_MAX = 200;

// Mirrors CHEQUE_NUMBER_MAX in src/lib/journalValidation.ts and the
// journal_entries_cheque_number_len CHECK constraint.
const CHEQUE_NUMBER_MAX = 50;

interface JournalLine {
  account_id: string;
  debit: number;
  credit: number;
  /** Per-line narration -> journal_lines.memo. Required on manual entries. */
  memo?: string | null;
}

interface RequestBody {
  description: string;
  entry_date: string;
  reference?: string;
  /** Optional cheque / payment instrument number -> journal_entries.cheque_number. */
  cheque_number?: string | null;
  lines: JournalLine[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth
    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service client for DB operations
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Get user info
    const { data: appUser } = await adminClient
      .from("users")
      .select("id, tenant_id, role_id, roles(role_name)")
      .eq("auth_user_id", user.id)
      .single();

    if (!appUser?.tenant_id) {
      return new Response(
        JSON.stringify({ error: "User not associated with a tenant" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Runs after auth resolves and before ANY journal write. Every
    // journal_entries / journal_lines mutation in this handler is downstream of
    // this point, so a 429 cannot leave a partially posted entry.
    const { blocked, headers: rlHeaders } = await enforceRateLimit(
      adminClient,
      "validate-journal-entry",
      {
        userId: appUser.id,
        tenantId: appUser.tenant_id,
        ip: clientIp(req),
      },
    );
    if (blocked) return blocked;

    const body: RequestBody = await req.json();
    const { description, entry_date, reference, cheque_number, lines } = body;
    const chequeNumber = (cheque_number ?? "").trim() || null;

    const errors: { field: string; message: string }[] = [];

    // ── 1. Description validation ───────────────────────────────────
    if (!description || description.trim().length < 3) {
      errors.push({ field: "description", message: "Description is required (min 3 characters)" });
    }

    // ── 2. Date validation ──────────────────────────────────────────
    if (!entry_date) {
      errors.push({ field: "entry_date", message: "Transaction date is required" });
    } else {
      // Check closed periods
      const { data: closedPeriods } = await adminClient
        .from("fiscal_periods")
        .select("period_start, period_end")
        .eq("tenant_id", appUser.tenant_id)
        .eq("status", "closed");

      if (closedPeriods) {
        const d = new Date(entry_date);
        for (const p of closedPeriods) {
          const start = new Date(p.period_start);
          const end = new Date(p.period_end);
          if (d >= start && d <= end) {
            errors.push({
              field: "entry_date",
              message: `Cannot post to closed period (${p.period_start} to ${p.period_end})`,
            });
          }
        }
      }
    }

    // ── 2b. Cheque number ───────────────────────────────────────────
    // The column carries the same CHECK, so an over-long value would fail the
    // insert with a raw constraint error instead of a readable message.
    if (chequeNumber && chequeNumber.length > CHEQUE_NUMBER_MAX) {
      errors.push({
        field: "cheque_number",
        message: `Cheque number must be ${CHEQUE_NUMBER_MAX} characters or fewer`,
      });
    }

    // ── 3. Lines validation ─────────────────────────────────────────
    const activeLines = (lines || []).filter(
      (l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0)
    );

    if (activeLines.length < 2) {
      errors.push({ field: "lines", message: "At least two journal lines are required" });
    }

    const hasDebit = activeLines.some((l) => Number(l.debit) > 0);
    const hasCredit = activeLines.some((l) => Number(l.credit) > 0);
    if (!hasDebit || !hasCredit) {
      errors.push({ field: "lines", message: "Must have at least one debit and one credit line" });
    }

    // Single-side, sign and narration checks
    for (let i = 0; i < (lines || []).length; i++) {
      const l = lines[i];
      if (Number(l.debit) > 0 && Number(l.credit) > 0) {
        errors.push({ field: `lines[${i}]`, message: `Line ${i + 1}: Cannot have both debit and credit` });
      }
      if (Number(l.debit) < 0 || Number(l.credit) < 0) {
        errors.push({ field: `lines[${i}]`, message: `Line ${i + 1}: Amounts must be positive` });
      }
      // Only lines that will actually post need narration; a blank spare row is
      // filtered out below and never reaches journal_lines.
      const isActive = l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0);
      if (isActive) {
        const memo = (l.memo ?? "").trim();
        if (memo.length < LINE_MEMO_MIN) {
          errors.push({
            field: `lines[${i}].memo`,
            message: `Line ${i + 1}: Description is required (min ${LINE_MEMO_MIN} characters)`,
          });
        } else if (memo.length > LINE_MEMO_MAX) {
          errors.push({
            field: `lines[${i}].memo`,
            message: `Line ${i + 1}: Description must be ${LINE_MEMO_MAX} characters or fewer`,
          });
        }
      }
    }

    // Balance check
    const totalDebit = activeLines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = activeLines.reduce((s, l) => s + Number(l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > EPSILON) {
      errors.push({
        field: "balance",
        message: `Debits (${totalDebit.toFixed(2)}) must equal Credits (${totalCredit.toFixed(2)}). Off by ${Math.abs(totalDebit - totalCredit).toFixed(2)}`,
      });
    }

    // Duplicate accounts
    const ids = activeLines.map((l) => l.account_id);
    if (new Set(ids).size !== ids.length) {
      errors.push({ field: "lines", message: "Duplicate accounts detected. Combine amounts." });
    }

    // ── 4. Account validation ───────────────────────────────────────
    if (activeLines.length > 0) {
      const accountIds = [...new Set(activeLines.map((l) => l.account_id))];
      const { data: accounts } = await adminClient
        .from("accounts")
        .select("id, account_code, account_name, account_type, account_subtype, is_active, tenant_id")
        .in("id", accountIds);

      if (accounts) {
        const accountMap = new Map(accounts.map((a) => [a.id, a]));

        for (const line of activeLines) {
          const acc = accountMap.get(line.account_id);
          if (!acc) {
            errors.push({ field: `account_${line.account_id}`, message: `Account not found: ${line.account_id}` });
            continue;
          }
          if (acc.tenant_id !== appUser.tenant_id) {
            errors.push({ field: `account_${line.account_id}`, message: `Account does not belong to your organization` });
            continue;
          }
          if (!acc.is_active) {
            errors.push({
              field: `account_${line.account_id}`,
              message: `Cannot post to inactive account: ${acc.account_code} – ${acc.account_name}`,
            });
          }
          // Control account check — allow but flag as needing subledger
          if (acc.account_subtype) {
            const controlSubs = ["accounts receivable", "accounts payable", "inventory"];
            const sub = acc.account_subtype.toLowerCase();
            if (controlSubs.some((c) => sub.includes(c))) {
              // Allow posting — subledger enforcement happens at UI level
              // Log for audit purposes
              console.log(`Control account used: ${acc.account_name} (${acc.account_subtype})`);
            }
          }
        }
      }
    }

    // ── Return errors if any ────────────────────────────────────────
    if (errors.length > 0) {
      // Log the failed attempt
      await adminClient.from("audit_logs").insert({
        action: "Journal Validation Failed",
        table_name: "journal_entries",
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: { description, entry_date, reference, error_count: errors.length, errors },
      });

      return new Response(
        JSON.stringify({ valid: false, errors }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 5. Create the journal entry atomically ──────────────────────
    // Insert as draft first so the sync trigger doesn't fire before lines exist
    const { data: entry, error: entryErr } = await adminClient
      .from("journal_entries")
      .insert({
        tenant_id: appUser.tenant_id,
        description: description.trim(),
        entry_date,
        reference: reference?.trim() || null,
        cheque_number: chequeNumber,
        created_by: appUser.id,
        status: "draft",
      })
      .select()
      .single();

    if (entryErr) {
      return new Response(
        JSON.stringify({ error: `Failed to create entry: ${entryErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // One multi-row insert, so journal_lines.seq is assigned in this order — the
    // order the user typed the lines, which is the order every report reads them in.
    const journalLines = activeLines.map((l) => ({
      journal_entry_id: entry.id,
      account_id: l.account_id,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: (l.memo ?? "").trim() || null,
    }));

    const { error: linesErr } = await adminClient.from("journal_lines").insert(journalLines);

    if (linesErr) {
      // Rollback: delete the entry
      await adminClient.from("journal_entries").delete().eq("id", entry.id);
      return new Response(
        JSON.stringify({ error: `Failed to create lines: ${linesErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Now update to 'posted' — this fires the sync trigger AFTER lines exist
    const { error: postErr } = await adminClient
      .from("journal_entries")
      .update({ status: "posted" })
      .eq("id", entry.id);

    if (postErr) {
      return new Response(
        JSON.stringify({ error: `Failed to post entry: ${postErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Audit log success
    await adminClient.from("audit_logs").insert({
      action: "Journal Entry Posted",
      table_name: "journal_entries",
      record_id: entry.id,
      user_id: appUser.id,
      tenant_id: appUser.tenant_id,
      details: {
        description,
        entry_date,
        reference,
        cheque_number: chequeNumber,
        total_debit: totalDebit,
        total_credit: totalCredit,
        line_count: activeLines.length,
      },
    });

    return new Response(
      JSON.stringify({ valid: true, entry_id: entry.id }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json", ...rlHeaders } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
