import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Thin wrapper around generate_recurring_checks(): all the generation logic
// (schedule advance, creator impersonation for posting) lives in the SQL
// RPC — this just invokes it with the service-role key so auth.uid() is
// NULL inside the RPC, which is how it knows to process every tenant's due
// templates rather than scoping to a single caller's tenant. Mirrors
// generate-recurring-bills/index.ts.
//
// NOT currently scheduled on a cron job — the 'service_role_key' vault
// secret this and every other cron→edge-function call depends on is
// missing (confirmed 2026-08-22; see project memory
// project_vault_service_role_missing.md), so a new cron job here would
// just be a 5th silently-failing one alongside the existing 3 pointed at a
// dead project ref. Trigger manually via the "Run Now" button on
// /banking/recurring-checks (calls generate_recurring_checks() directly
// under the caller's own auth) until that's fixed.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await admin.rpc("generate_recurring_checks");
  if (error) return json({ ok: false, error: error.message });

  return json(data);
});
