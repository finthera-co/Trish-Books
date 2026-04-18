// Post Payroll Run → General Ledger
// Reads immutable payroll_results, looks up payroll_component_accounts mapping,
// builds a balanced double-entry journal, and posts it.
//
// QuickBooks-style design: every component (BASIC, EPF_EMPLOYEE, EPF_EMPLOYER, ETF_EMPLOYER,
// OTHER_DEDUCTIONS, NET_PAY, etc.) is mapped to a GL account on either the debit or credit side.
// The function aggregates results across all employees in the run, then groups by (account, side).
//
// Skips: derived components (GROSS_PAY) and any component with value=0 or no mapping.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EPSILON = 0.01;
// Components that are aggregations of others — never posted directly to GL.
const DERIVED_SKIP = new Set(["GROSS_PAY"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: appUser } = await admin
      .from("users")
      .select("id, tenant_id")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser?.tenant_id) return json({ error: "User has no tenant" }, 403);

    const { run_id } = await req.json().catch(() => ({}));
    if (!run_id) return json({ error: "run_id required" }, 400);

    // 1. Load run + ensure tenant + not already posted
    const { data: run, error: runErr } = await admin
      .from("payroll_runs")
      .select("*")
      .eq("id", run_id)
      .single();
    if (runErr || !run) return json({ error: "Run not found" }, 404);
    if (run.tenant_id !== appUser.tenant_id) return json({ error: "Forbidden" }, 403);
    if (run.status === "voided") return json({ error: "Run is voided" }, 400);
    if (run.journal_entry_id) {
      return json({ error: "Run already posted to GL", journal_entry_id: run.journal_entry_id }, 409);
    }

    // 2. Load immutable payroll_results
    const { data: results, error: resErr } = await admin
      .from("payroll_results")
      .select("component_code, value")
      .eq("run_id", run_id);
    if (resErr) throw resErr;
    if (!results || results.length === 0) {
      return json({ error: "No payroll_results found for this run" }, 400);
    }

    // 3. Aggregate by component_code across all employees
    const totals = new Map<string, number>();
    for (const r of results) {
      if (DERIVED_SKIP.has(r.component_code)) continue;
      const v = Number(r.value || 0);
      if (Math.abs(v) < EPSILON) continue;
      totals.set(r.component_code, (totals.get(r.component_code) || 0) + v);
    }

    // 4. Load tenant's component → account mapping
    const { data: mappings, error: mapErr } = await admin
      .from("payroll_component_accounts")
      .select("component_code, posting_side, account_id, accounts(account_code, account_name)")
      .eq("tenant_id", appUser.tenant_id)
      .eq("is_active", true);
    if (mapErr) throw mapErr;

    const mapByCode = new Map<string, { side: "debit" | "credit"; account_id: string; account_label: string }>();
    for (const m of mappings || []) {
      mapByCode.set(m.component_code, {
        side: m.posting_side as "debit" | "credit",
        account_id: m.account_id,
        account_label: `${(m as any).accounts?.account_code} ${(m as any).accounts?.account_name}`,
      });
    }

    // 5. Build journal lines (group by account + side so each account appears once)
    type LineAgg = { account_id: string; debit: number; credit: number };
    const linesByKey = new Map<string, LineAgg>();
    const unmapped: { component_code: string; amount: number }[] = [];

    for (const [code, amount] of totals) {
      const m = mapByCode.get(code);
      if (!m) { unmapped.push({ component_code: code, amount }); continue; }
      const key = `${m.account_id}|${m.side}`;
      const cur = linesByKey.get(key) || { account_id: m.account_id, debit: 0, credit: 0 };
      if (m.side === "debit") cur.debit += amount;
      else cur.credit += amount;
      linesByKey.set(key, cur);
    }

    if (unmapped.length > 0) {
      return json({
        error: "Unmapped payroll components — configure GL mapping first",
        unmapped,
        hint: "Go to Payroll → GL Mapping to assign accounts",
      }, 422);
    }

    const lines = Array.from(linesByKey.values()).map((l) => ({
      account_id: l.account_id,
      debit: round2(l.debit),
      credit: round2(l.credit),
    }));

    // 6. Validate balance
    const totalDr = lines.reduce((s, l) => s + l.debit, 0);
    const totalCr = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDr - totalCr) > EPSILON) {
      return json({
        error: "Generated journal is unbalanced — check mapping (each component should be on the side that produces a balanced entry)",
        total_debit: round2(totalDr),
        total_credit: round2(totalCr),
        difference: round2(totalDr - totalCr),
        lines,
      }, 422);
    }
    if (lines.length < 2) return json({ error: "Need at least two journal lines" }, 422);

    // 7. Insert journal entry as draft → lines → flip to posted (mirrors validate-journal-entry pattern)
    const { data: je, error: jeErr } = await admin
      .from("journal_entries")
      .insert({
        tenant_id: appUser.tenant_id,
        description: `Payroll - ${run.run_number} (${run.period_start} to ${run.period_end})`,
        entry_date: run.payment_date || run.period_end,
        reference: run.run_number,
        created_by: appUser.id,
        status: "draft",
      })
      .select()
      .single();
    if (jeErr) throw jeErr;

    const { error: linesErr } = await admin.from("journal_lines").insert(
      lines.map((l) => ({ ...l, journal_entry_id: je.id }))
    );
    if (linesErr) {
      await admin.from("journal_entries").delete().eq("id", je.id);
      throw linesErr;
    }

    const { error: postErr } = await admin
      .from("journal_entries")
      .update({ status: "posted" })
      .eq("id", je.id);
    if (postErr) throw postErr;

    // 8. Link JE to run + mark processed
    await admin
      .from("payroll_runs")
      .update({ status: "processed", journal_entry_id: je.id })
      .eq("id", run_id);

    // 9. Audit
    await admin.from("audit_logs").insert({
      action: "Payroll Posted to GL",
      table_name: "payroll_runs",
      record_id: run_id,
      user_id: appUser.id,
      tenant_id: appUser.tenant_id,
      details: {
        run_number: run.run_number,
        journal_entry_id: je.id,
        total_debit: round2(totalDr),
        total_credit: round2(totalCr),
        line_count: lines.length,
        components_posted: Array.from(totals.entries()).map(([k, v]) => ({ code: k, amount: round2(v) })),
      },
    });

    return json({
      success: true,
      journal_entry_id: je.id,
      total_debit: round2(totalDr),
      total_credit: round2(totalCr),
      line_count: lines.length,
    });
  } catch (e) {
    console.error("post-payroll-gl error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function round2(n: number) { return Math.round(n * 100) / 100; }
