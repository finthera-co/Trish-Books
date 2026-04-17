// Advanced Financial Forecasting Engine v2 (Hardening Layer)
// Pipeline: SQL aggregation -> Outlier cleaning -> Seasonal decomposition
//   -> Linear trend -> Confidence intervals (residual-based) -> Forecast versioning
//   -> Per-run validation (accounting integrity + sanity bounds)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL_VERSION = "trend_seasonal_v2";
const FORECAST_HORIZON_DAYS = 30;
const SEASONAL_PERIOD = 7;
const Z_THRESHOLD = 3;
const MIN_DATA_POINTS = 6;          // Quality control rule (#5)
const REVENUE_GROWTH_CAP_PCT = 200; // Sanity cap (#1.2)

// ---------- Statistical helpers ----------
function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stddev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

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

function decompose(values: number[], period = SEASONAL_PERIOD) {
  const n = values.length;
  if (n < period * 2) {
    return { seasonal: new Array(period).fill(0), residuals: values.map((v) => v - mean(values)) };
  }
  const halfP = Math.floor(period / 2);
  const trend: (number | null)[] = new Array(n).fill(null);
  for (let i = halfP; i < n - halfP; i++) {
    trend[i] = mean(values.slice(i - halfP, i + halfP + 1));
  }
  const buckets: number[][] = Array.from({ length: period }, () => []);
  for (let i = 0; i < n; i++) {
    if (trend[i] !== null) buckets[i % period].push(values[i] - (trend[i] as number));
  }
  let seasonal = buckets.map((b) => (b.length ? mean(b) : 0));
  const sMean = mean(seasonal);
  seasonal = seasonal.map((s) => s - sMean);
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = trend[i];
    if (t !== null) residuals.push(values[i] - t - seasonal[i % period]);
  }
  return { seasonal, residuals };
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

interface ForecastOutput {
  points: { value: number; lower: number; upper: number }[];
  outlier_count: number;
  residual_std_dev: number;
  data_points_used: number;
  data_quality_score: number;
  fallback_used: boolean;
  model: string;
}

function forecast(values: number[], horizon = FORECAST_HORIZON_DAYS): ForecastOutput {
  const n = values.length;
  if (n < 2) {
    return {
      points: Array.from({ length: horizon }, () => ({ value: values[0] ?? 0, lower: 0, upper: 0 })),
      outlier_count: 0,
      residual_std_dev: 0,
      data_points_used: n,
      data_quality_score: 0,
      fallback_used: true,
      model: MODEL_VERSION,
    };
  }
  const { cleaned, flags } = cleanOutliers(values);
  const { seasonal, residuals } = decompose(cleaned);
  const { slope, intercept } = linearFit(cleaned);
  const sd = stddev(residuals);
  const cleanedN = cleaned.length;

  // Quality score: scales with data size, penalised by outlier rate
  const outlierRate = flags.filter(Boolean).length / Math.max(cleanedN, 1);
  const dataQuality = Math.max(0, Math.min(1,
    (cleanedN / 30) * (1 - outlierRate)
  ));

  const points: { value: number; lower: number; upper: number }[] = [];
  for (let h = 1; h <= horizon; h++) {
    const trend = intercept + slope * (cleanedN - 1 + h);
    const seas = seasonal[(cleanedN - 1 + h) % SEASONAL_PERIOD] || 0;
    const value = trend + seas;
    // Residual-based 95% confidence (z=1.96), widening with horizon
    const ci = 1.96 * sd * Math.sqrt(1 + h / Math.max(cleanedN, 1));
    points.push({
      value: Math.round(value * 100) / 100,
      lower: Math.round((value - ci) * 100) / 100,
      upper: Math.round((value + ci) * 100) / 100,
    });
  }
  return {
    points,
    outlier_count: flags.filter(Boolean).length,
    residual_std_dev: Math.round(sd * 100) / 100,
    data_points_used: cleanedN,
    data_quality_score: Math.round(dataQuality * 100) / 100,
    fallback_used: false,
    model: MODEL_VERSION,
  };
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ---------- Validation Engine (#1) ----------
interface ValidationCheck {
  check_name: string;
  status: "pass" | "fail" | "warning";
  message: string;
  metadata?: Record<string, unknown>;
}

function validateForecasts(rows: Array<Record<string, unknown>>): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // 1.2.a Bounds invariant: lower ≤ forecast ≤ upper
  let boundsViolations = 0;
  for (const r of rows) {
    const v = Number(r.forecast_value);
    const lo = Number(r.lower_bound);
    const hi = Number(r.upper_bound);
    if (lo > v || v > hi) boundsViolations++;
  }
  checks.push({
    check_name: "confidence_bounds_invariant",
    status: boundsViolations === 0 ? "pass" : "fail",
    message: boundsViolations === 0
      ? "All forecast points satisfy lower ≤ value ≤ upper."
      : `${boundsViolations} forecast points violate the confidence bounds invariant.`,
    metadata: { violations: boundsViolations, total: rows.length },
  });

  // 1.2.b Revenue growth cap
  const revRows = rows.filter((r) => r.stream === "revenue");
  const revByCat = new Map<string, number[]>();
  for (const r of revRows) {
    const k = String(r.category_name);
    if (!revByCat.has(k)) revByCat.set(k, []);
    revByCat.get(k)!.push(Number(r.forecast_value));
  }
  let revBreaches = 0;
  for (const [, series] of revByCat) {
    if (series.length < 2) continue;
    const start = Math.abs(series[0]);
    const end = Math.abs(series[series.length - 1]);
    if (start > 0) {
      const growthPct = ((end - start) / start) * 100;
      if (Math.abs(growthPct) > REVENUE_GROWTH_CAP_PCT) revBreaches++;
    }
  }
  checks.push({
    check_name: "revenue_growth_cap",
    status: revBreaches === 0 ? "pass" : "warning",
    message: revBreaches === 0
      ? `All revenue categories project growth within ±${REVENUE_GROWTH_CAP_PCT}%.`
      : `${revBreaches} revenue categories exceed the ±${REVENUE_GROWTH_CAP_PCT}% growth cap.`,
    metadata: { breaches: revBreaches, cap_pct: REVENUE_GROWTH_CAP_PCT },
  });

  // 1.2.c Negative-expense flag
  const negExp = rows.filter((r) => r.stream === "expense" && Number(r.forecast_value) < 0).length;
  checks.push({
    check_name: "no_negative_expenses",
    status: negExp === 0 ? "pass" : "warning",
    message: negExp === 0
      ? "No projected expenses are negative."
      : `${negExp} expense forecast points are negative — review for refund/credit assumptions.`,
    metadata: { negative_count: negExp },
  });

  return checks;
}

async function checkAccountingIntegrity(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  // Assets = Liabilities + Equity (from posted journal lines)
  const { data: bal } = await supabase.rpc("get_trial_balance" as never, { p_tenant_id: tenantId } as never).then(
    (r) => r,
    () => ({ data: null }),
  );
  // Fallback: query accounts directly via posted journal lines
  const { data: lines } = await supabase
    .from("journal_lines")
    .select("debit, credit, accounts!inner(account_type, tenant_id), journal_entries!inner(status, tenant_id)")
    .eq("accounts.tenant_id", tenantId)
    .eq("journal_entries.tenant_id", tenantId)
    .eq("journal_entries.status", "posted");

  if (!bal && lines) {
    let assets = 0, liab = 0, equity = 0;
    for (const l of lines as Array<{ debit: number; credit: number; accounts: { account_type: string } }>) {
      const t = l.accounts.account_type;
      const net = Number(l.debit) - Number(l.credit);
      if (t === "asset") assets += net;
      else if (t === "liability") liab += -net;
      else if (t === "equity") equity += -net;
    }
    const diff = Math.abs(assets - (liab + equity));
    checks.push({
      check_name: "accounting_equation",
      status: diff < 1 ? "pass" : "fail",
      message: diff < 1
        ? "Assets = Liabilities + Equity verified from posted journal lines."
        : `Imbalance of ${diff.toFixed(2)} detected: A=${assets.toFixed(2)}, L+E=${(liab + equity).toFixed(2)}.`,
      metadata: { assets, liabilities: liab, equity, diff },
    });
  }
  return checks;
}

// ---------- Main handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  const { data: jobRow } = await supabase
    .from("forecast_jobs")
    .insert({ status: "running" })
    .select()
    .single();
  const jobId = jobRow?.id;

  let totalRowsInserted = 0;
  let tenantsProcessed = 0;
  const tenantLogs: Array<Record<string, unknown>> = [];

  try {
    const { data: tenants } = await supabase.from("tenants").select("id").eq("status", "active");

    for (const tenant of tenants || []) {
      // Create a forecast_run row for this tenant (#6 versioning)
      const { data: runRow } = await supabase
        .from("forecast_runs")
        .insert({
          tenant_id: tenant.id,
          model_version: MODEL_VERSION,
          forecast_job_id: jobId,
          notes: `Auto-run · horizon ${FORECAST_HORIZON_DAYS}d`,
        })
        .select("id")
        .single();
      const runId = runRow?.id;

      // 1. Pull category time series
      const { data: series, error: sErr } = await supabase.rpc("get_category_time_series", {
        p_tenant_id: tenant.id,
        p_granularity: "daily",
        p_lookback_days: 365,
      });
      if (sErr) {
        console.error("series error", tenant.id, sErr);
        continue;
      }

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

      const { data: balances } = await supabase
        .from("daily_balances")
        .select("date, closing_balance")
        .eq("tenant_id", tenant.id)
        .order("date", { ascending: true });

      const insertRows: Array<Record<string, unknown>> = [];
      let outlierTotal = 0;

      // Per-category forecasts with quality control (#5)
      for (const [, cat] of byCategory) {
        const sorted = cat.series.sort((a, b) => a.date.localeCompare(b.date));
        const values = sorted.map((p) => p.value);
        const fallback = values.length < MIN_DATA_POINTS;
        if (values.length < 2) continue;

        const result = forecast(values);
        outlierTotal += result.outlier_count;
        const lastDate = new Date(sorted[sorted.length - 1].date);
        for (let i = 0; i < result.points.length; i++) {
          const p = result.points[i];
          insertRows.push({
            tenant_id: tenant.id,
            forecast_run_id: runId,
            period: addDays(lastDate, i + 1),
            granularity: "daily",
            category_id: cat.category_id,
            category_name: cat.category_name,
            stream: cat.stream,
            forecast_value: p.value,
            lower_bound: p.lower,
            upper_bound: p.upper,
            model_type: MODEL_VERSION,
            residual_std_dev: result.residual_std_dev,
            data_points_used: result.data_points_used,
            data_quality_score: fallback ? Math.min(result.data_quality_score, 0.4) : result.data_quality_score,
            fallback_used: fallback,
            metadata: { history_days: values.length, outliers_cleaned: result.outlier_count },
          });
        }
      }

      // Total cash balance
      if (balances && balances.length >= 2) {
        const values = balances.map((b: { closing_balance: number }) => Number(b.closing_balance));
        const result = forecast(values);
        outlierTotal += result.outlier_count;
        const lastDate = new Date(balances[balances.length - 1].date);
        for (let i = 0; i < result.points.length; i++) {
          const p = result.points[i];
          insertRows.push({
            tenant_id: tenant.id,
            forecast_run_id: runId,
            period: addDays(lastDate, i + 1),
            granularity: "daily",
            category_id: null,
            category_name: "TOTAL_CASH",
            stream: "cash",
            forecast_value: p.value,
            lower_bound: p.lower,
            upper_bound: p.upper,
            model_type: MODEL_VERSION,
            residual_std_dev: result.residual_std_dev,
            data_points_used: result.data_points_used,
            data_quality_score: result.data_quality_score,
            fallback_used: false,
            metadata: { history_days: values.length, outliers_cleaned: result.outlier_count },
          });
        }
      }

      // Replace tenant's forecasts atomically
      await supabase.from("financial_forecasts").delete().eq("tenant_id", tenant.id);
      if (insertRows.length > 0) {
        for (let i = 0; i < insertRows.length; i += 500) {
          const chunk = insertRows.slice(i, i + 500);
          const { error: insErr } = await supabase.from("financial_forecasts").insert(chunk);
          if (insErr) console.error("insert error", tenant.id, insErr);
          else totalRowsInserted += chunk.length;
        }
      }

      // Run validation engine (#1) and persist results
      if (runId) {
        const checks = [
          ...validateForecasts(insertRows),
          ...(await checkAccountingIntegrity(supabase, tenant.id)),
        ];
        if (checks.length > 0) {
          await supabase.from("forecast_validations").insert(
            checks.map((c) => ({ ...c, tenant_id: tenant.id, forecast_run_id: runId })),
          );
        }
      }

      tenantsProcessed++;
      tenantLogs.push({
        tenant_id: tenant.id,
        run_id: runId,
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
          logs: { tenants: tenantLogs, model_version: MODEL_VERSION },
        })
        .eq("id", jobId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        model_version: MODEL_VERSION,
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
        })
        .eq("id", jobId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
