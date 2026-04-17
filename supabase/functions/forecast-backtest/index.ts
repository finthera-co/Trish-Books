// Backtesting Engine (#7)
// Walk-forward: train on history up to T, predict T+1..T+H, compare to actuals.
// Computes MAPE & RMSE per category/stream and persists to forecast_accuracy.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HOLDOUT_DAYS = 14;
const MIN_HISTORY = 21;

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function linearFit(values: number[]) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const xs = values.map((_, i) => i);
  const xm = mean(xs);
  const ym = mean(values);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xm) * (values[i] - ym);
    den += (xs[i] - xm) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: ym - slope * xm };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { tenant_id, persist = true } = await req.json().catch(() => ({}));
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve latest forecast_run for this tenant
    const { data: latestRun } = await supabase
      .from("forecast_runs")
      .select("id")
      .eq("tenant_id", tenant_id)
      .order("run_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const runId = latestRun?.id ?? null;

    // Pull historical category time series
    const { data: series, error: sErr } = await supabase.rpc("get_category_time_series", {
      p_tenant_id: tenant_id,
      p_granularity: "daily",
      p_lookback_days: 365,
    });
    if (sErr) throw sErr;

    // Group by category|stream
    const grouped = new Map<string, { category_name: string; stream: string; series: { date: string; value: number }[] }>();
    for (const row of series || []) {
      const key = `${row.category_name}|${row.stream}`;
      if (!grouped.has(key)) grouped.set(key, { category_name: row.category_name, stream: row.stream, series: [] });
      grouped.get(key)!.series.push({ date: row.period, value: Number(row.amount) });
    }

    const results: Array<Record<string, unknown>> = [];

    for (const [, g] of grouped) {
      const sorted = g.series.sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length < MIN_HISTORY) continue;

      // Split: train = first (n - HOLDOUT_DAYS), test = last HOLDOUT_DAYS
      const split = sorted.length - HOLDOUT_DAYS;
      const train = sorted.slice(0, split).map((p) => p.value);
      const test = sorted.slice(split);

      const { slope, intercept } = linearFit(train);
      let sumAbsPct = 0, sumSqErr = 0, count = 0;
      for (let i = 0; i < test.length; i++) {
        const predicted = intercept + slope * (train.length + i);
        const actual = test[i].value;
        if (Math.abs(actual) > 1e-6) {
          sumAbsPct += Math.abs((actual - predicted) / actual);
        }
        sumSqErr += (actual - predicted) ** 2;
        count++;
      }
      if (count === 0) continue;

      const mape = (sumAbsPct / count) * 100;
      const rmse = Math.sqrt(sumSqErr / count);
      results.push({
        tenant_id,
        forecast_run_id: runId,
        category_name: g.category_name,
        stream: g.stream,
        mape: Math.round(mape * 100) / 100,
        rmse: Math.round(rmse * 100) / 100,
        evaluated_period: `${test[0].date}..${test[test.length - 1].date}`,
        data_points: count,
      });
    }

    if (persist && runId && results.length > 0) {
      // Replace previous accuracy rows for this run
      await supabase.from("forecast_accuracy").delete().eq("forecast_run_id", runId);
      await supabase.from("forecast_accuracy").insert(results);
    }

    const overallMape = results.length
      ? Math.round((results.reduce((s, r) => s + Number(r.mape), 0) / results.length) * 100) / 100
      : null;
    const overallRmse = results.length
      ? Math.round((results.reduce((s, r) => s + Number(r.rmse), 0) / results.length) * 100) / 100
      : null;

    return json({
      forecast_run_id: runId,
      categories_evaluated: results.length,
      holdout_days: HOLDOUT_DAYS,
      overall_mape: overallMape,
      overall_rmse: overallRmse,
      results,
    });
  } catch (e) {
    console.error("forecast-backtest error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
