import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateLineTax,
  type TaxMemberInput,
  type CollectionMode,
} from "../_shared/taxEngine.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

const EPSILON = 0.005;

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
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, 200);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { invoice_id, action } = body as {
      invoice_id: string;
      action: "post" | "void" | "unpost";
      system?: boolean;
      tenant_id?: string;
      actor_user_id?: string;
    };
    if (!invoice_id) return json({ ok: false, error: "invoice_id is required" }, 200);

    // Two auth modes:
    //  • System (cron) — authenticates with the service-role key and carries the
    //    acting tenant + user in the body (used by generate-recurring-invoices).
    //  • Interactive — a user JWT, gated to finance roles.
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const isSystem = token === serviceKey;

    let appUser: { id: string; tenant_id: string };
    if (isSystem) {
      if (!body.tenant_id || !body.actor_user_id) {
        return json({ ok: false, error: "System call requires tenant_id and actor_user_id" }, 200);
      }
      appUser = { id: body.actor_user_id, tenant_id: body.tenant_id };
    } else {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 200);

      const { data: au } = await admin
        .from("users")
        .select("id, tenant_id, roles(role_name)")
        .eq("auth_user_id", user.id)
        .single();
      if (!au?.tenant_id) return json({ ok: false, error: "User not in a tenant" }, 200);

      // Authorization: only Primary Admin / Company Admin / Super Admin / Accountant can post
      const role = (au as any).roles?.role_name as string | undefined;
      const allowed = ["Super Admin", "Primary Admin", "Company Admin", "Accountant"];
      if (!role || !allowed.includes(role)) {
        return json({ ok: false, error: `Role "${role || "unknown"}" cannot post invoices` }, 200);
      }
      appUser = { id: au.id, tenant_id: au.tenant_id };
    }

    // ── Rate limit ────────────────────────────────────────────────────
    // Runs after auth/role resolution and before the idempotency check and every
    // journal_entries / journal_lines write below, so a 429 cannot leave a
    // partially posted entry — nothing has been mutated at this point.
    //
    // The system path is exempt on purpose. generate-recurring-invoices (cron)
    // calls this endpoint in a loop with system:true and a single actor_user_id;
    // limiting that would silently stop posting mid-batch and leave invoices
    // generated but unposted. Scheduled work is not abuse.
    let rlHeaders: Record<string, string> = {};
    if (!isSystem) {
      const { blocked, headers } = await enforceRateLimit(admin, "post-invoice", {
        userId: appUser.id,
        tenantId: appUser.tenant_id,
        ip: clientIp(req),
      });
      if (blocked) return blocked;
      rlHeaders = headers;
    }

    // ── Fetch invoice + lines ──────────────────────────────────────────
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("*, invoice_items(*)")
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

      // Legacy GL-linked tax_records (non-engine output VAT): insert a
      // negating row so net tax for this invoice returns to zero. Engine
      // rows are handled by reverse_tax_transactions above.
      const { data: legacyTaxRecs } = await admin
        .from("tax_records")
        .select("tax_amount")
        .eq("source_type", "invoice")
        .eq("source_id", invoice_id)
        .eq("direction", "output");
      const legacyTaxNet = (legacyTaxRecs || []).reduce((s: number, r: any) => s + Number(r.tax_amount || 0), 0);
      if (legacyTaxNet > 0) {
        await admin.from("tax_records").insert({
          tenant_id: appUser.tenant_id,
          invoice_id: invoice_id,
          tax_id: null,
          tax_amount: -legacyTaxNet,
          journal_entry_id: revJE.id,
          direction: "output",
          source_type: "invoice",
          source_id: invoice_id,
          transaction_date: new Date().toISOString().slice(0, 10),
        });
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
    // UNPOST FLOW — reopen a posted invoice so it can be edited
    // ═══════════════════════════════════════════════════════════════════
    // Unwinds the GL exactly the way a void does (original entry marked
    // voided, a mirrored reversal written against the ORIGINAL entry date so
    // the correction never lands in a different period) and drops the invoice
    // back to draft — from there the ordinary edit → post path applies.
    //
    // Only safe while nothing else has attached itself to the invoice. A
    // payment, an allocation or a credit note means the figures are already
    // settled somewhere else, and the right instrument is a void or a credit
    // note rather than an edit.
    if (action === "unpost") {
      if (!["posted", "sent"].includes(invoice.status)) {
        return json({ ok: false, error: `Only a posted invoice can be reopened for editing (status "${invoice.status}")` }, 200);
      }
      if (Number(invoice.amount_paid || 0) > EPSILON) {
        return json({ ok: false, error: "Invoice has payments against it — void it or raise a credit note instead of editing" }, 200);
      }

      const { count: allocCount } = await admin
        .from("payment_received_allocations")
        .select("id", { count: "exact", head: true })
        .eq("invoice_id", invoice_id);
      if ((allocCount ?? 0) > 0) {
        return json({ ok: false, error: "A receipt is allocated to this invoice — void it or raise a credit note instead of editing" }, 200);
      }

      const { count: cnCount } = await admin
        .from("ar_credit_notes")
        .select("id", { count: "exact", head: true })
        .eq("invoice_id", invoice_id)
        .not("status", "in", "(draft,voided)");
      if ((cnCount ?? 0) > 0) {
        return json({ ok: false, error: "A credit note is applied to this invoice — it can no longer be edited" }, 200);
      }

      // Find the live journal first: its date decides which period the
      // reversal falls in, and a closed one has to stop us before any write.
      const { data: liveJE } = await admin
        .from("journal_entries")
        .select("id, entry_date")
        .eq("source_type", "invoice")
        .eq("source_id", invoice_id)
        .neq("status", "voided")
        .maybeSingle();

      const { data: closed } = await admin
        .from("fiscal_periods")
        .select("period_start, period_end")
        .eq("tenant_id", appUser.tenant_id)
        .eq("status", "closed");
      const inClosed = (d: string | null | undefined) => {
        if (!d) return null;
        const when = new Date(d);
        return (closed || []).find(
          (p: any) => when >= new Date(p.period_start) && when <= new Date(p.period_end),
        );
      };
      const blockedPeriod = inClosed(liveJE?.entry_date) || inClosed(invoice.issue_date);
      if (blockedPeriod) {
        return json({
          ok: false,
          error: `Invoice falls in a closed period (${blockedPeriod.period_start} → ${blockedPeriod.period_end}); ` +
            "reopen the period or raise a credit note instead",
        }, 200);
      }

      let reversalJournalId: string | null = null;

      if (liveJE) {
        const { data: origLines } = await admin
          .from("journal_lines")
          .select("account_id, debit, credit")
          .eq("journal_entry_id", liveJE.id);

        await admin
          .from("journal_entries")
          .update({ status: "voided", voided_at: new Date().toISOString(), voided_by: appUser.id })
          .eq("id", liveJE.id);

        const { data: revJE, error: revErr } = await admin
          .from("journal_entries")
          .insert({
            tenant_id: appUser.tenant_id,
            entry_date: liveJE.entry_date,
            description: `Reversal of Invoice ${invoice.invoice_number} (reopened for edit)`,
            reference: invoice.invoice_number,
            status: "posted",
            posted_at: new Date().toISOString(),
            created_by: appUser.id,
            reversal_of: liveJE.id,
            source_type: "invoice_reversal",
            source_id: invoice_id,
            is_system_generated: true,
          })
          .select()
          .single();
        if (revErr) {
          // Put the original back: a voided entry with no reversal would leave
          // the ledger short by the invoice total.
          await admin
            .from("journal_entries")
            .update({ status: "posted", voided_at: null, voided_by: null })
            .eq("id", liveJE.id);
          return json({ ok: false, error: `Reversal failed: ${revErr.message}` }, 200);
        }
        reversalJournalId = revJE.id;

        await admin.from("journal_lines").insert(
          (origLines || []).map((l: any) => ({
            journal_entry_id: revJE.id,
            account_id: l.account_id,
            debit: Number(l.credit) || 0,
            credit: Number(l.debit) || 0,
          })),
        );

        // Tax sub-ledger: negating mirror rows, same contract as the void flow.
        const { error: taxRevErr } = await admin.rpc("reverse_tax_transactions", {
          p_tenant_id: appUser.tenant_id,
          p_source_type: "invoice",
          p_source_id: invoice_id,
          p_reversal_journal_id: revJE.id,
          p_reversal_date: liveJE.entry_date,
        });
        if (taxRevErr) console.error("Tax reversal rows failed:", taxRevErr.message);

        // Legacy GL-linked output VAT (non-engine invoices).
        const { data: legacyTaxRecs } = await admin
          .from("tax_records")
          .select("tax_amount")
          .eq("source_type", "invoice")
          .eq("source_id", invoice_id)
          .eq("direction", "output");
        const legacyTaxNet = (legacyTaxRecs || []).reduce((sum: number, r: any) => sum + Number(r.tax_amount || 0), 0);
        if (legacyTaxNet > 0) {
          await admin.from("tax_records").insert({
            tenant_id: appUser.tenant_id,
            invoice_id: invoice_id,
            tax_id: null,
            tax_amount: -legacyTaxNet,
            journal_entry_id: revJE.id,
            direction: "output",
            source_type: "invoice",
            source_id: invoice_id,
            transaction_date: liveJE.entry_date,
          });
        }
      }

      // AR sub-ledger rows are re-created by the repost, so the originals have
      // to go or the customer's outstanding balance (and their credit limit
      // check) counts this invoice twice. Safe here only because the guards
      // above proved nothing is allocated against them.
      await admin
        .from("ar_transactions")
        .delete()
        .eq("tenant_id", appUser.tenant_id)
        .eq("document_id", invoice_id)
        .eq("transaction_type", "INVOICE");
      await admin
        .from("ar_subledger")
        .delete()
        .eq("tenant_id", appUser.tenant_id)
        .eq("document_id", invoice_id)
        .eq("document_type", "invoice");

      const { error: reopenErr } = await admin
        .from("invoices")
        .update({ status: "draft", journal_entry_id: null, posted_at: null, posted_by: null })
        .eq("id", invoice_id);
      if (reopenErr) return json({ ok: false, error: `Failed to reopen invoice: ${reopenErr.message}` }, 200);

      await admin.from("audit_logs").insert({
        action: "Invoice Reopened",
        table_name: "invoices",
        record_id: invoice_id,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: {
          invoice_number: invoice.invoice_number,
          reversed_journal_id: liveJE?.id ?? null,
          reversal_je: reversalJournalId,
        },
      });

      return json({
        ok: true,
        message: "Invoice reopened as draft",
        reversal_journal_id: reversalJournalId,
      }, 200, rlHeaders);
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

    // Multi-currency: document amounts (total/subtotal/tax) are in invoice.currency;
    // the GL is booked in BASE (LKR) at the invoice's exchange_rate. For LKR
    // invoices fx === 1 and toBase() is a no-op, so existing behavior is unchanged.
    const fx = Number((invoice as any).exchange_rate) || 1;
    const toBase = (n: number) => Math.round(n * fx * 100) / 100;

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
      .select("ar_account_id, sales_account_id, tax_payable_account_id, vat_output_payable_account_id, enforce_credit_limit, invoice_approval_threshold")
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();

    const arAccountId = invoice.ar_account_id || settings?.ar_account_id;
    const defaultSalesId = invoice.revenue_account_id || settings?.sales_account_id;
    // Output VAT (sales) credits the dedicated VAT Output Payable account;
    // fall back to the deprecated shared tax_payable_account_id for tenants
    // not yet migrated. Input VAT lives on the bill side (post_supplier_bill).
    const taxPayableId = settings?.vat_output_payable_account_id ?? settings?.tax_payable_account_id;

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
              base_amount: Math.round(t.base * fx * 100) / 100,
              tax_amount: Math.round(t.amount * fx * 100) / 100, // base currency (LKR)
              tax_amount_txn_currency: t.amount,                  // document currency
              currency: invoice.currency || "LKR",
              fx_rate: fx,
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

    // ── Governance gate: approval workflow + credit control ──────────
    // An 'approved' invoice overrides credit hold/limit (an approver knowingly
    // signed off). System (cron) auto-post respects the same gate.
    const approvalStatus = (invoice as any).approval_status as string | undefined;
    if (approvalStatus === "pending") {
      const at = (invoice as any).approval_step_name
        ? ` (waiting at ${(invoice as any).approval_step_name})`
        : "";
      errors.push(`Invoice requires approval before it can be posted${at} — Sales → Approvals`);
    } else if (approvalStatus === "rejected") {
      errors.push("Invoice approval was rejected; it cannot be posted");
    } else if (approvalStatus === "changes_requested") {
      errors.push("An approver sent this invoice back for changes; resubmit it for approval before posting");
    }

    // Defense in depth: rebuild the approval chain for this invoice's BASE total
    // rather than trusting the stored approval_status alone (catches invoices
    // raised before the workflow existed, and any status drift). fx is defined above.
    const baseTotal = Math.round(total * fx * 100) / 100;
    const { data: planRows, error: planErr } = await admin.rpc("invoice_approval_plan", {
      p_tenant_id: appUser.tenant_id,
      p_base: baseTotal,
    });
    const plan = Array.isArray(planRows) ? planRows : [];
    if (!planErr && plan.length > 0 && approvalStatus !== "approved") {
      const levels = plan.map((s: any) => s.name).join(" → ");
      errors.push(
        `Invoice total (base ${baseTotal.toFixed(2)}) must clear ${plan.length} approval ` +
        `level${plan.length > 1 ? "s" : ""} (${levels}) before posting.`,
      );
    } else if (planErr) {
      // RPC unavailable (pre-migration): fall back to the flat threshold.
      const approvalThreshold = Number(settings?.invoice_approval_threshold || 0);
      if (approvalThreshold > 0 && baseTotal >= approvalThreshold && approvalStatus !== "approved") {
        errors.push(
          `Invoice total (base ${baseTotal.toFixed(2)}) is at/above the approval threshold ` +
          `(${approvalThreshold.toFixed(2)}) and must be approved before posting.`,
        );
      }
    }

    if (invoice.customer_id) {
      const { data: cust } = await admin
        .from("customers")
        .select("name, credit_limit, credit_hold")
        .eq("id", invoice.customer_id)
        .eq("tenant_id", appUser.tenant_id)
        .maybeSingle();
      if (cust && approvalStatus !== "approved") {
        if (cust.credit_hold) {
          errors.push(`Customer "${cust.name}" is on credit hold. Approve the invoice to override.`);
        }
        const creditLimit = Number(cust.credit_limit || 0);
        if (settings?.enforce_credit_limit !== false && creditLimit > 0) {
          const { data: openTxns } = await admin
            .from("ar_transactions")
            .select("outstanding_amount")
            .eq("tenant_id", appUser.tenant_id)
            .eq("customer_id", invoice.customer_id)
            .in("status", ["OPEN", "PARTIALLY_PAID"]);
          const outstanding = (openTxns || []).reduce((s: number, r: any) => s + Number(r.outstanding_amount || 0), 0);
          if (outstanding + total > creditLimit + EPSILON) {
            errors.push(
              `Posting would exceed "${cust.name}" credit limit ` +
              `(limit ${creditLimit.toFixed(2)}, current outstanding ${outstanding.toFixed(2)}, ` +
              `this invoice ${total.toFixed(2)}). Approve the invoice to override.`,
            );
          }
        }
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

    const journalLines: { account_id: string; debit: number; credit: number }[] = [];

    // Dr AR (single line, customer-tagged via subledger) — in base currency
    journalLines.push({ account_id: arAccountId!, debit: toBase(total), credit: 0 });

    // Cr Revenue accounts (grouped) — base currency
    for (const [acctId, amt] of revenueByAccount) {
      if (amt > 0) journalLines.push({ account_id: acctId, debit: 0, credit: toBase(amt) });
    }

    // Cr Tax Payable (legacy header-tax path only) — base currency
    if (taxAmount > 0 && taxPayableId) {
      journalLines.push({ account_id: taxPayableId, debit: 0, credit: toBase(taxAmount) });
    }

    // Cr each tax code's output liability account separately (aggregated
    // per code across lines) — tax engine path, base currency
    for (const [, agg] of taxByCode) {
      if (agg.amount > 0) {
        journalLines.push({ account_id: agg.account, debit: 0, credit: toBase(agg.amount) });
      }
    }

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

    // GL-linked output-VAT record for the LEGACY header-tax path (no tax
    // engine). Engine invoices are reconciled via tax_transactions above.
    if (!usesTaxEngine && taxAmount > 0) {
      const { error: taxRecErr } = await admin.from("tax_records").insert({
        tenant_id: appUser.tenant_id,
        invoice_id: invoice_id,
        tax_id: null,
        tax_amount: taxAmount,
        journal_entry_id: je.id,
        direction: "output",
        source_type: "invoice",
        source_id: invoice_id,
        transaction_date: invoice.issue_date,
      });
      if (taxRecErr) console.error("Output tax_records insert failed:", taxRecErr.message);
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
      debit: toBase(total),
      credit: 0,
      amount: toBase(total),
      balance: toBase(total),
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
      amount:           toBase(total),
      outstanding_amount: toBase(total),
      status:           "OPEN",
      journal_entry_id: je.id,
      journal_line_id:  arLineId,
      ar_account_id:    arAccountId,
    });

    await admin
      .from("invoices")
      .update({
        status: "posted",
        journal_entry_id: je.id,
        posted_at: new Date().toISOString(),
        posted_by: appUser.id,
      })
      .eq("id", invoice_id);

    // Serial register: this gazette number is now issued (IRD accounting).
    await admin
      .from("invoice_serial_register")
      .update({ status: "issued", invoice_id, updated_at: new Date().toISOString() })
      .eq("tenant_id", appUser.tenant_id)
      .eq("serial", invoice.invoice_number)
      .neq("status", "cancelled");

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
    }, 200, rlHeaders);
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Internal error" }, 200);
  }
});
