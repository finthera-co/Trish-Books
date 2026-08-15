/**
 * ar-write-off
 *
 * IFRS 9 bad-debt write-off in two steps:
 *
 *   PROVISION — recognise expected credit loss:
 *     Dr Bad Debt Expense (P&L)          / Cr Allowance for Doubtful Debts (contra-asset)
 *
 *   WRITE_OFF — remove the receivable after the allowance is established:
 *     Dr Allowance for Doubtful Debts     / Cr Accounts Receivable (control)
 *     Also marks the ar_transactions row as WRITTEN_OFF.
 *
 * POST body: {
 *   customer_id            : string  (UUID)
 *   ar_transaction_id?     : string  (UUID — the INVOICE to write off; required for WRITE_OFF step)
 *   amount                 : number
 *   bad_debt_account_id    : string  (expense account — Dr on PROVISION)
 *   allowance_account_id   : string  (contra-asset — Cr on PROVISION, Dr on WRITE_OFF)
 *   ar_account_id?         : string  (AR control — Cr on WRITE_OFF; falls back to account_settings)
 *   write_off_type         : "PROVISION" | "WRITE_OFF"
 *   write_off_date?        : string  (YYYY-MM-DD; defaults to today)
 *   notes?                 : string
 * }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  assertTenantAccounts, enumOf, isoDate, money, optional, str, uuid, validateBody, withDefault,
} from "../_shared/validate.ts";

const EPSILON = 0.005;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

function iso(d: Date) { return d.toISOString(); }
function today() { return new Date().toISOString().split("T")[0]; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    const { data: appUser } = await admin
      .from("users")
      .select("id, tenant_id, roles(role_name)")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser?.tenant_id) return json({ ok: false, error: "User not in a tenant" }, 200);

    const role = (appUser as any).roles?.role_name as string | undefined;
    const allowed = ["Super Admin", "Primary Admin", "Company Admin", "Accountant"];
    if (!role || !allowed.includes(role)) {
      return json({ ok: false, error: `Role "${role}" cannot post write-offs` }, 200);
    }

    // After auth/role resolution and before any journal write, so a 429 cannot
    // leave a partially posted entry.
    const { blocked, headers: rlHeaders } = await enforceRateLimit(
      admin,
      "ar-write-off",
      { userId: appUser.id, tenantId: appUser.tenant_id, ip: clientIp(req) },
    );
    if (blocked) return blocked;

    // Every id below is spent against the service_role client, which does not
    // apply RLS — so shape is checked here and ownership just below. The previous
    // `if (!amount || amount <= 0)` also let Infinity and numeric strings through.
    const v = await validateBody(req, {
      customer_id:          uuid(),
      ar_transaction_id:    optional(uuid()),
      amount:               money(),
      bad_debt_account_id:  uuid(),
      allowance_account_id: uuid(),
      ar_account_id:        optional(uuid()),
      write_off_type:       enumOf(["PROVISION", "WRITE_OFF"] as const),
      write_off_date:       withDefault(isoDate(), today),
      notes:                optional(str(1000)),
    });
    if (!v.ok) return json({ ok: false, error: v.message, fields: v.errors }, 200);

    const {
      customer_id,
      ar_transaction_id,
      amount,
      bad_debt_account_id,
      allowance_account_id,
      ar_account_id: bodyArAccountId,
      write_off_type,
      write_off_date,
      notes,
    } = v.value;

    const tid = appUser.tenant_id;

    // Ownership, not just shape: without this a caller can name another tenant's
    // account and have the line posted against it. The DB trigger refuses it too,
    // but that surfaces as a raised exception rather than a usable message.
    const acctErr = await assertTenantAccounts(admin, tid, [
      bad_debt_account_id,
      allowance_account_id,
      bodyArAccountId,
    ]);
    if (acctErr) return json({ ok: false, error: acctErr }, 200);

    // Resolve AR control account
    let arAccountId: string | null | undefined = bodyArAccountId;
    if (!arAccountId) {
      const { data: settings } = await admin
        .from("account_settings")
        .select("ar_account_id")
        .eq("tenant_id", tid)
        .maybeSingle();
      arAccountId = settings?.ar_account_id ?? null;
    }
    if (!arAccountId && write_off_type === "WRITE_OFF") {
      return json({ ok: false, error: "AR control account not configured (required for WRITE_OFF)" }, 200);
    }

    // Validate customer
    const { data: customer } = await admin
      .from("customers")
      .select("id, name")
      .eq("id", customer_id)
      .eq("tenant_id", tid)
      .single();
    if (!customer) return json({ ok: false, error: "Customer not found" }, 200);

    // ── PROVISION: Dr Bad Debt Expense / Cr Allowance for Doubtful Debts ──────
    if (write_off_type === "PROVISION") {
      const description = `IFRS 9 Provision — ${customer.name}${notes ? `: ${notes}` : ""}`;

      // Build JE
      const { data: je, error: jeErr } = await admin.from("journal_entries").insert({
        tenant_id:            tid,
        entry_date:           write_off_date,
        description,
        reference:            `PROV-${customer_id.slice(0, 8)}`,
        status:               "posted",
        posted_at:            iso(new Date()),
        created_by:           appUser.id,
        source_type:          "write_off_provision",
        source_id:            customer_id,
        is_system_generated:  true,
        entry_type:           "write_off",
      }).select().single();
      if (jeErr) return json({ ok: false, error: `Journal failed: ${jeErr.message}` }, 200);

      const lines = [
        { journal_entry_id: je.id, account_id: bad_debt_account_id,  debit: amount, credit: 0 },
        { journal_entry_id: je.id, account_id: allowance_account_id, debit: 0, credit: amount },
      ];
      const { error: lErr } = await admin.from("journal_lines").insert(lines);
      if (lErr) {
        await admin.from("journal_entries").delete().eq("id", je.id);
        return json({ ok: false, error: `Lines failed: ${lErr.message}` }, 200);
      }

      // AR transaction: record provision (no outstanding_amount change yet)
      await admin.from("ar_transactions").insert({
        tenant_id:        tid,
        customer_id,
        transaction_type: "ADJUSTMENT",
        transaction_date: write_off_date,
        amount:           0, // provision doesn't reduce AR directly
        outstanding_amount: 0,
        status:           "PAID",
        journal_entry_id: je.id,
        notes:            `IFRS 9 Provision: ${notes ?? ""}`.trim(),
      });

      await admin.from("audit_logs").insert({
        action:     "AR Write-off Provision",
        table_name: "ar_transactions",
        record_id:  customer_id,
        user_id:    appUser.id,
        tenant_id:  tid,
        details:    { customer_name: customer.name, amount, journal_id: je.id },
      });

      return json({ ok: true, type: "PROVISION", journal_id: je.id, amount });
    }

    // ── WRITE_OFF: Dr Allowance / Cr AR Control ───────────────────────────────
    // Validate the ar_transaction to write off
    if (!ar_transaction_id) {
      return json({ ok: false, error: "ar_transaction_id is required for WRITE_OFF" }, 200);
    }
    const { data: arTxn } = await admin
      .from("ar_transactions")
      .select("id, outstanding_amount, status, document_ref")
      .eq("id", ar_transaction_id)
      .eq("tenant_id", tid)
      .eq("customer_id", customer_id)
      .eq("transaction_type", "INVOICE")
      .single();
    if (!arTxn) return json({ ok: false, error: "AR transaction not found" }, 200);
    if (arTxn.status === "WRITTEN_OFF") return json({ ok: false, error: "Already written off" }, 200);
    if (arTxn.status === "PAID") return json({ ok: false, error: "Invoice is already fully paid" }, 200);

    const writeOffAmt = Math.min(amount, arTxn.outstanding_amount);
    if (writeOffAmt <= EPSILON) return json({ ok: false, error: "No outstanding amount to write off" }, 200);

    const description = `IFRS 9 Write-off — ${customer.name} ${arTxn.document_ref ?? ""}`.trim();

    const { data: je, error: jeErr } = await admin.from("journal_entries").insert({
      tenant_id:            tid,
      entry_date:           write_off_date,
      description,
      reference:            `WO-${ar_transaction_id.slice(0, 8)}`,
      status:               "posted",
      posted_at:            iso(new Date()),
      created_by:           appUser.id,
      source_type:          "write_off",
      source_id:            ar_transaction_id,
      is_system_generated:  true,
      entry_type:           "write_off",
    }).select().single();
    if (jeErr) return json({ ok: false, error: `Journal failed: ${jeErr.message}` }, 200);

    const lines = [
      { journal_entry_id: je.id, account_id: allowance_account_id, debit: writeOffAmt, credit: 0 },
      { journal_entry_id: je.id, account_id: arAccountId!,         debit: 0, credit: writeOffAmt },
    ];
    const { error: lErr } = await admin.from("journal_lines").insert(lines);
    if (lErr) {
      await admin.from("journal_entries").delete().eq("id", je.id);
      return json({ ok: false, error: `Lines failed: ${lErr.message}` }, 200);
    }

    // Record WRITE_OFF in ar_transactions (triggers fn_apply_ar_payment → marks invoice WRITTEN_OFF)
    await admin.from("ar_transactions").insert({
      tenant_id:             tid,
      customer_id,
      transaction_type:      "WRITE_OFF",
      transaction_date:      write_off_date,
      amount:                writeOffAmt,
      outstanding_amount:    0,
      status:                "WRITTEN_OFF",
      journal_entry_id:      je.id,
      related_transaction_id: ar_transaction_id,
      notes:                 notes ?? null,
    });

    // Also mark ar_subledger entry if it exists (legacy data)
    await admin
      .from("ar_subledger")
      .update({ credit: writeOffAmt, balance: 0 })
      .eq("document_id", ar_transaction_id)
      .eq("tenant_id", tid);

    await admin.from("audit_logs").insert({
      action:     "AR Write-off",
      table_name: "ar_transactions",
      record_id:  ar_transaction_id,
      user_id:    appUser.id,
      tenant_id:  tid,
      details:    { customer_name: customer.name, amount: writeOffAmt, journal_id: je.id },
    });

    return json(
      { ok: true, type: "WRITE_OFF", journal_id: je.id, amount: writeOffAmt },
      200,
      rlHeaders,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message || "Internal error" }, 500);
  }
});
