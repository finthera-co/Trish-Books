import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The scan itself lives in public.run_invoice_due_reminders(), which pg_cron
// calls directly every day at 08:00 UTC (see
// 20261101090000_invoice_due_reminders_in_db.sql). This function is only a
// manual trigger for the same logic; its execute grant is service_role only.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await admin.rpc("run_invoice_due_reminders");
  if (error) return json({ ok: false, error: error.message }, 500);
  return json(data);
});
