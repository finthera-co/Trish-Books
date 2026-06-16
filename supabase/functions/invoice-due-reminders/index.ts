import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Days from today to due_date at which a reminder fires. One notification per
// milestone day (7/3/1 before, due day, then 1/7/14/30 overdue) means no
// dedupe table is needed; a same-day guard covers double cron runs.
const MILESTONES = [7, 3, 1, 0, -1, -7, -14, -30];

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

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const lo = new Date(today); lo.setUTCDate(lo.getUTCDate() - 30);
  const hi = new Date(today); hi.setUTCDate(hi.getUTCDate() + 7);

  // Still-owing receivables (fully open or partially paid) whose due date sits
  // inside the milestone window.
  const { data: txns, error } = await admin
    .from("ar_transactions")
    .select("id, tenant_id, document_ref, due_date, outstanding_amount")
    .in("status", ["OPEN", "PARTIALLY_PAID"])
    .gt("outstanding_amount", 0)
    .gte("due_date", iso(lo))
    .lte("due_date", iso(hi));

  if (error) return json({ ok: false, error: error.message });

  let created = 0;
  for (const t of txns ?? []) {
    if (!t.due_date) continue;
    const due = new Date(t.due_date + "T00:00:00Z");
    const offset = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (!MILESTONES.includes(offset)) continue;

    const overdue = offset < 0;
    const amt = Number(t.outstanding_amount).toLocaleString();
    const label =
      offset === 0 ? "is due today"
      : overdue   ? `is ${Math.abs(offset)} day(s) overdue`
      :             `is due in ${offset} day(s)`;

    const link = `/sales/invoices`;
    const title = overdue ? "Invoice overdue" : "Invoice due soon";
    const message = `Invoice ${t.document_ref ?? ""} (outstanding ${amt}) ${label}.`;

    // Same-day guard: skip if an identical alert already went out today.
    const { data: dupe } = await admin
      .from("notifications")
      .select("id")
      .eq("tenant_id", t.tenant_id)
      .eq("message", message)
      .gte("created_at", iso(today))
      .limit(1);
    if (dupe?.length) continue;

    const { error: insErr } = await admin.from("notifications").insert({
      tenant_id: t.tenant_id,
      user_id: null,            // tenant-wide broadcast (NotificationBell shows these)
      type: "warning",
      title,
      message,
      link,
    });
    if (!insErr) created++;
  }

  return json({ ok: true, scanned: txns?.length ?? 0, created });
});
