/**
 * resolve-posting-profile
 *
 * Resolves the GL accounts for a sub-ledger posting event by calling
 * the `resolve_posting_profile` PostgreSQL RPC function.
 *
 * POST body: {
 *   module:           "AR" | "AP" | "FIXED_ASSETS" | "BANK"
 *   transaction_type: string (e.g. "INVOICE", "DEPRECIATION")
 *   date?:            "YYYY-MM-DD" (defaults to today)
 *   entity_scope?:    { customer_id?: string, vendor_id?: string } | null
 * }
 *
 * Response: {
 *   ok: true,
 *   accounts: {
 *     [role: string]: {
 *       gl_account_id: string
 *       account_code:  string
 *       account_name:  string
 *       matched_by:    "entity_scope" | "default"
 *     }
 *   }
 * }
 *
 * Called by other edge functions (post-invoice, post-asset-transaction, etc.)
 * to look up configured accounts before building journal lines.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use user's auth context so RLS + get_user_tenant_id() work correctly
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    // consume_rate_limit is service_role-only, so the limiter needs an admin
    // client; this handler otherwise runs entirely as the caller.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: appUser } = await admin
      .from("users")
      .select("id, tenant_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    // Read-only route: nothing is mutated here at all, before or after.
    const { blocked, headers: rlHeaders } = await enforceRateLimit(
      admin,
      "resolve-posting-profile",
      {
        userId: appUser?.id ?? null,
        tenantId: appUser?.tenant_id ?? null,
        ip: clientIp(req),
      },
    );
    if (blocked) return blocked;

    const body = await req.json();
    const {
      module,
      transaction_type,
      date,
      entity_scope = null,
    } = body as {
      module:           string;
      transaction_type: string;
      date?:            string;
      entity_scope?:    Record<string, string> | null;
    };

    if (!module)           return json({ ok: false, error: "module is required" }, 400);
    if (!transaction_type) return json({ ok: false, error: "transaction_type is required" }, 400);

    const { data, error } = await userClient.rpc("resolve_posting_profile", {
      p_module:           module,
      p_transaction_type: transaction_type,
      p_date:             date ?? new Date().toISOString().split("T")[0],
      p_entity_scope:     entity_scope,
    });

    if (error) return json({ ok: false, error: error.message }, 200);

    const accounts = data as Record<string, unknown>;
    const roleCount = Object.keys(accounts).length;

    return json({
      ok:        true,
      module,
      transaction_type,
      roles_resolved: roleCount,
      accounts,
    }, 200, rlHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message || "Internal error" }, 500);
  }
});
