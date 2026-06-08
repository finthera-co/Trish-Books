/**
 * resolve-posting-profile
 *
 * Resolves the GL accounts for a sub-ledger posting event by calling
 * the `resolve_posting_profile` PostgreSQL RPC function.
 *
 * POST body: {
 *   module:           "AR" | "AP" | "INVENTORY" | "FIXED_ASSETS" | "BANK"
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Use user's auth context so RLS + get_user_tenant_id() work correctly
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 401);

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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message || "Internal error" }, 500);
  }
});
