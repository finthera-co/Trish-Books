import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    if (admin_password.length < 6) {
      throw new Error("Password must be at least 6 characters");
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
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
