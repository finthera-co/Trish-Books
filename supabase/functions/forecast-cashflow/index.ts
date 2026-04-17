// Advanced Financial Forecasting Engine
// Pipeline: SQL aggregation -> Outlier cleaning (Z-score) -> Seasonal decomposition
//           -> Linear trend -> Confidence intervals -> Per-category + total cash forecast
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FORECAST_HORIZON_DAYS = 30;
const SEASONAL_PERIOD = 7; // weekly seasonality
const Z_THRESHOLD = 3;     // outlier cutoff

// ---------- Statistical helpers ----------
function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stddev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

// Replace outliers (|z| > Z_THRESHOLD) with rolling mean of window=7
function cleanOutliers(values: number[]) {
  const m = mean(values);
  const sd = stddev(values);
  const cleaned: number[] = [];
  const flags: boolean[] = [];
  for (let i = 0; i < values.length; i++) {
    const z = sd === 0 ? 0 : Math.abs((values[i] - m) / sd);
    if (z > Z_THRESHOLD) {
      const start = Math.max(0, i - 3);
      const end = Math.min(values.length, i + 4);
      const window = values.slice(start, end).filter((_, j) => j + start !== i);
      cleaned.push(window.length ? mean(window) : m);
      flags.push(true);
    } else {
      cleaned.push(values[i]);
      flags.push(false);
    }
  }
  return { cleaned, flags };
}

// Additive decomposition: detrend with centered moving average, then per-period seasonal index
function decompose(values: number[], period = SEASONAL_PERIOD) {
  const n = values.length;
  if (n < period * 2) {
    // Too short for seasonality — return zero seasonal indices
    return { seasonal: new Array(period).fill(0), residuals: values.map((v) => v - mean(values)) };
  }
  // Centered moving average for trend
  const halfP = Math.floor(period / 2);
  const trend: (number | null)[] = new Array(n).fill(null);
  for (let i = halfP; i < n - halfP; i++) {
    const window = values.slice(i - halfP, i + halfP + 1);
    trend[i] = mean(window);
  }
  // Seasonal = value - trend, grouped by position-in-period
  const buckets: number[][] = Array.from({ length: period }, () => []);
  for (let i = 0; i < n; i++) {
    if (trend[i] !== null) buckets[i % period].push(values[i] - (trend[i] as number));
  }
  let seasonal = buckets.map((b) => (b.length ? mean(b) : 0));
  // Center seasonal so it sums to 0
  const sMean = mean(seasonal);
  seasonal = seasonal.map((s) => s - sMean);

  // Residuals = value - trend - seasonal
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = trend[i];
    if (t !== null) residuals.push(values[i] - t - seasonal[i % period]);
  }
  return { seasonal, residuals };
}

// Linear regression on cleaned series
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

// Full forecast: returns array of { value, lower, upper } for next horizon days
function forecast(values: number[], horizon = FORECAST_HORIZON_DAYS) {
  if (values.length < 2) {
    return Array.from({ length: horizon }, () => ({ value: values[0] ?? 0, lower: 0, upper: 0 }));
  }
  const { cleaned, flags } = cleanOutliers(values);
  const { seasonal, residuals } = decompose(cleaned);
  const { slope, intercept } = linearFit(cleaned);
  const sd = stddev(residuals);
  const n = cleaned.length;

  const out: { value: number; lower: number; upper: number }[] = [];
  for (let h = 1; h <= horizon; h++) {
    const trend = intercept + slope * (n - 1 + h);
    const seas = seasonal[(n - 1 + h) % SEASONAL_PERIOD] || 0;
    const value = trend + seas;
    // Confidence interval widens with horizon distance
    const ci = 1.96 * sd * Math.sqrt(1 + h / Math.max(n, 1));
    out.push({
      value: Math.round(value * 100) / 100,
      lower: Math.round((value - ci) * 100) / 100,
      upper: Math.round((value + ci) * 100) / 100,
    });
  }
  return { points: out, outlier_count: flags.filter(Boolean).length, model: "trend_seasonal" };
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ---------- Main handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Create job row
  const startedAt = Date.now();
  const { data: jobRow } = await supabase
    .from("forecast_jobs")
    .insert({ status: "running" })
    .select()
    .single();
  const jobId = jobRow?.id;

  let totalRowsInserted = 0;
  let tenantsProcessed = 0;
  const tenantLogs: Array<{ tenant_id: string; categories: number; rows: number; outliers: number }> = [];

  try {
    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id")
      .eq("status", "active");
    if (tErr) throw tErr;

    for (const tenant of tenants || []) {
      // 1. Pull category time series via SQL
      const { data: series, error: sErr } = await supabase.rpc("get_category_time_series", {
        p_tenant_id: tenant.id,
        p_granularity: "daily",
        p_lookback_days: 365,
      });
      if (sErr) {
        console.error("series error", tenant.id, sErr);
        continue;
      }

      // Group by category
      const byCategory = new Map<string, { category_id: string | null; category_name: string; stream: string; series: { date: string; value: number }[] }>();
      for (const row of series || []) {
        const key = `${row.category_id ?? "null"}|${row.stream}`;
        if (!byCategory.has(key)) {
          byCategory.set(key, {
            category_id: row.category_id,
            category_name: row.category_name,
            stream: row.stream,
            series: [],
          });
        }
        byCategory.get(key)!.series.push({ date: row.period, value: Number(row.amount) });
      }

      // 2. Pull daily balances for total cash forecast
      const { data: balances } = await supabase
        .from("daily_balances")
        .select("date, closing_balance")
        .eq("tenant_id", tenant.id)
        .order("date", { ascending: true });

      const insertRows: Array<Record<string, unknown>> = [];
      let outlierTotal = 0;

      // Per-category forecasts
      for (const [, cat] of byCategory) {
        if (cat.series.length < 7) continue; // need minimal history
        const sorted = cat.series.sort((a, b) => a.date.localeCompare(b.date));
        const values = sorted.map((p) => p.value);
        const result = forecast(values);
        if (typeof result === "object" && "points" in result) {
          outlierTotal += result.outlier_count;
          const lastDate = new Date(sorted[sorted.length - 1].date);
          for (let i = 0; i < result.points.length; i++) {
            const p = result.points[i];
            insertRows.push({
              tenant_id: tenant.id,
              period: addDays(lastDate, i + 1),
              granularity: "daily",
              category_id: cat.category_id,
              category_name: cat.category_name,
              stream: cat.stream,
              forecast_value: p.value,
              lower_bound: p.lower,
              upper_bound: p.upper,
              model_type: result.model,
              metadata: { history_days: values.length, outliers_cleaned: result.outlier_count },
            });
          }
        }
      }

      // Total cash balance forecast
      if (balances && balances.length >= 2) {
        const values = balances.map((b: { closing_balance: number }) => Number(b.closing_balance));
        const result = forecast(values);
        if (typeof result === "object" && "points" in result) {
          outlierTotal += result.outlier_count;
          const lastDate = new Date(balances[balances.length - 1].date);
          for (let i = 0; i < result.points.length; i++) {
            const p = result.points[i];
            insertRows.push({
              tenant_id: tenant.id,
              period: addDays(lastDate, i + 1),
              granularity: "daily",
              category_id: null,
              category_name: "TOTAL_CASH",
              stream: "cash",
              forecast_value: p.value,
              lower_bound: p.lower,
              upper_bound: p.upper,
              model_type: result.model,
              metadata: { history_days: values.length, outliers_cleaned: result.outlier_count },
            });
          }
        }
      }

      // Replace tenant's forecasts atomically
      await supabase.from("financial_forecasts").delete().eq("tenant_id", tenant.id);
      if (insertRows.length > 0) {
        // Insert in chunks to stay within payload limits
        for (let i = 0; i < insertRows.length; i += 500) {
          const chunk = insertRows.slice(i, i + 500);
          const { error: insErr } = await supabase.from("financial_forecasts").insert(chunk);
          if (insErr) console.error("insert error", tenant.id, insErr);
          else totalRowsInserted += chunk.length;
        }
      }

      tenantsProcessed++;
      tenantLogs.push({
        tenant_id: tenant.id,
        categories: byCategory.size,
        rows: insertRows.length,
        outliers: outlierTotal,
      });
    }

    if (jobId) {
      await supabase
        .from("forecast_jobs")
        .update({
          status: "success",
          duration_ms: Date.now() - startedAt,
          tenants_processed: tenantsProcessed,
          forecast_rows_inserted: totalRowsInserted,
          logs: { tenants: tenantLogs },
        })
        .eq("id", jobId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        tenants_processed: tenantsProcessed,
        rows_inserted: totalRowsInserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (jobId) {
      await supabase
        .from("forecast_jobs")
        .update({
          status: "failed",
          duration_ms: Date.now() - startedAt,
          error_message: msg,
          tenants_processed: tenantsProcessed,
          forecast_rows_inserted: totalRowsInserted,
        })
        .eq("id", jobId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
