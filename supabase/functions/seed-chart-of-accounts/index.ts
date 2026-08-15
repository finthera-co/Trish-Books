import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { uuid, validateBody } from "../_shared/validate.ts";

// A new tenant's Chart of Accounts starts EMPTY except for the single system
// Opening Balance Equity account (code 3900). No default COA accounts and no
// default categories are seeded. Users build their own COA manually.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const v = await validateBody(req, { tenant_id: uuid() });
    if (!v.ok) throw new Error(v.message);
    const { tenant_id } = v.value;

    // The tenant to seed arrives in the body and is then written with the
    // service_role client, so accepting it on the caller's word alone let any
    // signed-in user create an account row inside another company. Two callers
    // are legitimate: provision-tenant, which calls in with the service key, and
    // a Super Admin re-seeding by hand. Anyone else is pinned to their own tenant.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (bearer !== serviceRoleKey) {
      const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      const { data: isSA } = await callerClient.rpc("is_super_admin");
      if (!isSA) {
        const { data: callerTenantId } = await callerClient.rpc("get_user_tenant_id");
        if (!callerTenantId || callerTenantId !== tenant_id) {
          throw new Error("Unauthorized: cannot seed accounts for another company");
        }
      }
    }

    // Keyed per tenant. Provisioning calls this exactly once per new tenant, so
    // a 10/hr tenant bucket cannot interfere with provision-tenant or
    // provision-google-user; it only stops one tenant being seeded repeatedly.
    {
      const { blocked } = await enforceRateLimit(adminClient, "seed-chart-of-accounts", {
        userId: null,
        tenantId: tenant_id,
        ip: clientIp(req),
      });
      if (blocked) return blocked;
    }

    // Idempotent: skip if the system OBE account (code 3900) already exists.
    const { data: existingOBE } = await adminClient
      .from("accounts")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("account_code", "3900")
      .eq("is_system", true)
      .limit(1);
    if (existingOBE && existingOBE.length > 0) {
      return new Response(
        JSON.stringify({ success: true, accounts: 0, categories: 0, skipped: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert ONLY the Opening Balance Equity system account. No categories.
    const { error: accErr } = await adminClient.from("accounts").insert({
      tenant_id,
      account_code: "3900",
      account_name: "Opening Balance Equity",
      account_type: "Equity",
      account_subtype: "Opening Balance Equity",
      normal_balance: "credit",
      is_system: true,
      is_active: true,
    });
    if (accErr) throw new Error(`Account error: ${accErr.message}`);

    return new Response(
      JSON.stringify({ success: true, accounts: 1, categories: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
