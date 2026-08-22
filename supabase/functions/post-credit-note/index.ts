// Server-side AR credit-note posting — the mirror image of post-invoice.
//
//  action "post": recomputes line tax server-side at the CREDIT DATE's rates
//    (never trusting client totals), reverses output VAT/SSCL in the tax
//    sub-ledger (negative direction='output' rows), enforces the
//    tiered approval gate and closed/filed-period guards, caps an
//    invoice-linked note at that invoice's outstanding balance, and books:
//      Dr Revenue (net, per line account)
//      Dr VAT/SSCL output liability (per tax code)
//      Cr Accounts Receivable (customer-tagged)
//    plus ar_transactions (CREDIT_NOTE) and the legacy ar_subledger mirror.
//  action "void": reversal JE, tax rows mirrored back,
//    CREDIT_NOTE_REVERSAL restores the invoice outstanding.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateLineTax,
  type TaxMemberInput,
  type CollectionMode,
} from "../_shared/taxEngine.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";

const EPSILON = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

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
    const { credit_note_id, action } = body as { credit_note_id: string; action: "post" | "void" };
    if (!credit_note_id) return json({ ok: false, error: "credit_note_id is required" }, 200);

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
    const role = (au as any).roles?.role_name as string | undefined;
    const allowed = ["Super Admin", "Primary Admin", "Company Admin", "Accountant"];
    if (!role || !allowed.includes(role)) {
      return json({ ok: false, error: `Role "${role || "unknown"}" cannot post credit notes` }, 200);
    }
    const appUser = { id: au.id, tenant_id: au.tenant_id };

    // After auth/role resolution and before any journal write, so a 429 cannot
    // leave a partially posted entry.
    const { blocked, headers: rlHeaders } = await enforceRateLimit(
      admin,
      "post-credit-note",
      { userId: appUser.id, tenantId: appUser.tenant_id, ip: clientIp(req) },
    );
    if (blocked) return blocked;

    // ── Fetch credit note + lines ─────────────────────────────────────
    const { data: cn } = await admin
      .from("ar_credit_notes")
      .select("*, ar_credit_note_items(*)")
      .eq("id", credit_note_id)
      .eq("tenant_id", appUser.tenant_id)
      .single();
    if (!cn) return json({ ok: false, error: "Credit note not found" }, 200);

    const { data: taxProfile } = await admin
      .from("tenant_tax_profiles")
      .select("*")
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();

    const closedPeriodError = async (isoDate: string): Promise<string | null> => {
      const { data: closed } = await admin
        .from("fiscal_periods")
        .select("period_start, period_end")
        .eq("tenant_id", appUser.tenant_id)
        .eq("status", "closed");
      for (const p of closed || []) {
        if (isoDate >= p.period_start && isoDate <= p.period_end) {
          return `Date ${isoDate} falls in a closed period (${p.period_start} → ${p.period_end})`;
        }
      }
      return null;
    };

    // ═════════════════════════════════════════════════════════════════
    // VOID
    // ═════════════════════════════════════════════════════════════════
    if (action === "void") {
      if (cn.status !== "posted") {
        return json({ ok: false, error: `Cannot void credit note in status "${cn.status}"` }, 200);
      }
      const today = new Date().toISOString().slice(0, 10);
      const closedErr = await closedPeriodError(today);
      if (closedErr) return json({ ok: false, error: closedErr }, 200);

      const { data: origJE } = await admin
        .from("journal_entries")
        .select("id")
        .eq("source_type", "credit_note")
        .eq("source_id", credit_note_id)
        .neq("status", "voided")
        .maybeSingle();
      if (!origJE) return json({ ok: false, error: "Original journal not found" }, 200);

      const { data: origLines } = await admin
        .from("journal_lines")
        .select("account_id, debit, credit, customer_id")
        .eq("journal_entry_id", origJE.id);

      await admin
        .from("journal_entries")
        .update({ status: "voided", voided_at: new Date().toISOString(), voided_by: appUser.id })
        .eq("id", origJE.id);

      const { data: revJE, error: revErr } = await admin
        .from("journal_entries")
        .insert({
          tenant_id: appUser.tenant_id,
          entry_date: today,
          description: `Reversal of Credit Note ${cn.credit_note_number}${body.reason ? ` — ${body.reason}` : ""}`,
          reference: cn.credit_note_number,
          status: "posted",
          posted_at: new Date().toISOString(),
          created_by: appUser.id,
          reversal_of: origJE.id,
          source_type: "credit_note_reversal",
          source_id: credit_note_id,
          is_system_generated: true,
        })
        .select()
        .single();
      if (revErr) return json({ ok: false, error: `Reversal failed: ${revErr.message}` }, 200);

      await admin.from("journal_lines").insert(
        (origLines || []).map((l: any) => ({
          journal_entry_id: revJE.id,
          account_id: l.account_id,
          debit: Number(l.credit) || 0,
          credit: Number(l.debit) || 0,
          customer_id: l.customer_id || null,
        })),
      );

      // Tax sub-ledger: mirror the (negative) CN rows back to positive.
      await admin.rpc("reverse_tax_transactions", {
        p_tenant_id: appUser.tenant_id,
        p_source_type: "credit_note",
        p_source_id: credit_note_id,
        p_reversal_journal_id: revJE.id,
        p_reversal_date: today,
      });

      // Restore the linked invoice's outstanding (trigger-driven).
      const baseTotal = round2(Number(cn.amount) * (Number(cn.exchange_rate) || 1));
      let relatedTxnId: string | null = null;
      if (cn.invoice_id) {
        const { data: invTxn } = await admin
          .from("ar_transactions")
          .select("id")
          .eq("tenant_id", appUser.tenant_id)
          .eq("transaction_type", "INVOICE")
          .eq("document_id", cn.invoice_id)
          .maybeSingle();
        relatedTxnId = invTxn?.id ?? null;
      }
      await admin.from("ar_transactions").insert({
        tenant_id: appUser.tenant_id,
        customer_id: cn.customer_id,
        transaction_type: "CREDIT_NOTE_REVERSAL",
        document_id: credit_note_id,
        document_ref: cn.credit_note_number,
        transaction_date: today,
        amount: baseTotal,
        outstanding_amount: 0,
        status: "PAID",
        journal_entry_id: revJE.id,
        related_transaction_id: relatedTxnId,
        ar_account_id: cn.ar_account_id,
        notes: body.reason || "Credit note voided",
      });

      await admin.from("ar_subledger").insert({
        tenant_id: appUser.tenant_id,
        customer_id: cn.customer_id,
        journal_id: revJE.id,
        debit: baseTotal,
        credit: 0,
        amount: baseTotal,
        balance: baseTotal,
        document_type: "credit_note_reversal",
        document_id: credit_note_id,
      });

      await admin
        .from("ar_credit_notes")
        .update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: appUser.id,
          void_reason: body.reason || null,
          reversal_journal_entry_id: revJE.id,
        })
        .eq("id", credit_note_id);

      await admin.from("audit_logs").insert({
        action: "Credit Note Voided",
        table_name: "ar_credit_notes",
        record_id: credit_note_id,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: { credit_note_number: cn.credit_note_number, reason: body.reason || null, reversal_je: revJE.id },
      });

      return json({ ok: true, message: "Credit note voided", reversal_journal_id: revJE.id });
    }

    // ═════════════════════════════════════════════════════════════════
    // POST
    // ═════════════════════════════════════════════════════════════════
    const errors: string[] = [];
    const warnings: string[] = [];

    if (cn.status !== "draft") {
      return json({ ok: false, error: `Cannot post credit note in status "${cn.status}"` }, 200);
    }
    if (!cn.customer_id) errors.push("Customer is required");
    const total = Number(cn.amount || 0);
    if (total <= 0) errors.push("Total must be greater than 0");

    const fx = Number(cn.exchange_rate) || 1;
    const toBase = (n: number) => round2(n * fx);
    const creditDate = cn.credit_date as string;

    const closedErr = await closedPeriodError(creditDate);
    if (closedErr) errors.push(closedErr);

    // ── Settings + accounts ───────────────────────────────────────────
    const { data: settings } = await admin
      .from("account_settings")
      .select("ar_account_id, sales_account_id, tax_payable_account_id, vat_output_payable_account_id, invoice_approval_threshold, credit_note_approval_threshold")
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();

    const arAccountId = cn.ar_account_id || settings?.ar_account_id;
    const defaultRevenueId = cn.revenue_account_id || settings?.sales_account_id;
    const taxPayableId = settings?.vat_output_payable_account_id ?? settings?.tax_payable_account_id;
    if (!arAccountId) errors.push("Accounts Receivable not configured (Settings → Account Mapping)");

    // ── Approval gate (same semantics as invoices) ────────────────────
    const approvalStatus = cn.approval_status as string | undefined;
    if (approvalStatus === "pending") {
      errors.push("Credit note requires approval before it can be posted");
    } else if (approvalStatus === "rejected") {
      errors.push("Credit note approval was rejected; it cannot be posted");
    }
    const threshold = Number(settings?.credit_note_approval_threshold ?? settings?.invoice_approval_threshold ?? 0);
    if (threshold > 0) {
      const baseTotal = toBase(total);
      if (baseTotal >= threshold && approvalStatus !== "approved") {
        errors.push(
          `Credit note total (base ${baseTotal.toFixed(2)}) is at/above the approval threshold ` +
          `(${threshold.toFixed(2)}) and must be approved before posting.`,
        );
      }
    }

    // ── Linked invoice: same customer/currency, cap at outstanding ────
    let invoiceTxnId: string | null = null;
    if (cn.invoice_id) {
      const { data: inv } = await admin
        .from("invoices")
        .select("id, invoice_number, status, customer_id, currency, exchange_rate")
        .eq("id", cn.invoice_id)
        .eq("tenant_id", appUser.tenant_id)
        .maybeSingle();
      if (!inv) errors.push("Linked invoice not found");
      else {
        if (inv.status === "draft" || inv.status === "voided") {
          errors.push(`Linked invoice ${inv.invoice_number} is ${inv.status}`);
        }
        if (inv.customer_id !== cn.customer_id) errors.push("Linked invoice belongs to a different customer");
        if ((inv.currency || "LKR") !== (cn.currency || "LKR")) {
          errors.push(`Credit note currency (${cn.currency}) must match the invoice's (${inv.currency})`);
        }
        if (Math.abs((Number(inv.exchange_rate) || 1) - fx) > 0.000001) {
          errors.push("A credit note against an invoice must use the invoice's booked exchange rate (AR is relieved at cost)");
        }
        const { data: invTxn } = await admin
          .from("ar_transactions")
          .select("id, outstanding_amount")
          .eq("tenant_id", appUser.tenant_id)
          .eq("transaction_type", "INVOICE")
          .eq("document_id", cn.invoice_id)
          .maybeSingle();
        invoiceTxnId = invTxn?.id ?? null;
        if (invTxn && toBase(total) > Number(invTxn.outstanding_amount) + EPSILON * Math.max(1, fx)) {
          errors.push(
            `Credit note (base ${toBase(total).toFixed(2)}) exceeds invoice ${inv.invoice_number}'s outstanding balance ` +
            `(${Number(invTxn.outstanding_amount).toFixed(2)}). Reduce the amount or issue it unlinked (credit on account).`,
          );
        }
      }
    }

    // ═════════ Tax engine: per-line recomputation at CREDIT DATE ═════════
    const itemsAll = (cn.ar_credit_note_items || []) as any[];
    const usesTaxEngine = itemsAll.some((it) => it.tax_code_id || it.tax_group_id);
    const hasLines = itemsAll.length > 0;
    if (!hasLines && !defaultRevenueId) {
      errors.push("Default Sales Revenue not configured (needed for a header-only credit note)");
    }

    type CodeMeta = {
      id: string; code: string; tax_type: string; collection_mode: CollectionMode;
      rounding_method: string; output_liability_account_id: string | null;
    };
    const taxByCode = new Map<string, { meta: CodeMeta; amount: number; base: number; rate: number; account: string }>();
    const taxTxnRows: any[] = [];
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
        .select("id, code, tax_type, collection_mode, is_active, rounding_method, output_liability_account_id, tenant_id")
        .in("id", [...codeIds]);
      const codeById = new Map<string, any>((codes || []).map((c: any) => [c.id, c]));

      const { data: rates } = await admin
        .from("tax_code_rates")
        .select("tax_code_id, rate, effective_from, effective_to")
        .in("tax_code_id", [...codeIds]);
      const rateFor = (codeId: string): number | null => {
        const candidates = (rates || [])
          .filter((r: any) => r.tax_code_id === codeId && r.effective_from <= creditDate && (!r.effective_to || r.effective_to >= creditDate))
          .sort((a: any, b: any) => (a.effective_from < b.effective_from ? 1 : -1));
        return candidates.length ? Number(candidates[0].rate) : null;
      };

      for (const c of codes || []) {
        if (c.tenant_id !== appUser.tenant_id) errors.push(`Tax code ${c.code} belongs to another tenant`);
        if (!c.is_active) errors.push(`Tax code ${c.code} is inactive`);
        if (c.tax_type === "VAT" && !taxProfile?.is_vat_registered) {
          errors.push(`Cannot credit ${c.code}: tenant is not VAT-registered (Settings → Tax Configuration)`);
        }
        if (c.tax_type === "SSCL" && !taxProfile?.is_sscl_liable) {
          errors.push(`Cannot credit ${c.code}: tenant is not SSCL-liable (Settings → Tax Configuration)`);
        }
        if (c.collection_mode !== "output") {
          errors.push(`Tax code ${c.code} (${c.collection_mode}) cannot be used on a sales credit note`);
        }
      }

      if (errors.length === 0) {
        for (const it of itemsAll) {
          const lineAmount = Number(it.quantity) * Number(it.unit_price) - Number(it.discount_amount || 0);
          if (!it.tax_code_id && !it.tax_group_id) {
            const net = round2(lineAmount);
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
            if (rate === null) { errors.push(`No ${c.code} rate effective on ${creditDate}`); continue; }
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
            documentDate: creditDate,
          });

          lineNetById.set(it.id, result.exclusiveBase);
          computedSubtotal += result.exclusiveBase;
          for (const t of result.taxes) {
            computedTax += t.amount;
            const meta = codeById.get(t.taxCodeId) as CodeMeta;
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
            agg.amount = round2(agg.amount + t.amount);
            agg.base = round2(agg.base + t.base);
            taxByCode.set(t.taxCodeId, agg);
            // Credit notes REDUCE output tax: negative sub-ledger rows,
            // mirroring what reverse_tax_transactions writes for voids.
            taxTxnRows.push({
              tenant_id: appUser.tenant_id,
              tax_code_id: t.taxCodeId,
              direction: "output",
              source_type: "credit_note",
              source_id: credit_note_id,
              source_line_id: it.id,
              base_amount: -round2(t.base * fx),
              tax_amount: -round2(t.amount * fx),
              tax_amount_txn_currency: -t.amount,
              currency: cn.currency || "LKR",
              fx_rate: fx,
              rate_applied: t.rate,
              transaction_date: creditDate,
              note: `Credit note ${cn.credit_note_number}`,
            });
          }
        }
      }

      computedSubtotal = round2(computedSubtotal);
      computedTax = round2(computedTax);
      const computedTotal = round2(computedSubtotal + computedTax);
      if (errors.length === 0 && Math.abs(computedTotal - total) > 0.01) {
        errors.push(
          `Tax recalculated server-side differs from submitted values ` +
          `(server total ${computedTotal.toFixed(2)} vs submitted ${total.toFixed(2)})`,
        );
      }

      // Filed tax period guard.
      if (errors.length === 0 && taxTxnRows.length > 0) {
        const taxTypes = [...new Set([...taxByCode.values()].map((v) => v.meta.tax_type))];
        const { data: filedPeriods } = await admin
          .from("tax_periods")
          .select("tax_type, period_start, period_end")
          .eq("tenant_id", appUser.tenant_id)
          .eq("status", "filed")
          .in("tax_type", taxTypes);
        for (const p of filedPeriods || []) {
          if (creditDate >= p.period_start && creditDate <= p.period_end) {
            errors.push(`The ${p.tax_type} period covering ${creditDate} is already filed. Use a credit date in the open period.`);
          }
        }
      }
    } else if (hasLines) {
      // Untaxed lines: server-side total check still applies.
      let sum = 0;
      for (const it of itemsAll) {
        const net = round2(Number(it.quantity) * Number(it.unit_price) - Number(it.discount_amount || 0));
        lineNetById.set(it.id, net);
        sum += net;
      }
      if (Math.abs(round2(sum) - total) > 0.01) {
        errors.push(`Line total ${round2(sum).toFixed(2)} differs from credit note total ${total.toFixed(2)}`);
      }
    }

    // ── Revenue distribution ──────────────────────────────────────────
    const revenueByAccount = new Map<string, number>();
    if (hasLines) {
      for (const it of itemsAll) {
        const acctId = it.account_id || defaultRevenueId;
        if (!acctId) { errors.push("A line has no revenue account and no default is configured"); break; }
        const net = lineNetById.get(it.id) ?? round2(Number(it.quantity) * Number(it.unit_price) - Number(it.discount_amount || 0));
        revenueByAccount.set(acctId, round2((revenueByAccount.get(acctId) || 0) + net));
      }
    } else {
      revenueByAccount.set(defaultRevenueId!, total);
    }

    // ── Validate accounts ─────────────────────────────────────────────
    const accountIdsToCheck = new Set<string>();
    if (arAccountId) accountIdsToCheck.add(arAccountId);
    for (const [id] of revenueByAccount) accountIdsToCheck.add(id);
    for (const [, agg] of taxByCode) accountIdsToCheck.add(agg.account);
    if (accountIdsToCheck.size > 0) {
      const { data: accs } = await admin
        .from("accounts")
        .select("id, account_name, is_active, tenant_id")
        .in("id", [...accountIdsToCheck]);
      const accMap = new Map((accs || []).map((a: any) => [a.id, a]));
      for (const id of accountIdsToCheck) {
        const a = accMap.get(id);
        if (!a) errors.push(`Account ${id} not found`);
        else if (a.tenant_id !== appUser.tenant_id) errors.push(`Account ${a.account_name} belongs to another tenant`);
        else if (!a.is_active) errors.push(`Account "${a.account_name}" is inactive`);
      }
    }

    if (errors.length > 0) {
      return json({ ok: false, error: "Cannot post credit note. Issues found:\n• " + errors.join("\n• "), errors }, 200);
    }

    // ── Idempotency ───────────────────────────────────────────────────
    const { data: existingJE } = await admin
      .from("journal_entries")
      .select("id")
      .eq("source_type", "credit_note")
      .eq("source_id", credit_note_id)
      .neq("status", "voided")
      .maybeSingle();
    if (existingJE) {
      await admin.from("ar_credit_notes").update({ status: "posted" }).eq("id", credit_note_id);
      return json({ ok: true, message: "Already posted (idempotent)", journal_id: existingJE.id });
    }

    // ── Build journal lines (base currency) ───────────────────────────
    const journalLines: { account_id: string; debit: number; credit: number; customer_id?: string | null }[] = [];
    for (const [acctId, amt] of revenueByAccount) {
      if (amt > 0) journalLines.push({ account_id: acctId, debit: toBase(amt), credit: 0 });
    }
    for (const [, agg] of taxByCode) {
      if (agg.amount > 0) journalLines.push({ account_id: agg.account, debit: toBase(agg.amount), credit: 0 });
    }
    journalLines.push({ account_id: arAccountId!, debit: 0, credit: toBase(total), customer_id: cn.customer_id });

    const totalDr = round2(journalLines.reduce((s, l) => s + l.debit, 0));
    const totalCr = round2(journalLines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(totalDr - totalCr) > EPSILON) {
      return json({ ok: false, error: `Journal unbalanced: Debits=${totalDr.toFixed(2)} Credits=${totalCr.toFixed(2)}` }, 200);
    }

    // ── Create + post JE ──────────────────────────────────────────────
    const { data: je, error: jeErr } = await admin
      .from("journal_entries")
      .insert({
        tenant_id: appUser.tenant_id,
        entry_date: creditDate,
        description: `Credit Note ${cn.credit_note_number}`,
        reference: cn.credit_note_number,
        status: "draft",
        created_by: appUser.id,
        source_type: "credit_note",
        source_id: credit_note_id,
        is_system_generated: true,
        entry_type: "credit_note",
      })
      .select()
      .single();
    if (jeErr) {
      if (jeErr.code === "23505") {
        return json({ ok: false, error: "Credit note already has a posted journal (idempotency guard)" }, 200);
      }
      return json({ ok: false, error: `Failed to create journal: ${jeErr.message}` }, 200);
    }

    const { error: linesErr } = await admin.from("journal_lines").insert(
      journalLines.map((l) => ({
        journal_entry_id: je.id,
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
        customer_id: l.customer_id || null,
      })),
    );
    if (linesErr) {
      await admin.from("journal_entries").delete().eq("id", je.id);
      return json({ ok: false, error: `Failed to insert lines: ${linesErr.message}` }, 200);
    }

    // ── Tax sub-ledger (negative output rows) — all-or-nothing ────────
    if (taxTxnRows.length > 0) {
      const { error: taxTxnErr } = await admin
        .from("tax_transactions")
        .insert(taxTxnRows.map((r) => ({ ...r, journal_entry_id: je.id })));
      if (taxTxnErr) {
        await admin.from("journal_lines").delete().eq("journal_entry_id", je.id);
        await admin.from("journal_entries").delete().eq("id", je.id);
        return json({ ok: false, error: `Tax sub-ledger insert failed: ${taxTxnErr.message}` }, 200);
      }
    }

    const { error: postErr } = await admin
      .from("journal_entries")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", je.id);
    if (postErr) return json({ ok: false, error: `Failed to post: ${postErr.message}` }, 200);

    const { data: arLine } = await admin
      .from("journal_lines")
      .select("id")
      .eq("journal_entry_id", je.id)
      .eq("account_id", arAccountId!)
      .maybeSingle();

    // ── AR sub-ledgers ────────────────────────────────────────────────
    await admin.from("ar_transactions").insert({
      tenant_id: appUser.tenant_id,
      customer_id: cn.customer_id,
      transaction_type: "CREDIT_NOTE",
      document_id: credit_note_id,
      document_ref: cn.credit_note_number,
      transaction_date: creditDate,
      amount: toBase(total),
      outstanding_amount: 0,
      status: "PAID",
      journal_entry_id: je.id,
      journal_line_id: arLine?.id ?? null,
      related_transaction_id: invoiceTxnId,
      ar_account_id: arAccountId,
      notes: cn.reason || null,
    });

    await admin.from("ar_subledger").insert({
      tenant_id: appUser.tenant_id,
      customer_id: cn.customer_id,
      journal_id: je.id,
      journal_line_id: arLine?.id ?? null,
      debit: 0,
      credit: toBase(total),
      amount: -toBase(total),
      balance: -toBase(total),
      document_type: "credit_note",
      document_id: credit_note_id,
    });

    await admin
      .from("ar_credit_notes")
      .update({
        status: "posted",
        journal_entry_id: je.id,
        subtotal: usesTaxEngine ? computedSubtotal : (hasLines ? round2([...lineNetById.values()].reduce((s, n) => s + n, 0)) : total),
        tax_amount: usesTaxEngine ? computedTax : 0,
        posted_at: new Date().toISOString(),
        posted_by: appUser.id,
      })
      .eq("id", credit_note_id);

    await admin.from("audit_logs").insert({
      action: "Credit Note Posted",
      table_name: "ar_credit_notes",
      record_id: credit_note_id,
      user_id: appUser.id,
      tenant_id: appUser.tenant_id,
      details: {
        credit_note_number: cn.credit_note_number,
        journal_id: je.id,
        total_debit: totalDr,
        total_credit: totalCr,
        tax_reversed: usesTaxEngine ? computedTax : 0,
        linked_invoice: cn.invoice_id || null,
      },
    });

    return json({
      ok: true,
      message: "Credit note posted",
      journal_id: je.id,
      lines: journalLines.length,
      tax_transactions: taxTxnRows.length,
      warnings: warnings.length ? warnings : undefined,
    }, 200, rlHeaders);
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Internal error" }, 200);
  }
});
