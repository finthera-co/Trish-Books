// Post Payroll Run → General Ledger
// Reads immutable payroll_results, looks up payroll_component_accounts mapping,
// builds a balanced double-entry journal, and posts it.
//
// QuickBooks-style design: every component (BASIC, EPF_EMPLOYEE, EPF_EMPLOYER, ETF_EMPLOYER,
// OTHER_DEDUCTIONS, NET_PAY, etc.) is mapped to a GL account on either the debit or credit side.
// Supports dry_run mode for journal preview before posting.
// Supports per-department account overrides via payroll_department_gl.
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

    const body = await req.json().catch(() => ({}));
    const { run_id, dry_run = false } = body;
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
    if (!dry_run && run.journal_entry_id) {
      return json({ error: "Run already posted to GL", journal_entry_id: run.journal_entry_id }, 409);
    }

    // 2. Load immutable payroll_results with employee department for cost-centre split
    const { data: results, error: resErr } = await admin
      .from("payroll_results")
      .select("component_code, value, employee_id, employees(department)")
      .eq("run_id", run_id);
    if (resErr) throw resErr;
    if (!results || results.length === 0) {
      return json({ error: "No payroll_results found for this run" }, 400);
    }

    // 3. Load global component → account mapping
    const { data: mappings, error: mapErr } = await admin
      .from("payroll_component_accounts")
      .select("component_code, posting_side, account_id, accounts(account_code, account_name)")
      .eq("tenant_id", appUser.tenant_id)
      .eq("is_active", true);
    if (mapErr) throw mapErr;

    // A component may map to BOTH sides (employer EPF/ETF: Dr expense + Cr liability),
    // so keep ALL mappings per component, not just the last one seen.
    const mapByCode = new Map<string, Array<{ side: "debit" | "credit"; account_id: string; account_label: string }>>();
    for (const m of mappings || []) {
      const arr = mapByCode.get(m.component_code) || [];
      arr.push({
        side: m.posting_side as "debit" | "credit",
        account_id: m.account_id,
        account_label: `${(m as any).accounts?.account_code} ${(m as any).accounts?.account_name}`,
      });
      mapByCode.set(m.component_code, arr);
    }

    // 4. Load per-department GL overrides (may be empty — falls back to global)
    const { data: deptMappings } = await admin
      .from("payroll_department_gl")
      .select("department, component_code, account_id, posting_side")
      .eq("tenant_id", appUser.tenant_id);

    const deptMap = new Map<string, { account_id: string; side: "debit" | "credit" }>();
    for (const dm of deptMappings || []) {
      deptMap.set(`${dm.department}||${dm.component_code}`, {
        account_id: dm.account_id,
        side: dm.posting_side as "debit" | "credit",
      });
    }

    // 5. Build journal lines per result row (supports dept-level splitting)
    //    Groups by account_id:posting_side — same key merges across employees/depts
    type LineAgg = { account_id: string; debit: number; credit: number };
    const linesByKey = new Map<string, LineAgg>();
    const unmappedMap = new Map<string, number>(); // component_code → total amount

    for (const r of results) {
      if (DERIVED_SKIP.has(r.component_code)) continue;
      const v = Number(r.value || 0);
      if (Math.abs(v) < EPSILON) continue;

      const dept = (r as any).employees?.department as string | null;
      const deptOverride = dept ? deptMap.get(`${dept}||${r.component_code}`) : undefined;
      const globalMappings = mapByCode.get(r.component_code) || [];

      // Resolve the (account, side) postings for this component. A two-sided
      // employer contribution posts the full value to BOTH its expense (Dr) and
      // liability (Cr) accounts. A department override redirects the matching
      // side's account (liabilities stay on the global payable account).
      let postings: Array<{ account_id: string; side: "debit" | "credit" }> = [];
      if (globalMappings.length > 0) {
        postings = globalMappings.map((gm) => ({
          account_id: deptOverride && deptOverride.side === gm.side ? deptOverride.account_id : gm.account_id,
          side: gm.side,
        }));
      } else if (deptOverride) {
        // No global mapping, but a department override exists — post via it.
        postings = [{ account_id: deptOverride.account_id, side: deptOverride.side }];
      }

      if (postings.length === 0) {
        unmappedMap.set(r.component_code, (unmappedMap.get(r.component_code) || 0) + v);
        continue;
      }

      for (const p of postings) {
        const key = `${p.account_id}:${p.side}`;
        const cur = linesByKey.get(key) || { account_id: p.account_id, debit: 0, credit: 0 };
        if (p.side === "debit") cur.debit += v;
        else cur.credit += v;
        linesByKey.set(key, cur);
      }
    }

    if (unmappedMap.size > 0) {
      const unmapped = Array.from(unmappedMap.entries()).map(([component_code, amount]) => ({
        component_code,
        amount: round2(amount),
      }));
      return json({
        ok: false,
        error: `Unmapped payroll components: ${unmapped.map((u) => u.component_code).join(", ")}. Go to Payroll → GL Mapping to assign accounts.`,
        unmapped,
      }, 200);
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
        ok: false,
        error: `Generated journal is unbalanced — check mapping (Dr ${round2(totalDr)} ≠ Cr ${round2(totalCr)}, off by ${round2(totalDr - totalCr)})`,
        total_debit: round2(totalDr),
        total_credit: round2(totalCr),
        difference: round2(totalDr - totalCr),
        lines,
      }, 200);
    }
    if (lines.length < 2) return json({ ok: false, error: "Need at least two journal lines — map more components" }, 200);

    // ── DRY RUN: return preview without any DB writes ──────────────────────
    if (dry_run) {
      return json({
        ok: true,
        dry_run: true,
        lines,
        total_debit: round2(totalDr),
        total_credit: round2(totalCr),
        line_count: lines.length,
      });
    }

    // 7. Insert journal entry as draft → lines → flip to posted
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

    // 8b. Tax sub-ledger: APIT (PAYE) withheld from employees this run.
    // One wht_payable row per employee so the APIT remittance report can
    // list employee-level amounts.
    const payeRows = results.filter(
      (r: any) => r.component_code === "PAYE" && Number(r.value || 0) > 0
    );
    if (payeRows.length > 0) {
      const { data: apitCode } = await admin
        .from("tax_codes")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("code", "APIT")
        .maybeSingle();
      if (apitCode) {
        const grossByEmployee = new Map<string, number>();
        for (const r of results) {
          if (r.component_code === "GROSS_PAY") {
            grossByEmployee.set(r.employee_id, Number(r.value || 0));
          }
        }
        const txnDate = run.payment_date || run.period_end;
        const { error: taxErr } = await admin.from("tax_transactions").insert(
          payeRows.map((r: any) => ({
            tenant_id: appUser.tenant_id,
            tax_code_id: apitCode.id,
            direction: "wht_payable",
            source_type: "payroll_run",
            source_id: run_id,
            source_line_id: r.employee_id, // employee for drill-down
            base_amount: grossByEmployee.get(r.employee_id) ?? 0,
            tax_amount: Number(r.value),
            currency: "LKR",
            fx_rate: 1,
            rate_applied: 0, // bracket-based; trace lives in payroll_results
            transaction_date: txnDate,
            journal_entry_id: je.id,
          }))
        );
        if (taxErr) console.error("APIT tax_transactions insert failed:", taxErr.message);
      } else {
        console.error("PAYE posted but no APIT tax code exists for tenant — sub-ledger rows skipped");
      }
    }

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
