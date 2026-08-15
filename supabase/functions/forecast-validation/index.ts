// Forecast Validation API — returns persisted validation results
// for the latest forecast_run of a tenant (#10).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as baseCors } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { assertCallerTenant, resolveCaller } from "../_shared/validate.ts";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { tenant_id, forecast_run_id } = await req.json().catch(() => ({}));
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // This handler runs as service role with no caller identity, so the caller is
    // resolved by hand. It keys the limiter — body-supplied tenant_id is
    // deliberately NOT used for that, since a caller could vary it to sidestep
    // their own bucket — and it is what tenant_id is authorised against below.
    const caller = await resolveCaller(supabase, req);
    const { blocked } = await enforceRateLimit(supabase, "forecast-validation", {
      userId: caller?.id ?? null,
      tenantId: caller?.tenant_id ?? null,
      ip: clientIp(req),
    });
    if (blocked) return blocked;

    // Every read below filters on the body's tenant_id with the service_role
    // client, which applies no RLS — so without this the route returned another
    // company's figures to anyone who asked for them by id.
    const tenantErr = assertCallerTenant(caller, tenant_id);
    if (tenantErr) return json({ error: tenantErr }, tenantErr === "Unauthorized" ? 401 : 403);


    // Resolve target run
    let runId = forecast_run_id;
    if (!runId) {
      const { data: latest } = await supabase
        .from("forecast_runs")
        .select("id, run_timestamp, model_version")
        .eq("tenant_id", tenant_id)
        .order("run_timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();
      runId = latest?.id;
      if (!runId) return json({ checks: [], summary: { total: 0, pass: 0, fail: 0, warning: 0 } });
    }

    const { data: checks } = await supabase
      .from("forecast_validations")
      .select("check_name, status, message, metadata, created_at")
      .eq("forecast_run_id", runId)
      .order("created_at", { ascending: true });

    const summary = (checks ?? []).reduce(
      (acc, c) => {
        acc.total++;
        if (c.status === "pass") acc.pass++;
        else if (c.status === "fail") acc.fail++;
        else acc.warning++;
        return acc;
      },
      { total: 0, pass: 0, fail: 0, warning: 0 },
    );

    return json({ forecast_run_id: runId, checks: checks ?? [], summary });
  } catch (e) {
    console.error("forecast-validation error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
