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
    const { user_id, email, first_name, last_name } = body;

    if (!user_id) throw new Error("Missing user_id");
    if (!email || !first_name || !last_name) {
      throw new Error("Missing required fields");
    }

    const newEmail = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
      throw new Error("Invalid email address");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Load the target user
    const { data: target, error: targetError } = await adminClient
      .from("users")
      .select("id, auth_user_id, tenant_id, email, roles(role_name)")
      .eq("id", user_id)
      .single();

    if (targetError || !target) throw new Error("User not found");

    // Non-super-admins can only edit users in their own tenant
    if (!isSA && target.tenant_id !== callerTenantId) {
      throw new Error("Cannot edit users in other tenants");
    }

    // Role hierarchy: only a Super Admin may edit a Super Admin, and only a
    // Primary Admin / Super Admin may edit the company owner. Without this a
    // Company Admin could point the owner's login at their own mailbox and take
    // it over via password reset.
    const targetRoleName = (target.roles as any)?.role_name;
    if (targetRoleName === "Super Admin" && !isSA) {
      throw new Error("Cannot edit Super Admin users");
    }
    if (targetRoleName === "Primary Admin" && !isSA && roleName !== "Primary Admin") {
      throw new Error("Only the company owner or a Super Admin can edit the Primary Admin");
    }

    const emailChanged = newEmail !== (target.email || "").toLowerCase();

    // Reject a login email already used by another account
    if (emailChanged) {
      const { data: clash } = await adminClient
        .from("users")
        .select("id")
        .ilike("email", newEmail)
        .neq("id", user_id)
        .maybeSingle();

      if (clash) throw new Error("That email is already in use by another user");
    }

    // 1. Update the auth identity so the new address is what they log in with
    if (emailChanged) {
      if (!target.auth_user_id) {
        throw new Error("This user has no login account yet — email cannot be changed");
      }
      const { error: authError } = await adminClient.auth.admin.updateUserById(
        target.auth_user_id,
        { email: newEmail, email_confirm: true }
      );
      if (authError) throw new Error(authError.message);
    }

    // 2. Update the profile row
    const { data: userData, error: userError } = await adminClient
      .from("users")
      .update({
        email: newEmail,
        first_name: String(first_name).trim(),
        last_name: String(last_name).trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", user_id)
      .select("*, roles(role_name)")
      .single();

    if (userError) {
      // Roll the auth email back so the two stores cannot drift apart
      if (emailChanged && target.auth_user_id) {
        await adminClient.auth.admin.updateUserById(target.auth_user_id, {
          email: target.email,
          email_confirm: true,
        });
      }
      throw new Error(userError.message);
    }

    return new Response(
      JSON.stringify({ success: true, user: userData, email_changed: emailChanged }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
