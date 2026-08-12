import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map((h) => `"${h}"`).join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h];
          const s = v === null || v === undefined ? "" : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ];
  return lines.join("\n");
}

const TABLES = [
  "accounts",
  "journal_entries",
  "journal_lines",
  "invoices",
  "invoice_items",
  "expenses",
  "payroll_records",
  "budgets",
  "budget_items",
  "petty_cash_accounts",
  "petty_cash_vouchers",
  "petty_cash_voucher_lines",
  "petty_cash_replenishments",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- Authentication: require either a valid user JWT (Super Admin) or a CRON_SECRET bearer token ---
  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

  let authorized = false;
  // Scheduled runs bypass the limiter entirely (see below); only the user-JWT
  // path is limited, so we track which path authorized this request.
  let viaCron = false;
  let callerUserId: string | null = null;
  let callerTenantId: string | null = null;

  // Option 1: CRON_SECRET bearer token (for scheduled jobs)
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    authorized = true;
    viaCron = true;
  }

  // Option 2: Valid authenticated user who is Super Admin
  if (!authorized && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (user && !userErr) {
      // Check if super admin
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: userData } = await adminClient
        .from("users")
        .select("id, tenant_id, roles(role_name)")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (userData && (userData.roles as any)?.role_name === "Super Admin") {
        authorized = true;
        callerUserId = userData.id;
        callerTenantId = userData.tenant_id;
      }
    }
  }

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Scheduled jobs are not abuse: the CRON_SECRET path is never limited. Only
  // the user-JWT path is. Runs after authorization and before any table read or
  // CSV assembly, so a rejected call does no export work.
  let rlHeaders: Record<string, string> = {};
  if (!viaCron) {
    const { blocked, headers } = await enforceRateLimit(
      createClient(supabaseUrl, serviceRoleKey),
      "weekly-csv-export",
      { userId: callerUserId, tenantId: callerTenantId, ip: clientIp(req) },
    );
    if (blocked) return blocked;
    rlHeaders = headers;
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get all active tenants
    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id, company_name")
      .eq("status", "active");

    if (tErr) throw tErr;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const results: string[] = [];

    for (const tenant of tenants || []) {
      const tableNames: string[] = [];

      for (const table of TABLES) {
        // Build query with tenant filter
        let query = supabase.from(table).select("*");

        // Tables with direct tenant_id
        const directTenantTables = [
          "accounts",
          "journal_entries",
          "invoices",
          "expenses",
          "budgets",
          "petty_cash_accounts",
        ];

        if (directTenantTables.includes(table)) {
          query = query.eq("tenant_id", tenant.id);
        } else if (table === "journal_lines") {
          const { data: jeIds } = await supabase
            .from("journal_entries")
            .select("id")
            .eq("tenant_id", tenant.id);
          if (!jeIds?.length) continue;
          query = query.in("journal_entry_id", jeIds.map((j) => j.id));
        } else if (table === "invoice_items") {
          const { data: invIds } = await supabase
            .from("invoices")
            .select("id")
            .eq("tenant_id", tenant.id);
          if (!invIds?.length) continue;
          query = query.in("invoice_id", invIds.map((i) => i.id));
        } else if (table === "budget_items") {
          const { data: bIds } = await supabase
            .from("budgets")
            .select("id")
            .eq("tenant_id", tenant.id);
          if (!bIds?.length) continue;
          query = query.in("budget_id", bIds.map((b) => b.id));
        } else if (table === "payroll_records") {
          const { data: empIds } = await supabase
            .from("employees")
            .select("id")
            .eq("tenant_id", tenant.id);
          if (!empIds?.length) continue;
          query = query.in("employee_id", empIds.map((e) => e.id));
        } else if (table === "petty_cash_vouchers" || table === "petty_cash_voucher_lines" || table === "petty_cash_replenishments") {
          const { data: pcIds } = await supabase
            .from("petty_cash_accounts")
            .select("id")
            .eq("tenant_id", tenant.id);
          if (!pcIds?.length) continue;
          if (table === "petty_cash_voucher_lines") {
            const { data: vIds } = await supabase
              .from("petty_cash_vouchers")
              .select("id")
              .in("petty_cash_account_id", pcIds.map((p) => p.id));
            if (!vIds?.length) continue;
            query = query.in("voucher_id", vIds.map((v) => v.id));
          } else {
            query = query.in("petty_cash_account_id", pcIds.map((p) => p.id));
          }
        }

        const { data: rows, error } = await query;
        if (error) {
          console.error(`Error fetching ${table} for tenant ${tenant.id}:`, error);
          continue;
        }
        if (!rows?.length) continue;

        const csv = toCsv(rows);
        const filePath = `${tenant.id}/${dateStr}/${table}.csv`;

        const { error: uploadErr } = await supabase.storage
          .from("csv-exports")
          .upload(filePath, new Blob([csv], { type: "text/csv" }), {
            upsert: true,
          });

        if (uploadErr) {
          console.error(`Upload error for ${filePath}:`, uploadErr);
          continue;
        }

        tableNames.push(table);
      }

      if (tableNames.length > 0) {
        // Log the export
        await supabase.from("export_logs").insert({
          tenant_id: tenant.id,
          file_name: `export-${dateStr}`,
          file_path: `${tenant.id}/${dateStr}`,
          export_type: "weekly",
          tables_included: tableNames,
        });

        // Do NOT leak tenant names — use anonymized count only
        results.push(`${tableNames.length} tables exported`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, tenants_processed: results.length, tables_exported: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", ...rlHeaders } }
    );
  } catch (err) {
    console.error("Export error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
