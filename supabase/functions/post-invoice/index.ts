import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPSILON = 0.005;

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
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, 200);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 200);

    const { data: appUser } = await admin
      .from("users")
      .select("id, tenant_id, roles(role_name)")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser?.tenant_id) return json({ ok: false, error: "User not in a tenant" }, 200);

    // Authorization: only Primary Admin / Company Admin / Super Admin can post
    const role = (appUser as any).roles?.role_name as string | undefined;
    const allowed = ["Super Admin", "Primary Admin", "Company Admin", "Accountant"];
    if (!role || !allowed.includes(role)) {
      return json({ ok: false, error: `Role "${role || "unknown"}" cannot post invoices` }, 200);
    }

    const body = await req.json();
    const { invoice_id, action } = body as { invoice_id: string; action: "post" | "void" };
    if (!invoice_id) return json({ ok: false, error: "invoice_id is required" }, 200);

    // ── Fetch invoice + lines (with product inventory linkage) ────────
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("*, invoice_items(*, products(id, is_tracked, inventory_item_id, expense_account_id, asset_account_id, name))")
      .eq("id", invoice_id)
      .eq("tenant_id", appUser.tenant_id)
      .single();
    if (invErr || !invoice) return json({ ok: false, error: "Invoice not found" }, 200);

    // ═══════════════════════════════════════════════════════════════════
    // VOID FLOW
    // ═══════════════════════════════════════════════════════════════════
    if (action === "void") {
      if (invoice.status !== "posted") {
        return json({ ok: false, error: `Cannot void invoice in status "${invoice.status}"` }, 200);
      }

      // Find original journal
      const { data: origJE } = await admin
        .from("journal_entries")
        .select("id, entry_date")
        .eq("source_type", "invoice")
        .eq("source_id", invoice_id)
        .neq("status", "voided")
        .maybeSingle();

      if (!origJE) return json({ ok: false, error: "Original journal not found" }, 200);

      // Get original lines
      const { data: origLines } = await admin
        .from("journal_lines")
        .select("account_id, debit, credit")
        .eq("journal_entry_id", origJE.id);

      // Mark original voided
      await admin
        .from("journal_entries")
        .update({ status: "voided", voided_at: new Date().toISOString(), voided_by: appUser.id })
        .eq("id", origJE.id);

      // Create reversal JE (swapped debit/credit)
      const { data: revJE, error: revErr } = await admin
        .from("journal_entries")
        .insert({
          tenant_id: appUser.tenant_id,
          entry_date: new Date().toISOString().slice(0, 10),
          description: `Reversal of Invoice ${invoice.invoice_number}`,
          reference: invoice.invoice_number,
          status: "posted",
          posted_at: new Date().toISOString(),
          created_by: appUser.id,
          reversal_of: origJE.id,
          source_type: "invoice_reversal",
          source_id: invoice_id,
          is_system_generated: true,
        })
        .select()
        .single();
      if (revErr) return json({ ok: false, error: `Reversal failed: ${revErr.message}` }, 200);

      const revLines = (origLines || []).map((l: any) => ({
        journal_entry_id: revJE.id,
        account_id: l.account_id,
        debit: Number(l.credit) || 0,
        credit: Number(l.debit) || 0,
      }));
      await admin.from("journal_lines").insert(revLines);

      // Reverse stock movements (re-add stock that was issued on sale)
      const { data: salesMovements } = await admin
        .from("stock_movements")
        .select("id, item_id, quantity, unit_cost")
        .eq("reference_type", "invoice")
        .eq("reference_id", invoice_id);
      if (salesMovements && salesMovements.length > 0) {
        const reversals = salesMovements.map((m: any) => ({
          tenant_id: appUser.tenant_id,
          item_id: m.item_id,
          movement_type: "return",
          quantity: -Number(m.quantity), // original was negative (issue) → reversal positive
          unit_cost: Number(m.unit_cost),
          reference_type: "invoice_reversal",
          reference_id: invoice_id,
          notes: `Reversal of sale movement ${m.id}`,
          movement_date: new Date().toISOString().slice(0, 10),
        }));
        await admin.from("stock_movements").insert(reversals);
      }

      await admin
        .from("invoices")
        .update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: appUser.id,
        })
        .eq("id", invoice_id);

      await admin.from("audit_logs").insert({
        action: "Invoice Voided",
        table_name: "invoices",
        record_id: invoice_id,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: { invoice_number: invoice.invoice_number, reversal_je: revJE.id },
      });

      return json({ ok: true, message: "Invoice voided", reversal_journal_id: revJE.id });
    }

    // ═══════════════════════════════════════════════════════════════════
    // POST FLOW
    // ═══════════════════════════════════════════════════════════════════
    const errors: string[] = [];

    if (invoice.status !== "draft") {
      return json({ ok: false, error: `Cannot post invoice in status "${invoice.status}"` }, 200);
    }
    if (!invoice.customer_id) errors.push("Customer is required");
    if (!invoice.invoice_items?.length) errors.push("At least one line item is required");
    const total = Number(invoice.total_amount || 0);
    if (total <= 0) errors.push("Total must be greater than 0");

    // ── Closed period check ─────────────────────────────────────────
    const { data: closedPeriods } = await admin
      .from("fiscal_periods")
      .select("period_start, period_end")
      .eq("tenant_id", appUser.tenant_id)
      .eq("status", "closed");
    const issueDate = new Date(invoice.issue_date);
    for (const p of closedPeriods || []) {
      if (issueDate >= new Date(p.period_start) && issueDate <= new Date(p.period_end)) {
        errors.push(`Issue date falls in a closed period (${p.period_start} → ${p.period_end})`);
      }
    }

    // ── Resolve account settings ────────────────────────────────────
    const { data: settings } = await admin
      .from("account_settings")
      .select("ar_account_id, sales_account_id, tax_payable_account_id, cogs_account_id, inventory_asset_account_id")
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();

    const arAccountId = invoice.ar_account_id || settings?.ar_account_id;
    const defaultSalesId = invoice.revenue_account_id || settings?.sales_account_id;
    const taxPayableId = settings?.tax_payable_account_id;

    if (!arAccountId) errors.push("Accounts Receivable not configured (Settings → Account Mapping)");
    if (!defaultSalesId) errors.push("Default Sales Revenue not configured");
    if (Number(invoice.tax_amount || 0) > 0 && !taxPayableId) {
      errors.push("Tax Payable account not configured (required because invoice has tax)");
    }

    // ── Validate accounts exist + active + tenant ───────────────────
    const accountIdsToCheck = new Set<string>();
    if (arAccountId) accountIdsToCheck.add(arAccountId);
    if (defaultSalesId) accountIdsToCheck.add(defaultSalesId);
    if (taxPayableId && Number(invoice.tax_amount || 0) > 0) accountIdsToCheck.add(taxPayableId);
    for (const item of invoice.invoice_items || []) {
      if (item.account_id) accountIdsToCheck.add(item.account_id);
    }

    if (accountIdsToCheck.size > 0) {
      const { data: accs } = await admin
        .from("accounts")
        .select("id, account_name, is_active, tenant_id")
        .in("id", [...accountIdsToCheck]);
      const accMap = new Map((accs || []).map((a) => [a.id, a]));
      for (const id of accountIdsToCheck) {
        const a = accMap.get(id);
        if (!a) errors.push(`Account ${id} not found`);
        else if (a.tenant_id !== appUser.tenant_id) errors.push(`Account ${a.account_name} belongs to another tenant`);
        else if (!a.is_active) errors.push(`Account "${a.account_name}" is inactive`);
      }
    }

    if (errors.length > 0) {
      return json({ ok: false, error: "Cannot post invoice. Issues found:\n• " + errors.join("\n• "), errors }, 200);
    }

    // ── Idempotency: existing non-voided JE? ────────────────────────
    const { data: existingJE } = await admin
      .from("journal_entries")
      .select("id")
      .eq("source_type", "invoice")
      .eq("source_id", invoice_id)
      .neq("status", "voided")
      .maybeSingle();
    if (existingJE) {
      // Already posted — just sync invoice status
      await admin.from("invoices").update({ status: "posted" }).eq("id", invoice_id);
      return json({ ok: true, message: "Already posted (idempotent)", journal_id: existingJE.id });
    }

    // ── Build journal lines ─────────────────────────────────────────
    const items = invoice.invoice_items || [];

    // Group revenue by account
    const revenueByAccount = new Map<string, number>();
    for (const item of items) {
      const acctId = item.account_id || defaultSalesId!;
      const lineAmt = Number(item.total || (Number(item.quantity) * Number(item.unit_price)));
      revenueByAccount.set(acctId, (revenueByAccount.get(acctId) || 0) + lineAmt);
    }

    const taxAmount = Number(invoice.tax_amount || 0);

    // ── COGS / Inventory validation for tracked products ────────────
    type CogsItem = { item_id: string; qty: number; avg_cost: number; cogs_acct: string; asset_acct: string; line_total: number; name: string };
    const cogsItems: CogsItem[] = [];
    for (const item of items) {
      const product = (item as any).products;
      const invItemId = item.inventory_item_id || product?.inventory_item_id;
      if (!product?.is_tracked || !invItemId) continue;

      // Resolve avg cost + asset account from inventory_items
      const { data: invRow, error: invRowErr } = await admin
        .from("inventory_items")
        .select("id, item_name, unit_cost, account_id, quantity_on_hand")
        .eq("id", invItemId)
        .eq("tenant_id", appUser.tenant_id)
        .single();
      if (invRowErr || !invRow) {
        errors.push(`Inventory item ${invItemId} not found for product "${product?.name}"`);
        continue;
      }

      // Three-tier: product-level → inventory item's account → global settings fallback
      const cogsAcct =
        product.expense_account_id
        ?? settings?.cogs_account_id;

      const assetAcct =
        product.asset_account_id
        ?? invRow.account_id
        ?? settings?.inventory_asset_account_id;

      if (!cogsAcct) errors.push(
        `Product "${product.name}" missing COGS account. ` +
        `Set it on the product or configure a Default COGS in Settings → Account Mapping.`
      );
      if (!assetAcct) errors.push(
        `Product "${product.name}" missing Inventory Asset account. ` +
        `Set it on the product or configure a Default Inventory Asset in Settings → Account Mapping.`
      );

      // Stock availability check (default: block negative)
      const qty = Number(item.quantity) || 0;
      const onHand = Number(invRow.quantity_on_hand) || 0;
      if (qty > onHand) {
        errors.push(`Insufficient stock for "${invRow.item_name}": on hand ${onHand}, required ${qty}`);
      }

      const avgCost = Number(invRow.unit_cost) || 0;
      const lineTotal = Math.round(qty * avgCost * 100) / 100;
      if (cogsAcct && assetAcct && lineTotal > 0) {
        cogsItems.push({
          item_id: invItemId,
          qty,
          avg_cost: avgCost,
          cogs_acct: cogsAcct,
          asset_acct: assetAcct,
          line_total: lineTotal,
          name: invRow.item_name,
        });
      }
    }

    if (errors.length > 0) {
      return json({ ok: false, error: "Cannot post invoice. Issues found:\n• " + errors.join("\n• "), errors }, 200);
    }

    const journalLines: { account_id: string; debit: number; credit: number }[] = [];

    // Dr AR (single line, customer-tagged via subledger)
    journalLines.push({ account_id: arAccountId!, debit: total, credit: 0 });

    // Cr Revenue accounts (grouped)
    for (const [acctId, amt] of revenueByAccount) {
      if (amt > 0) journalLines.push({ account_id: acctId, debit: 0, credit: amt });
    }

    // Cr Tax Payable
    if (taxAmount > 0 && taxPayableId) {
      journalLines.push({ account_id: taxPayableId, debit: 0, credit: taxAmount });
    }

    // Dr COGS / Cr Inventory (grouped by accounts)
    const cogsByAcct = new Map<string, number>();
    const invByAcct = new Map<string, number>();
    for (const c of cogsItems) {
      cogsByAcct.set(c.cogs_acct, (cogsByAcct.get(c.cogs_acct) || 0) + c.line_total);
      invByAcct.set(c.asset_acct, (invByAcct.get(c.asset_acct) || 0) + c.line_total);
    }
    for (const [acct, amt] of cogsByAcct) journalLines.push({ account_id: acct, debit: amt, credit: 0 });
    for (const [acct, amt] of invByAcct) journalLines.push({ account_id: acct, debit: 0, credit: amt });

    // ── Balance check ───────────────────────────────────────────────
    const totalDr = journalLines.reduce((s, l) => s + l.debit, 0);
    const totalCr = journalLines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDr - totalCr) > EPSILON) {
      return json({
        ok: false,
        error: `Journal unbalanced: Debits=${totalDr.toFixed(2)} Credits=${totalCr.toFixed(2)}`,
      }, 200);
    }

    // ── Create JE (draft → insert lines → post) ─────────────────────
    const { data: je, error: jeErr } = await admin
      .from("journal_entries")
      .insert({
        tenant_id: appUser.tenant_id,
        entry_date: invoice.issue_date,
        description: `Invoice ${invoice.invoice_number}`,
        reference: invoice.invoice_number,
        status: "draft",
        created_by: appUser.id,
        source_type: "invoice",
        source_id: invoice_id,
        is_system_generated: true,
        entry_type: "invoice",
      })
      .select()
      .single();

    if (jeErr) {
      // Likely duplicate (idempotency unique index)
      if (jeErr.code === "23505") {
        return json({ ok: false, error: "Invoice already has a posted journal (idempotency guard)" }, 200);
      }
      return json({ ok: false, error: `Failed to create journal: ${jeErr.message}` }, 200);
    }

    const linesPayload = journalLines.map((l) => ({
      journal_entry_id: je.id,
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
    }));
    const { error: linesErr } = await admin.from("journal_lines").insert(linesPayload);
    if (linesErr) {
      await admin.from("journal_entries").delete().eq("id", je.id);
      return json({ ok: false, error: `Failed to insert lines: ${linesErr.message}` }, 200);
    }

    // Post the JE
    const { error: postErr } = await admin
      .from("journal_entries")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", je.id);
    if (postErr) return json({ ok: false, error: `Failed to post: ${postErr.message}` }, 200);

    // Fetch the AR journal line id for sub-ledger linking
    const { data: arJournalLine } = await admin
      .from("journal_lines")
      .select("id")
      .eq("journal_entry_id", je.id)
      .eq("account_id", arAccountId)
      .single();
    const arLineId = arJournalLine?.id ?? null;

    // AR subledger (legacy — backward compat)
    await admin.from("ar_subledger").insert({
      tenant_id: appUser.tenant_id,
      customer_id: invoice.customer_id,
      journal_id: je.id,
      journal_line_id: arLineId,
      debit: total,
      credit: 0,
      amount: total,
      balance: total,
      document_type: "invoice",
      document_id: invoice_id,
      invoice_no: invoice.invoice_number,
      due_date: invoice.due_date,
    });

    // ar_transactions (Phase 3 enriched sub-ledger)
    await admin.from("ar_transactions").insert({
      tenant_id:        appUser.tenant_id,
      customer_id:      invoice.customer_id,
      transaction_type: "INVOICE",
      document_id:      invoice_id,
      document_ref:     invoice.invoice_number,
      transaction_date: invoice.issue_date,
      due_date:         invoice.due_date,
      amount:           total,
      outstanding_amount: total,
      status:           "OPEN",
      journal_entry_id: je.id,
      journal_line_id:  arLineId,
      ar_account_id:    arAccountId,
    });

    // ── Stock movements for tracked products (issue / sale) ─────────
    if (cogsItems.length > 0) {
      const movements = cogsItems.map((c) => ({
        tenant_id: appUser.tenant_id,
        item_id: c.item_id,
        movement_type: "sale",
        quantity: -c.qty, // negative = issue
        unit_cost: c.avg_cost,
        reference_type: "invoice",
        reference_id: invoice_id,
        notes: `Sold via invoice ${invoice.invoice_number}`,
        movement_date: invoice.issue_date,
      }));
      const { error: smErr } = await admin.from("stock_movements").insert(movements);
      if (smErr) {
        // Best-effort: surface the error but JE is already posted; admin can reconcile.
        console.error("Stock movement insert failed:", smErr.message);
      }
    }
    await admin
      .from("invoices")
      .update({
        status: "posted",
        journal_entry_id: je.id,
        posted_at: new Date().toISOString(),
        posted_by: appUser.id,
      })
      .eq("id", invoice_id);

    await admin.from("audit_logs").insert({
      action: "Invoice Posted",
      table_name: "invoices",
      record_id: invoice_id,
      user_id: appUser.id,
      tenant_id: appUser.tenant_id,
      details: {
        invoice_number: invoice.invoice_number,
        journal_id: je.id,
        total_debit: totalDr,
        total_credit: totalCr,
        line_count: journalLines.length,
      },
    });

    return json({ ok: true, message: "Invoice posted", journal_id: je.id, lines: journalLines.length });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Internal error" }, 200);
  }
});
