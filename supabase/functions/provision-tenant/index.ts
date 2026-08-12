import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the caller is a Super Admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Client with caller's JWT to verify they're Super Admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: isSA } = await callerClient.rpc("is_super_admin");
    if (!isSA) throw new Error("Unauthorized: Super Admin only");

    // Service role client for admin operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Runs AFTER the Super Admin check (never limit on an unresolved identity)
    // but BEFORE any tenant/auth-user is created, so a rejected call provisions
    // nothing. Only the `ip` rule applies here: no tenant exists yet to key on.
    const { blocked, headers: rlHeaders } = await enforceRateLimit(
      adminClient,
      "provision-tenant",
      { userId: null, tenantId: null, ip: clientIp(req) },
    );
    if (blocked) return blocked;

    const body = await req.json();
    const {
      company_name,
      country,
      industry,
      subscription_plan_id,
      admin_email,
      admin_password,
      admin_first_name,
      admin_last_name,
    } = body;

    if (!company_name || !admin_email || !admin_password || !admin_first_name || !admin_last_name) {
      throw new Error("Missing required fields");
    }

    if (admin_password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    // 1. Create the auth user (auto-confirm email)
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: admin_email,
      password: admin_password,
      email_confirm: true,
    });

    if (authError) throw new Error(`Auth error: ${authError.message}`);

    // 2. Create the tenant
    const { data: tenantData, error: tenantError } = await adminClient
      .from("tenants")
      .insert({
        company_name,
        country: country || null,
        industry: industry || null,
        subscription_plan_id: subscription_plan_id || null,
      })
      .select()
      .single();

    if (tenantError) {
      // Rollback: delete auth user
      await adminClient.auth.admin.deleteUser(authData.user.id);
      throw new Error(`Tenant error: ${tenantError.message}`);
    }

    // 3. Get Company Admin role
    const { data: roleData } = await adminClient
      .from("roles")
      .select("id")
      .eq("role_name", "Company Admin")
      .single();

    // 4. Create user record
    const { data: userData, error: userError } = await adminClient
      .from("users")
      .insert({
        auth_user_id: authData.user.id,
        tenant_id: tenantData.id,
        email: admin_email,
        first_name: admin_first_name,
        last_name: admin_last_name,
        role_id: roleData?.id,
      })
      .select()
      .single();

    if (userError) {
      // Rollback
      await adminClient.auth.admin.deleteUser(authData.user.id);
      await adminClient.from("tenants").delete().eq("id", tenantData.id);
      throw new Error(`User error: ${userError.message}`);
    }

    // 5. Seed Chart of Accounts
    // Creates only the system Opening Balance Equity account (no default COA).
    try {
      const seedRes = await fetch(`${supabaseUrl}/functions/v1/seed-chart-of-accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ tenant_id: tenantData.id }),
      });
      const seedResult = await seedRes.json();
      if (!seedResult.success) {
        console.error("COA seed warning:", seedResult.error);
      }
    } catch (seedErr) {
      console.error("COA seed failed (non-fatal):", seedErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        tenant: tenantData,
        user: {
          id: userData.id,
          email: admin_email,
          first_name: admin_first_name,
          last_name: admin_last_name,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", ...rlHeaders } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
