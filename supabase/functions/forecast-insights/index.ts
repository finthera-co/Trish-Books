// AI-generated forecast insights using Lovable AI Gateway.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI gateway not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Aggregate forecast data
    const { data: forecasts } = await supabase
      .from("financial_forecasts")
      .select("period, stream, category_name, forecast_value, lower_bound, upper_bound")
      .eq("tenant_id", tenant_id)
      .gte("period", new Date().toISOString().slice(0, 10))
      .order("period", { ascending: true })
      .limit(500);

    if (!forecasts?.length) {
      return json({ insights: [], message: "No forecast data available yet." });
    }

    const summary = {
      cash: forecasts.filter((f) => f.stream === "cash").slice(0, 30),
      revenue_categories: aggregateByCategory(forecasts.filter((f) => f.stream === "revenue")),
      expense_categories: aggregateByCategory(forecasts.filter((f) => f.stream === "expense")),
    };

    const prompt = `You are a financial analyst. Analyze this 30-day forecast for a Sri Lankan business (LKR currency) and produce 3-5 concise, actionable insights.

Data: ${JSON.stringify(summary).slice(0, 6000)}

Return STRICT JSON only:
{
  "insights": [
    {
      "type": "growth_opportunity" | "cost_warning" | "cash_alert" | "investment_suggestion",
      "title": "short title",
      "message": "one-sentence actionable insight",
      "severity": "info" | "warning" | "critical"
    }
  ]
}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a precise financial analyst. Always return valid JSON." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "Rate limit reached. Try again shortly." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted. Add credits in workspace settings." }, 402);
      const t = await aiResp.text();
      return json({ error: `AI error: ${t}` }, 500);
    }

    const ai = await aiResp.json();
    const content = ai.choices?.[0]?.message?.content ?? "{}";
    const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
    let parsed: { insights?: unknown[] } = {};
    try { parsed = JSON.parse(cleaned); } catch { parsed = { insights: [] }; }

    return json({ insights: parsed.insights ?? [], generated_at: new Date().toISOString() });
  } catch (e) {
    console.error("forecast-insights error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function aggregateByCategory(rows: Array<{ category_name: string; forecast_value: number }>) {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.category_name, (map.get(r.category_name) ?? 0) + Number(r.forecast_value));
  }
  return Array.from(map.entries())
    .map(([name, total]) => ({ name, total: Math.round(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
