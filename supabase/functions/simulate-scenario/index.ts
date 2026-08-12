// Scenario simulation v2 — deterministic snapshots + ROI/NPV/IRR/Payback
// Determinism: given identical {base_forecast_run_id, input_parameters} the
// output is byte-identical (no random sampling, sorted iteration).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCors } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ScenarioInput {
  scenario_id?: string;
  tenant_id: string;
  name?: string;
  description?: string;
  horizon_months?: number;
  time_horizon_years?: number;       // 1, 3, or 5
  discount_rate?: number;            // for NPV (default 0.10)
  revenue_uplift_pct?: number;
  expense_reduction_pct?: number;
  capital_injection?: number;
  one_time_investment?: number;
  persist?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!req.headers.get("Authorization")) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // This handler runs as service role with no caller identity, so the caller
    // is resolved here purely to key the limiter — without it the user-scoped
    // rule would be skipped and the limiter would be inert. Body-supplied
    // tenant_id is deliberately NOT used as the key: a caller could vary it to
    // sidestep their own bucket.
    {
      const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
      const { data: authData } = token
        ? await supabase.auth.getUser(token)
        : { data: null };
      const { data: appUser } = authData?.user
        ? await supabase
            .from("users")
            .select("id, tenant_id")
            .eq("auth_user_id", authData.user.id)
            .maybeSingle()
        : { data: null };
      const { blocked } = await enforceRateLimit(supabase, "simulate-scenario", {
        userId: appUser?.id ?? null,
        tenantId: appUser?.tenant_id ?? null,
        ip: clientIp(req),
      });
      if (blocked) return blocked;
    }

    const body: ScenarioInput = await req.json();
    if (!body.tenant_id) return json({ error: "tenant_id required" }, 400);

    const yearsHorizon = [1, 3, 5].includes(body.time_horizon_years ?? 0)
      ? body.time_horizon_years!
      : 1;
    const horizon = Math.max(1, Math.min(60, body.horizon_months ?? (yearsHorizon * 12)));
    const revUp = (body.revenue_uplift_pct ?? 0) / 100;
    const expRed = (body.expense_reduction_pct ?? 0) / 100;
    const capInj = body.capital_injection ?? 0;
    const oneTime = body.one_time_investment ?? 0;
    const discountRate = body.discount_rate ?? 0.10;

    // Bind to the latest forecast_run for determinism (#2)
    const { data: latestRun } = await supabase
      .from("forecast_runs")
      .select("id")
      .eq("tenant_id", body.tenant_id)
      .order("run_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const baseRunId = latestRun?.id ?? null;

    // Fetch baseline forecast (filtered to that run when available)
    let q = supabase
      .from("financial_forecasts")
      .select("period, stream, forecast_value, forecast_run_id")
      .eq("tenant_id", body.tenant_id)
      .gte("period", new Date().toISOString().slice(0, 10))
      .order("period", { ascending: true });
    if (baseRunId) q = q.eq("forecast_run_id", baseRunId);
    const { data: forecasts, error: fErr } = await q;
    if (fErr) throw fErr;

    // Aggregate baseline by month (deterministic: sorted)
    const byMonth = new Map<string, { revenue: number; expense: number; cash: number }>();
    for (const f of (forecasts ?? []).sort((a, b) =>
      String(a.period).localeCompare(String(b.period))
    )) {
      const m = (f.period as string).slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, { revenue: 0, expense: 0, cash: 0 });
      const bucket = byMonth.get(m)!;
      const v = Number(f.forecast_value) || 0;
      if (f.stream === "revenue") bucket.revenue += v;
      else if (f.stream === "expense") bucket.expense += v;
      else if (f.stream === "cash") bucket.cash = v;
    }

    const months = Array.from(byMonth.keys()).sort().slice(0, horizon);
    const series: Array<Record<string, number | string>> = [];
    let baseRev = 0, baseExp = 0, projRev = 0, projExp = 0;
    let runningCashBase = 0, runningCashProj = 0;
    let firstCashSeed = false;
    const incrementalCashFlows: number[] = []; // for NPV/IRR

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const b = byMonth.get(m)!;
      baseRev += b.revenue;
      baseExp += b.expense;

      const adjRev = b.revenue * (1 + revUp);
      const adjExp = b.expense * (1 - expRed);
      projRev += adjRev;
      projExp += adjExp;

      if (!firstCashSeed) {
        runningCashBase = b.cash;
        runningCashProj = b.cash + capInj - oneTime;
        firstCashSeed = true;
      } else {
        runningCashBase += (b.revenue - b.expense);
        runningCashProj += (adjRev - adjExp);
      }

      const incr = (adjRev - adjExp) - (b.revenue - b.expense);
      incrementalCashFlows.push(incr);

      series.push({
        month: m,
        baseline_revenue: round(b.revenue),
        baseline_expense: round(b.expense),
        baseline_cash: round(runningCashBase),
        projected_revenue: round(adjRev),
        projected_expense: round(adjExp),
        projected_cash: round(runningCashProj),
      });
    }

    const baselineProfit = baseRev - baseExp;
    const projectedProfit = projRev - projExp;
    const profitDelta = projectedProfit - baselineProfit;

    // ROI = (Net Gain / Investment) × 100  (#3.1)
    const investment = oneTime;
    const roiPct = investment > 0 ? (profitDelta / investment) * 100 : 0;

    // Payback: months until cumulative incremental profit ≥ investment (#3.2)
    let payback: number | null = null;
    if (investment > 0) {
      let cum = 0;
      for (let i = 0; i < incrementalCashFlows.length; i++) {
        cum += incrementalCashFlows[i];
        if (cum >= investment) { payback = i + 1; break; }
      }
    }

    // NPV (#3.3): monthly discount factor derived from annual rate
    const monthlyRate = Math.pow(1 + discountRate, 1 / 12) - 1;
    const npv = -investment + incrementalCashFlows.reduce(
      (acc, cf, t) => acc + cf / Math.pow(1 + monthlyRate, t + 1),
      0,
    );

    // IRR (#3.4): bisection on monthly rate, then annualise
    const irrMonthly = solveIrr(incrementalCashFlows, investment);
    const irrAnnual = irrMonthly == null ? null : Math.pow(1 + irrMonthly, 12) - 1;

    const result = {
      horizon_months: horizon,
      time_horizon_years: yearsHorizon,
      discount_rate: discountRate,
      base_forecast_run_id: baseRunId,
      baseline_revenue: round(baseRev),
      baseline_expense: round(baseExp),
      baseline_cash: round(runningCashBase),
      projected_revenue: round(projRev),
      projected_expense: round(projExp),
      projected_cash: round(runningCashProj),
      projected_profit: round(projectedProfit),
      profit_delta: round(profitDelta),
      roi_pct: round(roiPct),
      payback_months: payback,
      npv: round(npv),
      irr_pct: irrAnnual == null ? null : round(irrAnnual * 100),
      series,
    };

    if (body.persist) {
      const inputParameters = {
        horizon_months: horizon,
        time_horizon_years: yearsHorizon,
        discount_rate: discountRate,
        revenue_uplift_pct: body.revenue_uplift_pct ?? 0,
        expense_reduction_pct: body.expense_reduction_pct ?? 0,
        capital_injection: capInj,
        one_time_investment: oneTime,
      };
      const payload = {
        tenant_id: body.tenant_id,
        name: body.name ?? "Untitled scenario",
        description: body.description ?? null,
        horizon_months: horizon,
        time_horizon_years: yearsHorizon,
        discount_rate: discountRate,
        revenue_uplift_pct: body.revenue_uplift_pct ?? 0,
        expense_reduction_pct: body.expense_reduction_pct ?? 0,
        capital_injection: capInj,
        one_time_investment: oneTime,
        baseline_revenue: result.baseline_revenue,
        baseline_expense: result.baseline_expense,
        baseline_cash: result.baseline_cash,
        projected_revenue: result.projected_revenue,
        projected_expense: result.projected_expense,
        projected_cash: result.projected_cash,
        projected_profit: result.projected_profit,
        roi_pct: result.roi_pct,
        payback_months: result.payback_months,
        npv: result.npv,
        irr: result.irr_pct,
        result_series: series,
        input_parameters: inputParameters,
        base_forecast_run_id: baseRunId,
      };

      if (body.scenario_id) {
        await supabase.from("scenario_models").update(payload).eq("id", body.scenario_id);
        (result as Record<string, unknown>).scenario_id = body.scenario_id;
      } else {
        const { data } = await supabase.from("scenario_models").insert(payload).select("id").single();
        (result as Record<string, unknown>).scenario_id = data?.id;
      }
    }

    return json(result, 200);
  } catch (e) {
    console.error("simulate-scenario error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

// IRR via bisection — searches monthly rate in (-0.99, 1.0)
function solveIrr(cashflows: number[], initialInvestment: number): number | null {
  if (initialInvestment <= 0 || cashflows.every((c) => c <= 0)) return null;
  const npvAt = (r: number) =>
    -initialInvestment + cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t + 1), 0);
  let lo = -0.99, hi = 1.0;
  let fLo = npvAt(lo), fHi = npvAt(hi);
  if (fLo * fHi > 0) return null; // no sign change → no real root
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

function round(n: number) { return Math.round(n * 100) / 100; }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
