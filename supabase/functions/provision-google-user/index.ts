import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  company_name: z.string().min(1).max(255).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authUser = userData.user;
    const body = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Already provisioned?
    const { data: existing } = await admin
      .from("users")
      .select("id, tenant_id")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ ok: true, already_provisioned: true, user_id: existing.id, tenant_id: existing.tenant_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const meta = (authUser.user_metadata ?? {}) as Record<string, any>;
    const fullName: string = meta.full_name || meta.name || "";
    const [firstNameRaw, ...rest] = fullName.split(" ");
    const firstName = meta.given_name || firstNameRaw || (authUser.email?.split("@")[0] ?? "User");
    const lastName = meta.family_name || rest.join(" ") || "";

    const companyName =
      parsed.data.company_name?.trim() ||
      `${firstName}'s Workspace`;

    // Get Starter plan
    const { data: plan } = await admin
      .from("subscription_plans")
      .select("id")
      .eq("name", "Starter")
      .maybeSingle();

    // Create tenant
    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .insert({ company_name: companyName, subscription_plan_id: plan?.id })
      .select("id")
      .single();
    if (tenantErr) throw tenantErr;

    // Primary Admin role
    const { data: role } = await admin
      .from("roles")
      .select("id")
      .eq("role_name", "Primary Admin")
      .maybeSingle();

    const { data: user, error: userInsertErr } = await admin
      .from("users")
      .insert({
        auth_user_id: authUser.id,
        tenant_id: tenant.id,
        email: authUser.email!,
        first_name: firstName,
        last_name: lastName,
        role_id: role?.id,
        is_primary: true,
      })
      .select("id")
      .single();
    if (userInsertErr) throw userInsertErr;

    // Seed default Chart of Accounts for the new tenant
    try {
      const seedRes = await fetch(`${SUPABASE_URL}/functions/v1/seed-chart-of-accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({ tenant_id: tenant.id }),
      });
      const seedResult = await seedRes.json();
      if (!seedResult.success) {
        console.error("COA seed warning:", seedResult.error);
      }
    } catch (seedErr) {
      console.error("COA seed failed (non-fatal):", seedErr);
    }

    return new Response(
      JSON.stringify({ ok: true, user_id: user.id, tenant_id: tenant.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("provision-google-user error", e);
    return new Response(JSON.stringify({ error: e.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
