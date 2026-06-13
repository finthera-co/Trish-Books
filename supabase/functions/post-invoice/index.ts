import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateLineTax,
  type TaxMemberInput,
  type CollectionMode,
} from "../_shared/taxEngine.ts";

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

    // ── Tenant tax profile (drives engine behavior) ───────────────────
    const { data: taxProfile } = await admin
      .from("tenant_tax_profiles")
      .select("*")
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();

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

      // Tax sub-ledger: mirror every original row with negated amounts
      // (source_type='reversal', reversal_of_id set); originals flagged
      // is_reversed. Never deletes or mutates original rows.
      const { error: taxRevErr } = await admin.rpc("reverse_tax_transactions", {
        p_tenant_id: appUser.tenant_id,
        p_source_type: "invoice",
        p_source_id: invoice_id,
        p_reversal_journal_id: revJE.id,
        p_reversal_date: new Date().toISOString().slice(0, 10),
      });
      if (taxRevErr) console.error("Tax reversal rows failed:", taxRevErr.message);

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

    // ═════════ Tax engine: per-line computation at ISSUE DATE rates ═════════
    const warnings: string[] = [];
    const itemsAll = invoice.invoice_items || [];
    const usesTaxEngine = itemsAll.some((it: any) => it.tax_code_id || it.tax_group_id);

    type CodeMeta = {
      id: string; code: string; tax_type: string; collection_mode: CollectionMode;
      is_recoverable: boolean; rounding_method: string; rounding_level: string;
      output_liability_account_id: string | null;
    };
    // taxCodeId → aggregated output tax + resolved account
    const taxByCode = new Map<string, { meta: CodeMeta; amount: number; base: number; rate: number; account: string }>();
    // per (line, code) rows for the sub-ledger
    const taxTxnRows: any[] = [];
    // line id → net revenue base
    const lineNetById = new Map<string, number>();
    let computedSubtotal = 0;
    let computedTax = 0;

    if (usesTaxEngine) {
      const codeIds = new Set<string>();
      const groupIds = new Set<string>();
      for (const it of itemsAll) {
        if (it.tax_code_id) codeIds.add(it.tax_code_id);
        if (it.tax_group_id) groupIds.add(it.tax_group_id);
      }

      const { data: groupMembers } = groupIds.size
        ? await admin
            .from("tax_group_members")
            .select("tax_group_id, tax_code_id, apply_order, compound_on_previous")
            .in("tax_group_id", [...groupIds])
        : { data: [] as any[] };
      for (const gm of groupMembers || []) codeIds.add(gm.tax_code_id);

      const { data: codes } = await admin
        .from("tax_codes")
        .select("id, code, tax_type, collection_mode, is_recoverable, is_active, rounding_method, rounding_level, output_liability_account_id, tenant_id")
        .in("id", [...codeIds]);
      const codeById = new Map<string, any>((codes || []).map((c: any) => [c.id, c]));

      const { data: rates } = await admin
        .from("tax_code_rates")
        .select("tax_code_id, rate, effective_from, effective_to")
        .in("tax_code_id", [...codeIds]);
      const issue = invoice.issue_date as string;
      const rateFor = (codeId: string): number | null => {
        const candidates = (rates || [])
          .filter((r: any) => r.tax_code_id === codeId && r.effective_from <= issue && (!r.effective_to || r.effective_to >= issue))
          .sort((a: any, b: any) => (a.effective_from < b.effective_from ? 1 : -1));
        return candidates.length ? Number(candidates[0].rate) : null;
      };

      // Tenant profile enforcement (engine semantics)
      for (const c of codes || []) {
        if (c.tenant_id !== appUser.tenant_id) errors.push(`Tax code ${c.code} belongs to another tenant`);
        if (!c.is_active) errors.push(`Tax code ${c.code} is inactive`);
        if (c.tax_type === "VAT" && !taxProfile?.is_vat_registered) {
          errors.push(`Cannot charge ${c.code}: tenant is not VAT-registered (Settings → Tax Configuration)`);
        }
        if (c.tax_type === "SSCL" && !taxProfile?.is_sscl_liable) {
          errors.push(`Cannot charge ${c.code}: tenant is not SSCL-liable (Settings → Tax Configuration)`);
        }
        if (c.collection_mode !== "output") {
          errors.push(`Tax code ${c.code} (${c.collection_mode}) cannot be used on a sales invoice`);
        }
      }

      if (errors.length === 0) {
        for (const it of itemsAll) {
          const lineAmount =
            Number(it.quantity) * Number(it.unit_price) - Number(it.discount_amount || 0);
          if (!it.tax_code_id && !it.tax_group_id) {
            const net = Math.round(lineAmount * 100) / 100;
            lineNetById.set(it.id, net);
            computedSubtotal += net;
            continue;
          }
          const memberDefs = it.tax_group_id
            ? (groupMembers || [])
                .filter((gm: any) => gm.tax_group_id === it.tax_group_id)
                .map((gm: any) => ({ codeId: gm.tax_code_id, order: gm.apply_order, compound: gm.compound_on_previous }))
            : [{ codeId: it.tax_code_id, order: 1, compound: false }];

          const members: TaxMemberInput[] = [];
          for (const md of memberDefs) {
            const c = codeById.get(md.codeId);
            const rate = rateFor(md.codeId);
            if (!c) { errors.push(`Tax code ${md.codeId} not found`); continue; }
            if (rate === null) { errors.push(`No ${c.code} rate effective on ${issue}`); continue; }
            members.push({
              taxCodeId: c.id, code: c.code, rate,
              isCompound: md.compound, applyOrder: md.order,
              collectionMode: c.collection_mode,
            });
          }
          if (errors.length > 0) break;

          const first = codeById.get(members[0].taxCodeId);
          const result = calculateLineTax({
            lineAmount,
            isInclusive: !!it.is_tax_inclusive,
            members,
            roundingMethod: (first?.rounding_method as any) || "half_up",
            roundingLevel: "line",
            documentDate: issue,
          });

          lineNetById.set(it.id, result.exclusiveBase);
          computedSubtotal += result.exclusiveBase;
          for (const t of result.taxes) {
            computedTax += t.amount;
            const meta = codeById.get(t.taxCodeId) as CodeMeta;
            // Three-tier resolution: code-level account → global fallback
            let acct = meta.output_liability_account_id;
            if (!acct) {
              acct = taxPayableId ?? null;
              if (acct) warnings.push(`Tax code ${meta.code} has no output liability account; used global Tax Payable fallback`);
            }
            if (!acct) {
              errors.push(`Tax code ${meta.code} has no output liability account mapped and no global Tax Payable fallback`);
              continue;
            }
            const agg = taxByCode.get(t.taxCodeId) || { meta, amount: 0, base: 0, rate: t.rate, account: acct };
            agg.amount = Math.round((agg.amount + t.amount) * 100) / 100;
            agg.base = Math.round((agg.base + t.base) * 100) / 100;
            taxByCode.set(t.taxCodeId, agg);
            taxTxnRows.push({
              tenant_id: appUser.tenant_id,
              tax_code_id: t.taxCodeId,
              direction: "output",
              source_type: "invoice",
              source_id: invoice_id,
              source_line_id: it.id,
              base_amount: t.base,
              tax_amount: t.amount, // TODO(multi-currency): convert at document FX rate once FX infrastructure exists
              tax_amount_txn_currency: t.amount,
              currency: invoice.currency || "LKR",
              fx_rate: 1,
              rate_applied: t.rate,
              transaction_date: issue,
            });
          }
        }
      }

      computedSubtotal = Math.round(computedSubtotal * 100) / 100;
      computedTax = Math.round(computedTax * 100) / 100;
      const computedTotal = Math.round((computedSubtotal + computedTax) * 100) / 100;

      // Never trust client-computed tax: reject mismatches beyond a cent
      if (errors.length === 0 && Math.abs(computedTotal - Number(invoice.total_amount || 0)) > 0.01) {
        errors.push(
          `Tax recalculated server-side differs from submitted values. ` +
          `(server total ${computedTotal.toFixed(2)} vs submitted ${Number(invoice.total_amount).toFixed(2)})`
        );
      }

      // Filed tax period guard (pre-check; the DB trigger is the backstop)
      if (errors.length === 0 && taxTxnRows.length > 0) {
        const taxTypes = [...new Set([...taxByCode.values()].map((v) => v.meta.tax_type))];
        const { data: filedPeriods } = await admin
          .from("tax_periods")
          .select("tax_type, period_start, period_end")
          .eq("tenant_id", appUser.tenant_id)
          .eq("status", "filed")
          .in("tax_type", taxTypes);
        for (const p of filedPeriods || []) {
          if (issue >= p.period_start && issue <= p.period_end) {
            errors.push(`The ${p.tax_type} period covering ${issue} is already filed. Use a different issue date or amend via credit note.`);
          }
        }
      }
    } else if (Number(invoice.tax_amount || 0) > 0 && !taxPayableId) {
      // Legacy invoices (no line tax codes) keep the old single-account path
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

    // Group revenue by account. Tax-engine lines credit revenue NET of tax
    // (the engine's exclusive base); legacy lines keep their stored total.
    const revenueByAccount = new Map<string, number>();
    for (const item of items) {
      const acctId = item.account_id || defaultSalesId!;
      const lineAmt = usesTaxEngine
        ? (lineNetById.get(item.id) ?? Number(item.quantity) * Number(item.unit_price) - Number(item.discount_amount || 0))
        : Number(item.total || (Number(item.quantity) * Number(item.unit_price)));
      revenueByAccount.set(acctId, (revenueByAccount.get(acctId) || 0) + lineAmt);
    }

    const taxAmount = usesTaxEngine ? 0 : Number(invoice.tax_amount || 0);

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

    // Cr Tax Payable (legacy header-tax path only)
    if (taxAmount > 0 && taxPayableId) {
      journalLines.push({ account_id: taxPayableId, debit: 0, credit: taxAmount });
    }

    // Cr each tax code's output liability account separately (aggregated
    // per code across lines) — tax engine path
    for (const [, agg] of taxByCode) {
      if (agg.amount > 0) {
        journalLines.push({ account_id: agg.account, debit: 0, credit: agg.amount });
      }
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

    // ── Tax sub-ledger: same logical operation as the JE ─────────────
    if (taxTxnRows.length > 0) {
      const { error: taxTxnErr } = await admin
        .from("tax_transactions")
        .insert(taxTxnRows.map((r) => ({ ...r, journal_entry_id: je.id })));
      if (taxTxnErr) {
        // Roll the JE back — tax must never post without its sub-ledger rows
        await admin.from("journal_lines").delete().eq("journal_entry_id", je.id);
        await admin.from("journal_entries").delete().eq("id", je.id);
        return json({ ok: false, error: `Tax sub-ledger insert failed: ${taxTxnErr.message}` }, 200);
      }

      // DEPRECATED: legacy tax_records kept for backward compatibility with
      // old reports. New code must read tax_transactions. Only written when
      // a line still carries a legacy taxes.tax_id.
      const legacyRecords = items
        .filter((it: any) => it.tax_id && Number(it.tax_amount_line || 0) > 0)
        .map((it: any) => ({ invoice_id: invoice_id, tax_id: it.tax_id, tax_amount: Number(it.tax_amount_line) }));
      if (legacyRecords.length > 0) {
        await admin.from("tax_records").insert(legacyRecords);
      }
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

    return json({
      ok: true,
      message: "Invoice posted",
      journal_id: je.id,
      lines: journalLines.length,
      tax_transactions: taxTxnRows.length,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Internal error" }, 200);
  }
});
