import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // This handler does no auth of its own and sweeps EVERY active tenant, so
    // without resolving the caller the limiter would have no identity to key on
    // and every rule would be skipped. verify_jwt is enabled for this function,
    // so a bearer token is always present; we resolve it purely to key the
    // limiter, not to change who may call this route.
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

    // Before the cross-tenant sweep below — no scan happens on a rejected call.
    const { blocked, headers: rlHeaders } = await enforceRateLimit(
      supabase,
      "detect-anomalies",
      {
        userId: appUser?.id ?? null,
        tenantId: appUser?.tenant_id ?? null,
        ip: clientIp(req),
      },
    );
    if (blocked) return blocked;

    const { data: tenants } = await supabase
      .from("tenants")
      .select("id")
      .eq("status", "active");

    const results: { tenant_id: string; anomalies: number }[] = [];

    for (const tenant of tenants || []) {
      const { data: transactions } = await supabase
        .from("transactions")
        .select("id, amount, type, description, date, category")
        .eq("tenant_id", tenant.id);

      if (!transactions || transactions.length < 5) {
        results.push({ tenant_id: tenant.id, anomalies: 0 });
        continue;
      }

      const amounts = transactions.map((t) => Number(t.amount));
      const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const std = Math.sqrt(
        amounts.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) /
          amounts.length
      );

      if (std === 0) {
        results.push({ tenant_id: tenant.id, anomalies: 0 });
        continue;
      }

      const anomalies = transactions.filter((t) => {
        const z = Math.abs((Number(t.amount) - mean) / std);
        return z > 3;
      });

      // Clear old pending anomalies for this tenant before inserting new ones
      await supabase
        .from("anomalies")
        .delete()
        .eq("tenant_id", tenant.id)
        .eq("status", "pending");

      if (anomalies.length > 0) {
        const rows = anomalies.map((t) => {
          const z = Math.abs((Number(t.amount) - mean) / std);
          const direction = Number(t.amount) > mean ? "high" : "low";
          const typeLabel = t.type === "expense" ? "expense" : "income";
          return {
            transaction_id: t.id,
            tenant_id: tenant.id,
            score: Math.round(z * 100) / 100,
            reason: `Unusually ${direction} ${typeLabel}: ${t.description || "N/A"} (${t.amount}) — Z-score: ${z.toFixed(2)}`,
            status: "pending",
          };
        });

        await supabase.from("anomalies").insert(rows);
      }

      results.push({ tenant_id: tenant.id, anomalies: anomalies.length });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", ...rlHeaders },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
