import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Buckets whose object paths are all prefixed with `${tenant_id}/`.
// invoice-assets is excluded (shared logos, not tenant-prefixed); receipts is
// excluded (orphaned bucket, unused by the app).
const TENANT_BUCKETS = [
  "invoice-attachments",
  "employee-photos",
  "bank-statements",
  "csv-exports",
  "petty-cash-receipts",
];

const FALLBACK_CAP_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, for tenants on a null/legacy plan

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Recursively sum object sizes under `prefix` in a bucket. */
async function sumBucketBytes(
  client: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<number> {
  let total = 0;
  const queue = [prefix];

  while (queue.length) {
    const dir = queue.shift()!;
    let offset = 0;

    for (;;) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(dir, { limit: 1000, offset });
      if (error) throw new Error(`list ${bucket}/${dir}: ${error.message}`);
      if (!data || data.length === 0) break;

      for (const entry of data) {
        const full = dir ? `${dir}/${entry.name}` : entry.name;
        // Folders come back with no id/metadata.
        if (entry.id === null) queue.push(full);
        else total += entry.metadata?.size ?? 0;
      }

      if (data.length < 1000) break;
      offset += data.length;
    }
  }

  return total;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tenants, error: tenantsError } = await admin
    .from("tenants")
    .select("id, subscription_plan_id")
    .is("deleted_at", null);
  if (tenantsError) return json({ ok: false, error: tenantsError.message });

  const { data: plans, error: plansError } = await admin
    .from("subscription_plans")
    .select("id, features_json");
  if (plansError) return json({ ok: false, error: plansError.message });

  const capByPlanId = new Map<string, number>();
  for (const plan of plans ?? []) {
    const cap = (plan.features_json as Record<string, unknown> | null)?.storage_bytes;
    if (typeof cap === "number") capByPlanId.set(plan.id, cap);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  let scanned = 0;
  let notified = 0;

  for (const tenant of tenants ?? []) {
    scanned++;
    const bucketBreakdown: Record<string, number> = {};
    let totalBytes = 0;

    for (const bucket of TENANT_BUCKETS) {
      try {
        const bytes = await sumBucketBytes(admin, bucket, tenant.id);
        bucketBreakdown[bucket] = bytes;
        totalBytes += bytes;
      } catch {
        // Leave this bucket's contribution at 0 for this run rather than
        // failing the whole tenant; next run will pick it up.
        bucketBreakdown[bucket] = 0;
      }
    }

    const now = new Date().toISOString();
    await admin.from("tenant_storage_usage").upsert(
      {
        tenant_id: tenant.id,
        bucket_breakdown: bucketBreakdown,
        total_bytes: totalBytes,
        last_reconciled_at: now,
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );

    const capBytes =
      (tenant.subscription_plan_id && capByPlanId.get(tenant.subscription_plan_id)) ||
      FALLBACK_CAP_BYTES;
    const pct = totalBytes / capBytes;

    let title: string | null = null;
    if (pct >= 1.0) title = "Storage full";
    else if (pct >= 0.8) title = "Storage running low";
    if (!title) continue;

    const usedGb = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
    const capGb = (capBytes / (1024 * 1024 * 1024)).toFixed(2);
    const message =
      title === "Storage full"
        ? `Your workspace has used ${usedGb} GB of its ${capGb} GB storage allowance. Uploads may fail until you free up space or upgrade your plan.`
        : `Your workspace has used ${usedGb} GB of its ${capGb} GB storage allowance (${Math.round(pct * 100)}%). Consider freeing up space or upgrading your plan.`;

    // Same-day guard, per threshold title, so a warning-then-full transition
    // on the same day still fires the more urgent notice.
    const { data: dupe } = await admin
      .from("notifications")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("type", "storage")
      .eq("title", title)
      .gte("created_at", iso(today))
      .limit(1);
    if (dupe?.length) continue;

    const { error: insErr } = await admin.from("notifications").insert({
      tenant_id: tenant.id,
      user_id: null,
      type: "storage",
      title,
      message,
      link: "/settings/general",
    });
    if (!insErr) notified++;
  }

  return json({ ok: true, tenantsScanned: scanned, notificationsCreated: notified });
});
