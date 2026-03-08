import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
  "petty_cash_transactions",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
          // Get journal entry IDs for this tenant first
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
        } else if (table === "petty_cash_transactions") {
          const { data: pcIds } = await supabase
            .from("petty_cash_accounts")
            .select("id")
            .eq("tenant_id", tenant.id);
          if (!pcIds?.length) continue;
          query = query.in("petty_cash_account_id", pcIds.map((p) => p.id));
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

        results.push(`${tenant.company_name}: ${tableNames.length} tables exported`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Export error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
