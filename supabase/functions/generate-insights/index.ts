import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get all active tenants
    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id")
      .eq("status", "active");

    if (tErr) throw tErr;

    const results: { tenant_id: string; insights: number }[] = [];

    for (const tenant of tenants || []) {
      const insights: { type: string; message: string; severity: string }[] = [];

      // --- Expense Change Insight ---
      const { data: monthly } = await supabase
        .from("monthly_financials")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("month", { ascending: false })
        .limit(2);

      if (monthly && monthly.length >= 2) {
        const current = Number(monthly[0].total_expense);
        const previous = Number(monthly[1].total_expense);
        if (previous > 0) {
          const change = ((current - previous) / previous) * 100;
          const absChange = Math.abs(change).toFixed(1);
          let severity = "info";
          if (change > 20) severity = "warning";
          if (change > 50) severity = "critical";

          insights.push({
            type: "expense_change",
            message: `Expenses ${change > 0 ? "increased" : "decreased"} by ${absChange}% compared to last month`,
            severity,
          });
        }
      }

      // --- Income Change Insight ---
      if (monthly && monthly.length >= 2) {
        const current = Number(monthly[0].total_income);
        const previous = Number(monthly[1].total_income);
        if (previous > 0) {
          const change = ((current - previous) / previous) * 100;
          const absChange = Math.abs(change).toFixed(1);
          let severity = "info";
          if (change < -20) severity = "warning";
          if (change < -50) severity = "critical";

          insights.push({
            type: "income_change",
            message: `Income ${change > 0 ? "increased" : "decreased"} by ${absChange}% compared to last month`,
            severity,
          });
        }
      }

      // --- Cash Runway ---
      const { data: balances } = await supabase
        .from("daily_balances")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("date", { ascending: false })
        .limit(30);

      if (balances && balances.length > 1) {
        const latestBalance = Number(balances[0].closing_balance);
        let totalDrop = 0;
        let dropDays = 0;

        for (let i = 0; i < balances.length - 1; i++) {
          const diff =
            Number(balances[i].closing_balance) -
            Number(balances[i + 1].closing_balance);
          if (diff < 0) {
            // balance decreased = spending
            totalDrop += Math.abs(diff);
            dropDays++;
          }
        }

        const avgDailyExpense = dropDays > 0 ? totalDrop / dropDays : 0;

        if (avgDailyExpense > 0) {
          const runwayDays = latestBalance / avgDailyExpense;
          const runwayMonths = (runwayDays / 30).toFixed(1);

          let severity = "info";
          if (runwayDays < 90) severity = "warning";
          if (runwayDays < 30) severity = "critical";

          insights.push({
            type: "cash_runway",
            message: `Cash runway: ${runwayMonths} months remaining`,
            severity,
          });
        }
      }

      // --- Net Profit Margin ---
      if (monthly && monthly.length >= 1) {
        const income = Number(monthly[0].total_income);
        const expense = Number(monthly[0].total_expense);
        if (income > 0) {
          const margin = ((income - expense) / income) * 100;
          let severity = "info";
          if (margin < 10) severity = "warning";
          if (margin < 0) severity = "critical";

          insights.push({
            type: "profit_margin",
            message: `Net profit margin this month: ${margin.toFixed(1)}%`,
            severity,
          });
        }
      }

      // Delete old insights for this tenant (keep last 7 days)
      await supabase
        .from("insights")
        .delete()
        .eq("tenant_id", tenant.id)
        .lt(
          "created_at",
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        );

      // Insert new insights
      if (insights.length > 0) {
        const rows = insights.map((i) => ({
          tenant_id: tenant.id,
          ...i,
        }));
        await supabase.from("insights").insert(rows);
      }

      results.push({ tenant_id: tenant.id, insights: insights.length });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
