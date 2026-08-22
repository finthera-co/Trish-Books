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

// Thin wrapper around generate_recurring_bills(): all the generation logic
// (schedule advance, draft-vs-auto_post, creator impersonation for posting)
// lives in the SQL RPC — this just invokes it with the service-role key so
// auth.uid() is NULL inside the RPC, which is how it knows to process every
// tenant's due templates rather than scoping to a single caller's tenant.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await admin.rpc("generate_recurring_bills");
  if (error) return json({ ok: false, error: error.message });

  return json(data);
});
