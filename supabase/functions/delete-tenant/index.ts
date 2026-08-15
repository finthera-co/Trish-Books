import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { str, uuid, validateBody } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Buckets whose object paths are all prefixed with `${tenant_id}/`.
const TENANT_BUCKETS = ["invoice-attachments", "employee-photos", "invoice-assets"];

/** Recursively collect every object path under `prefix` in a bucket. */
async function listObjects(
  client: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  const queue = [prefix];

  while (queue.length) {
    const dir = queue.shift()!;
    let offset = 0;

    // Page through the folder; storage list() caps at `limit` entries.
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
        else paths.push(full);
      }

      if (data.length < 1000) break;
      offset += data.length;
    }
  }

  return paths;
}

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

    // Verify the caller with their own JWT before touching anything.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: isSA } = await callerClient.rpc("is_super_admin");
    if (!isSA) throw new Error("Unauthorized: Super Admin only");

    const { data: caller } = await callerClient.auth.getUser();
    if (!caller?.user) throw new Error("Unauthorized: could not resolve caller");

    // tenant_id goes to hard_delete_tenant, which erases a whole company. A
    // malformed value should fail here with a sentence, not inside the purge.
    const v = await validateBody(req, {
      tenant_id:    uuid(),
      confirmation: str(200),
    });
    if (!v.ok) throw new Error(v.message);
    const { tenant_id, confirmation } = v.value;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // 1. Erase all Postgres data for the tenant (one transaction; all or nothing).
    //    Run as the service role for its longer statement_timeout — a big company
    //    takes more than the `authenticated` role gets. The RPC re-checks that
    //    p_actor_auth_id really is a Super Admin.
    const { data: purge, error: purgeError } = await adminClient.rpc("hard_delete_tenant", {
      p_tenant_id: tenant_id,
      p_confirmation: confirmation,
      p_actor_auth_id: caller.user.id,
    });
    if (purgeError) throw new Error(purgeError.message);
    const authUserIds: string[] = purge?.auth_user_ids ?? [];
    const cleanup = {
      auth_users_deleted: 0,
      storage_objects_deleted: 0,
      errors: [] as string[],
    };

    // 2. Auth accounts. The tenant's data is already gone, so a failure here
    //    leaves an orphaned login, not a half-deleted company — report it.
    for (const id of authUserIds) {
      const { error } = await adminClient.auth.admin.deleteUser(id);
      if (error) cleanup.errors.push(`auth user ${id}: ${error.message}`);
      else cleanup.auth_users_deleted++;
    }

    // 3. Storage objects under the tenant prefix.
    for (const bucket of TENANT_BUCKETS) {
      try {
        const paths = await listObjects(adminClient, bucket, tenant_id);
        for (let i = 0; i < paths.length; i += 100) {
          const batch = paths.slice(i, i + 100);
          const { error } = await adminClient.storage.from(bucket).remove(batch);
          if (error) cleanup.errors.push(`${bucket}: ${error.message}`);
          else cleanup.storage_objects_deleted += batch.length;
        }
      } catch (e) {
        cleanup.errors.push(`${bucket}: ${(e as Error).message}`);
      }
    }

    // 4. Record what happened outside Postgres against the deletion log entry.
    if (purge?.log_id) {
      await adminClient
        .from("tenant_deletion_log")
        .update({ external_cleanup: cleanup })
        .eq("id", purge.log_id);
    }

    return new Response(
      JSON.stringify({ success: true, purge, cleanup }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
