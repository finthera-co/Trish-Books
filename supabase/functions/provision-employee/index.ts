import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fields that belong to the employees table. Anything else in the payload is ignored.
const EMPLOYEE_FIELDS = [
  "first_name", "middle_name", "last_name", "email", "nic_number", "tin_number",
  "date_of_birth", "gender", "civil_status", "personal_phone",
  "address_line1", "address_line2", "city", "district", "postal_code",
  "designation", "department", "hire_date", "employment_type", "pay_rate_type",
  "status", "manager_id", "epf_number", "is_epf_applicable", "is_etf_applicable",
  "is_paye_applicable", "bank_name", "bank_branch", "bank_account_no",
  "bank_account_name", "biometric_id", "photo_url",
];

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
    const { email, password, first_name, last_name } = body;

    if (!email || !password || !first_name) {
      throw new Error("Email, password and first name are required");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    // Super admin may target another tenant; everyone else is pinned to their own.
    const targetTenantId = isSA && body.tenant_id ? body.tenant_id : callerTenantId;
    if (!targetTenantId) throw new Error("No tenant context");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Resolve the Employee role id
    const { data: empRole, error: roleErr } = await adminClient
      .from("roles")
      .select("id")
      .eq("role_name", "Employee")
      .single();
    if (roleErr || !empRole) throw new Error("Employee role not found");

    // 1. Create the auth user (email pre-confirmed; they sign in with the temp password)
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError) throw new Error(authError.message);
    const authUserId = authData.user.id;

    // 2. Create the users row (role = Employee)
    const { data: userData, error: userError } = await adminClient
      .from("users")
      .insert({
        auth_user_id: authUserId,
        tenant_id: targetTenantId,
        email,
        first_name,
        last_name: last_name || "",
        role_id: empRole.id,
      })
      .select("id")
      .single();
    if (userError) {
      await adminClient.auth.admin.deleteUser(authUserId);
      throw new Error(userError.message);
    }

    // 3. Create the employee row, linked to the login
    const employeePayload: Record<string, unknown> = {
      tenant_id: targetTenantId,
      user_id: userData.id,
    };
    for (const key of EMPLOYEE_FIELDS) {
      const v = body[key];
      if (typeof v === "boolean") employeePayload[key] = v;
      else if (v !== "" && v != null) employeePayload[key] = v;
    }
    employeePayload.last_name = last_name || "";

    const { data: empData, error: empError } = await adminClient
      .from("employees")
      .insert(employeePayload)
      .select("*")
      .single();
    if (empError) {
      // Roll back both the users row and the auth user
      await adminClient.from("users").delete().eq("id", userData.id);
      await adminClient.auth.admin.deleteUser(authUserId);
      throw new Error(empError.message);
    }

    return new Response(
      JSON.stringify({ success: true, employee: empData, user_id: userData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
