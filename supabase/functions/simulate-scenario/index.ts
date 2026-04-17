// Scenario simulation: applies revenue/expense/capital assumptions
// to baseline forecast and computes projected cash, profit, ROI, payback.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ScenarioInput {
  scenario_id?: string;
  tenant_id: string;
  name?: string;
  description?: string;
  horizon_months?: number;
  revenue_uplift_pct?: number;
  expense_reduction_pct?: number;
  capital_injection?: number;
  one_time_investment?: number;
  persist?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: ScenarioInput = await req.json();
    if (!body.tenant_id) return json({ error: "tenant_id required" }, 400);

    const horizon = Math.max(1, Math.min(36, body.horizon_months ?? 12));
    const revUp = (body.revenue_uplift_pct ?? 0) / 100;
    const expRed = (body.expense_reduction_pct ?? 0) / 100;
    const capInj = body.capital_injection ?? 0;
    const oneTime = body.one_time_investment ?? 0;

    // Fetch baseline forecasts (next `horizon` months)
    const { data: forecasts, error: fErr } = await supabase
      .from("financial_forecasts")
      .select("period, stream, forecast_value")
      .eq("tenant_id", body.tenant_id)
      .gte("period", new Date().toISOString().slice(0, 10))
      .order("period", { ascending: true });

    if (fErr) throw fErr;

    // Aggregate baseline by month + stream
    const byMonth = new Map<string, { revenue: number; expense: number; cash: number }>();
    for (const f of forecasts ?? []) {
      const m = (f.period as string).slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, { revenue: 0, expense: 0, cash: 0 });
      const bucket = byMonth.get(m)!;
      const v = Number(f.forecast_value) || 0;
      if (f.stream === "revenue") bucket.revenue += v;
      else if (f.stream === "expense") bucket.expense += v;
      else if (f.stream === "cash") bucket.cash = v; // last value per month
    }

    const months = Array.from(byMonth.keys()).sort().slice(0, horizon);
    const series: Array<Record<string, number | string>> = [];
    let baseRev = 0, baseExp = 0, projRev = 0, projExp = 0;
    let runningCashBase = 0, runningCashProj = 0;
    let firstCashSeed = false;

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
    const investment = oneTime || capInj || 1; // avoid divide by zero
    const roiPct = oneTime > 0 ? (profitDelta / oneTime) * 100 : 0;

    // Payback: months until cumulative incremental profit >= one_time_investment
    let payback: number | null = null;
    if (oneTime > 0) {
      let cum = 0;
      for (let i = 0; i < series.length; i++) {
        const incr = (series[i].projected_revenue as number) -
          (series[i].projected_expense as number) -
          ((series[i].baseline_revenue as number) - (series[i].baseline_expense as number));
        cum += incr;
        if (cum >= oneTime) { payback = i + 1; break; }
      }
    }

    const result = {
      horizon_months: horizon,
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
      series,
    };

    // Persist scenario if requested
    if (body.persist) {
      const payload = {
        tenant_id: body.tenant_id,
        name: body.name ?? "Untitled scenario",
        description: body.description ?? null,
        horizon_months: horizon,
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
        result_series: series,
      };

      if (body.scenario_id) {
        await supabase.from("scenario_models").update(payload).eq("id", body.scenario_id);
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

function round(n: number) { return Math.round(n * 100) / 100; }
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
