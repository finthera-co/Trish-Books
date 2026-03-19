import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function linearRegression(balances: { date: string; closing_balance: number }[]) {
  const n = balances.length;
  if (n < 2) return null;

  const y = balances.map((b) => Number(b.closing_balance));
  const x = balances.map((_, i) => i);

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;

  return { m, b, n };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: tenants } = await supabase
      .from("tenants")
      .select("id")
      .eq("status", "active");

    const results: { tenant_id: string; forecast_days: number }[] = [];

    for (const tenant of tenants || []) {
      const { data: balances } = await supabase
        .from("daily_balances")
        .select("date, closing_balance")
        .eq("tenant_id", tenant.id)
        .order("date", { ascending: true });

      if (!balances || balances.length < 2) {
        results.push({ tenant_id: tenant.id, forecast_days: 0 });
        continue;
      }

      const model = linearRegression(balances);
      if (!model) {
        results.push({ tenant_id: tenant.id, forecast_days: 0 });
        continue;
      }

      // Generate 30-day forecast
      const lastDate = new Date(balances[balances.length - 1].date);
      const forecastRows: { tenant_id: string; date: string; predicted_balance: number }[] = [];

      for (let i = 1; i <= 30; i++) {
        const futureDate = new Date(lastDate);
        futureDate.setDate(futureDate.getDate() + i);
        const predicted = model.m * (model.n - 1 + i) + model.b;

        forecastRows.push({
          tenant_id: tenant.id,
          date: futureDate.toISOString().split("T")[0],
          predicted_balance: Math.round(predicted * 100) / 100,
        });
      }

      // Clear old forecasts
      await supabase
        .from("cashflow_forecast")
        .delete()
        .eq("tenant_id", tenant.id);

      // Insert new
      if (forecastRows.length > 0) {
        await supabase.from("cashflow_forecast").insert(forecastRows);
      }

      results.push({ tenant_id: tenant.id, forecast_days: forecastRows.length });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
