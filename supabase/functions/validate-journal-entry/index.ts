import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPSILON = 0.005;

interface JournalLine {
  account_id: string;
  debit: number;
  credit: number;
}

interface RequestBody {
  description: string;
  entry_date: string;
  reference?: string;
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

    const body: RequestBody = await req.json();
    const { description, entry_date, reference, lines } = body;

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

    // Single-side check
    for (let i = 0; i < (lines || []).length; i++) {
      const l = lines[i];
      if (Number(l.debit) > 0 && Number(l.credit) > 0) {
        errors.push({ field: `lines[${i}]`, message: `Line ${i + 1}: Cannot have both debit and credit` });
      }
      if (Number(l.debit) < 0 || Number(l.credit) < 0) {
        errors.push({ field: `lines[${i}]`, message: `Line ${i + 1}: Amounts must be positive` });
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
          // Control account warning (AR/AP/Inventory)
          if (acc.account_subtype) {
            const controlSubs = ["accounts receivable", "accounts payable", "inventory"];
            const sub = acc.account_subtype.toLowerCase();
            if (controlSubs.some((c) => sub.includes(c))) {
              errors.push({
                field: `account_${line.account_id}`,
                message: `"${acc.account_name}" is a control account (${acc.account_subtype}). Use Invoices, Bills, or Payments instead.`,
              });
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
    const { data: entry, error: entryErr } = await adminClient
      .from("journal_entries")
      .insert({
        tenant_id: appUser.tenant_id,
        description: description.trim(),
        entry_date,
        reference: reference?.trim() || null,
        created_by: appUser.id,
        status: "posted",
      })
      .select()
      .single();

    if (entryErr) {
      return new Response(
        JSON.stringify({ error: `Failed to create entry: ${entryErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const journalLines = activeLines.map((l) => ({
      journal_entry_id: entry.id,
      account_id: l.account_id,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
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
        total_debit: totalDebit,
        total_credit: totalCredit,
        line_count: activeLines.length,
      },
    });

    return new Response(
      JSON.stringify({ valid: true, entry_id: entry.id }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
