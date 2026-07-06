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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is an admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: roleName } = await callerClient.rpc("get_user_role_name");
    const allowedRoles = ["Super Admin", "Primary Admin", "Company Admin"];
    if (!allowedRoles.includes(roleName)) {
      throw new Error("Unauthorized: Admin role required");
    }

    const { data: callerTenantId } = await callerClient.rpc("get_user_tenant_id");
    const { data: isSA } = await callerClient.rpc("is_super_admin");

    const body = await req.json();
    const { email, password, first_name, last_name, role_id, tenant_id } = body;

    if (!email || !password || !first_name || !last_name || !role_id) {
      throw new Error("Missing required fields");
    }

    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    // Determine target tenant
    const targetTenantId = isSA && tenant_id ? tenant_id : callerTenantId;
    if (!targetTenantId) throw new Error("No tenant context");

    // Non-super-admins can only create users in their own tenant
    if (!isSA && tenant_id && tenant_id !== callerTenantId) {
      throw new Error("Cannot create users in other tenants");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Prevent non-super-admins from creating super admin users
    const { data: targetRole } = await adminClient
      .from("roles")
      .select("role_name")
      .eq("id", role_id)
      .single();

    if (!isSA && targetRole?.role_name === "Super Admin") {
      throw new Error("Cannot create Super Admin users");
    }

    // 1. Create auth user with confirmed email
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) throw new Error(authError.message);

    // 2. Create user record in public.users
    const { data: userData, error: userError } = await adminClient
      .from("users")
      .insert({
        auth_user_id: authData.user.id,
        tenant_id: targetTenantId,
        email,
        first_name,
        last_name,
        role_id,
      })
      .select("*, roles(role_name)")
      .single();

    if (userError) {
      // Rollback auth user
      await adminClient.auth.admin.deleteUser(authData.user.id);
      throw new Error(userError.message);
    }

    return new Response(
      JSON.stringify({ success: true, user: userData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
