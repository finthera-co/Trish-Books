// AI-generated structured forecast insights via Lovable AI Gateway.
// Returns STRICT JSON: { risks, opportunities, recommended_actions }
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

    const { data: forecasts } = await supabase
      .from("financial_forecasts")
      .select("period, stream, category_name, forecast_value, lower_bound, upper_bound")
      .eq("tenant_id", tenant_id)
      .gte("period", new Date().toISOString().slice(0, 10))
      .order("period", { ascending: true })
      .limit(500);

    if (!forecasts?.length) {
      return json({
        risks: [],
        opportunities: [],
        recommended_actions: [],
        message: "No forecast data available yet.",
      });
    }

    // Build context per spec (#8): top growing/declining + cost drivers
    const revAgg = aggregateGrowth(forecasts.filter((f) => f.stream === "revenue"));
    const expAgg = aggregateGrowth(forecasts.filter((f) => f.stream === "expense"));

    const summary = {
      top_growing: revAgg.slice(0, 3),
      top_declining: revAgg.filter((c) => c.growth_pct < 0).slice(-3).reverse(),
      largest_cost_drivers: expAgg.slice(0, 3),
      cash_horizon: forecasts.filter((f) => f.stream === "cash").slice(0, 30),
    };

    const prompt = `You are a senior FP&A analyst. Analyse this 30-day forecast for a Sri Lankan business (LKR currency).

Data: ${JSON.stringify(summary).slice(0, 6000)}

Return STRICT JSON only — no prose, no markdown. Use this exact shape:
{
  "risks": [{"title": "string", "severity": "low|medium|high", "detail": "one sentence"}],
  "opportunities": [{"title": "string", "impact": "low|medium|high", "detail": "one sentence"}],
  "recommended_actions": [{"title": "string", "owner": "Finance|Sales|Operations|Leadership", "detail": "one sentence"}]
}

Provide 2-4 items in each array.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a precise FP&A analyst. Always return valid JSON matching the requested schema." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "Rate limit reached. Try again shortly." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
      const t = await aiResp.text();
      return json({ error: `AI error: ${t}` }, 500);
    }

    const ai = await aiResp.json();
    const content = ai.choices?.[0]?.message?.content ?? "{}";
    const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
    let parsed: { risks?: unknown[]; opportunities?: unknown[]; recommended_actions?: unknown[] } = {};
    try { parsed = JSON.parse(cleaned); } catch { parsed = {}; }

    return json({
      risks: parsed.risks ?? [],
      opportunities: parsed.opportunities ?? [],
      recommended_actions: parsed.recommended_actions ?? [],
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("forecast-insights error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function aggregateGrowth(rows: Array<{ category_name: string; forecast_value: number; period: string }>) {
  const byCat = new Map<string, { name: string; first: number; last: number; total: number }>();
  for (const r of rows.sort((a, b) => a.period.localeCompare(b.period))) {
    const k = r.category_name;
    const v = Number(r.forecast_value);
    if (!byCat.has(k)) byCat.set(k, { name: k, first: v, last: v, total: 0 });
    const e = byCat.get(k)!;
    e.last = v;
    e.total += v;
  }
  return Array.from(byCat.values())
    .map((c) => ({
      name: c.name,
      total: Math.round(c.total),
      growth_pct: c.first === 0 ? 0 : Math.round(((c.last - c.first) / Math.abs(c.first)) * 100),
    }))
    .sort((a, b) => b.total - a.total);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
