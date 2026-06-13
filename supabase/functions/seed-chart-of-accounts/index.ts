import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { tenant_id } = await req.json();
    if (!tenant_id) throw new Error("Missing tenant_id");

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
