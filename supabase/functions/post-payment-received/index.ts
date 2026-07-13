// Server-side AR receipt posting (mirror of post-invoice's hardening).
//
//  action "post": one receipt settles MANY invoices (allocations), optionally
//    auto-applied oldest-first. Validates ownership, invoice status, per-invoice
//    outstanding, closed periods, WHT, realized FX, and books everything —
//    payments_received header, payment_received_allocations, JE, ar_transactions,
//    ar_subledger, tax_transactions (WHT), and an optional customer_deposit for
//    an overpayment remainder. Idempotent via request_id and resume-safe: a
//    retry after a mid-flight crash completes the posting instead of duplicating.
//    Also supports deposit-funded application (funded_by_deposit_id): the debit
//    side comes from Customer Advances instead of Bank.
//  action "void": NSF / bounced-cheque reversal — reversal JE, PAYMENT_REVERSAL
//    ar_transactions rows (restore invoice outstanding + customer balance),
//    WHT sub-ledger reversal, deposit rollback, receipt marked voided.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPSILON = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Allocation = { invoice_id: string; amount: number };

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
    const action = (body.action as "post" | "void") || "post";

    // ── Interactive auth only; finance roles ─────────────────────────
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
      return json({ ok: false, error: `Role "${role || "unknown"}" cannot record customer payments` }, 200);
    }
    const appUser = { id: au.id, tenant_id: au.tenant_id };

    // ── Shared helpers ────────────────────────────────────────────────
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
    // VOID (NSF / bounced cheque / recorded in error)
    // ═════════════════════════════════════════════════════════════════
    if (action === "void") {
      const paymentId = body.payment_id as string;
      if (!paymentId) return json({ ok: false, error: "payment_id is required" }, 200);

      const { data: pmt } = await admin
        .from("payments_received")
        .select("*")
        .eq("id", paymentId)
        .eq("tenant_id", appUser.tenant_id)
        .single();
      if (!pmt) return json({ ok: false, error: "Receipt not found" }, 200);
      if (pmt.status === "voided") return json({ ok: true, message: "Already voided (idempotent)" });
      if (!pmt.journal_entry_id) return json({ ok: false, error: "Receipt has no journal entry; contact support" }, 200);

      const today = new Date().toISOString().slice(0, 10);
      const closedErr = await closedPeriodError(today);
      if (closedErr) return json({ ok: false, error: closedErr }, 200);

      // Overpayment deposit created by this receipt must be untouched.
      if (pmt.deposit_id) {
        const { data: dep } = await admin
          .from("customer_deposits")
          .select("id, applied_amount, status")
          .eq("id", pmt.deposit_id)
          .single();
        if (dep && Number(dep.applied_amount) > 0) {
          return json({
            ok: false,
            error: "The overpayment from this receipt was parked as a customer deposit that has since been applied to invoices. Reverse those applications first.",
          }, 200);
        }
      }

      // Reversal JE (swap Dr/Cr), original marked voided — same convention as
      // the invoice void flow so reports treat both identically.
      const { data: origLines } = await admin
        .from("journal_lines")
        .select("account_id, debit, credit, customer_id")
        .eq("journal_entry_id", pmt.journal_entry_id);
      if (!origLines?.length) return json({ ok: false, error: "Original journal lines not found" }, 200);

      await admin
        .from("journal_entries")
        .update({ status: "voided", voided_at: new Date().toISOString(), voided_by: appUser.id })
        .eq("id", pmt.journal_entry_id);

      const label = pmt.payment_number || pmt.reference || pmt.id;
      const { data: revJE, error: revErr } = await admin
        .from("journal_entries")
        .insert({
          tenant_id: appUser.tenant_id,
          entry_date: today,
          description: `Reversal of receipt ${label}${body.reason ? ` — ${body.reason}` : ""}`,
          reference: pmt.reference,
          status: "posted",
          posted_at: new Date().toISOString(),
          created_by: appUser.id,
          reversal_of: pmt.journal_entry_id,
          source_type: "payment_reversal",
          source_id: pmt.id,
          is_system_generated: true,
        })
        .select()
        .single();
      if (revErr) return json({ ok: false, error: `Reversal failed: ${revErr.message}` }, 200);

      await admin.from("journal_lines").insert(
        origLines.map((l: any) => ({
          journal_entry_id: revJE.id,
          account_id: l.account_id,
          debit: Number(l.credit) || 0,
          credit: Number(l.debit) || 0,
          customer_id: l.customer_id || null,
        })),
      );

      // Restore each settled invoice's outstanding via the reversal trigger.
      const { data: allocs } = await admin
        .from("payment_received_allocations")
        .select("invoice_id, amount, amount_base")
        .eq("payment_id", pmt.id);
      for (const a of allocs || []) {
        const { data: invTxn } = await admin
          .from("ar_transactions")
          .select("id")
          .eq("tenant_id", appUser.tenant_id)
          .eq("transaction_type", "INVOICE")
          .eq("document_id", a.invoice_id)
          .maybeSingle();
        await admin.from("ar_transactions").insert({
          tenant_id: appUser.tenant_id,
          customer_id: pmt.customer_id,
          transaction_type: "PAYMENT_REVERSAL",
          document_id: pmt.id,
          document_ref: label,
          transaction_date: today,
          amount: Number(a.amount_base),
          outstanding_amount: 0,
          status: "PAID",
          journal_entry_id: revJE.id,
          related_transaction_id: invTxn?.id ?? null,
          ar_account_id: pmt.ar_account_id,
          notes: body.reason || "Receipt voided",
        });
      }

      // Legacy subledger mirror: re-debit AR.
      const totalArBase = (allocs || []).reduce((s: number, a: any) => s + Number(a.amount_base), 0);
      if (totalArBase > 0 && pmt.customer_id) {
        await admin.from("ar_subledger").insert({
          tenant_id: appUser.tenant_id,
          customer_id: pmt.customer_id,
          journal_id: revJE.id,
          debit: round2(totalArBase),
          credit: 0,
          amount: round2(totalArBase),
          balance: round2(totalArBase),
          document_type: "payment_reversal",
          document_id: pmt.id,
        });
      }

      // WHT sub-ledger rows mirrored negative.
      await admin.rpc("reverse_tax_transactions", {
        p_tenant_id: appUser.tenant_id,
        p_source_type: "payment_received",
        p_source_id: pmt.id,
        p_reversal_journal_id: revJE.id,
        p_reversal_date: today,
      });

      // Deposit rollback.
      if (pmt.deposit_id) {
        await admin
          .from("customer_deposits")
          .update({ status: "voided", updated_at: new Date().toISOString() })
          .eq("id", pmt.deposit_id);
      }
      if (pmt.funded_by_deposit_id) {
        const { data: dep } = await admin
          .from("customer_deposits")
          .select("id, amount, applied_amount")
          .eq("id", pmt.funded_by_deposit_id)
          .single();
        if (dep) {
          const newApplied = Math.max(0, round2(Number(dep.applied_amount) - Number(pmt.amount)));
          await admin
            .from("customer_deposits")
            .update({
              applied_amount: newApplied,
              status: newApplied <= EPSILON ? "unapplied" : "partially_applied",
              updated_at: new Date().toISOString(),
            })
            .eq("id", dep.id);
          await admin
            .from("deposit_applications")
            .delete()
            .eq("deposit_id", dep.id)
            .eq("journal_entry_id", pmt.journal_entry_id);
        }
      }

      await admin
        .from("payments_received")
        .update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: appUser.id,
          void_reason: body.reason || null,
          reversal_journal_entry_id: revJE.id,
        })
        .eq("id", pmt.id);

      await admin.from("audit_logs").insert({
        action: "Customer Receipt Voided",
        table_name: "payments_received",
        record_id: pmt.id,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: { payment_number: pmt.payment_number, amount: pmt.amount, reason: body.reason || null, reversal_je: revJE.id },
      });

      return json({ ok: true, message: "Receipt voided", reversal_journal_id: revJE.id });
    }

    // ═════════════════════════════════════════════════════════════════
    // POST
    // ═════════════════════════════════════════════════════════════════
    const {
      request_id,
      customer_id,
      payment_date,
      payment_method,
      reference,
      bank_account_id,
      funded_by_deposit_id,
      wht_amount,
      overpayment_action,
      auto_apply_amount,
    } = body as {
      request_id: string;
      customer_id: string;
      payment_date: string;
      payment_method?: string;
      reference?: string;
      bank_account_id?: string;
      funded_by_deposit_id?: string;
      wht_amount?: number;
      overpayment_action?: "deposit" | "reject";
      auto_apply_amount?: number;
    };
    let allocations = (body.allocations || []) as Allocation[];

    const errors: string[] = [];
    if (!request_id) errors.push("request_id is required (idempotency key)");
    if (!customer_id) errors.push("customer_id is required");
    if (!payment_date || !/^\d{4}-\d{2}-\d{2}$/.test(payment_date)) errors.push("payment_date (YYYY-MM-DD) is required");
    if (!funded_by_deposit_id && !bank_account_id) errors.push("bank_account_id is required");
    if (errors.length) return json({ ok: false, error: errors.join("; "), errors }, 200);

    // ── Idempotency / resume: same request_id returns the same receipt ─
    const { data: existing } = await admin
      .from("payments_received")
      .select("id, journal_entry_id, payment_number, status")
      .eq("tenant_id", appUser.tenant_id)
      .eq("request_id", request_id)
      .maybeSingle();
    if (existing?.journal_entry_id) {
      return json({ ok: true, message: "Already recorded (idempotent)", payment_id: existing.id, payment_number: existing.payment_number, journal_id: existing.journal_entry_id });
    }

    // ── Customer ──────────────────────────────────────────────────────
    const { data: customer } = await admin
      .from("customers")
      .select("id, name")
      .eq("id", customer_id)
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();
    if (!customer) return json({ ok: false, error: "Customer not found in this tenant" }, 200);

    const closedErr = await closedPeriodError(payment_date);
    if (closedErr) errors.push(closedErr);

    // ── Settings ──────────────────────────────────────────────────────
    const { data: settings } = await admin
      .from("account_settings")
      .select("ar_account_id, fx_gain_account_id, fx_loss_account_id, customer_advance_account_id")
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();

    // ── Auto-apply: oldest-first against open invoices ────────────────
    if ((!allocations || allocations.length === 0) && Number(auto_apply_amount) > 0) {
      const { data: openTxns } = await admin
        .from("ar_transactions")
        .select("document_id, outstanding_amount, due_date, transaction_date")
        .eq("tenant_id", appUser.tenant_id)
        .eq("customer_id", customer_id)
        .eq("transaction_type", "INVOICE")
        .in("status", ["OPEN", "PARTIALLY_PAID"])
        .gt("outstanding_amount", 0)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("transaction_date", { ascending: true });
      const invIds = (openTxns || []).map((t: any) => t.document_id).filter(Boolean);
      const { data: invRows } = invIds.length
        ? await admin.from("invoices").select("id, exchange_rate, currency").in("id", invIds)
        : { data: [] as any[] };
      const rateById = new Map((invRows || []).map((i: any) => [i.id, Number(i.exchange_rate) || 1]));

      let remaining = Number(auto_apply_amount);
      allocations = [];
      for (const t of openTxns || []) {
        if (remaining <= EPSILON) break;
        const rate = rateById.get(t.document_id) ?? 1;
        // outstanding is BASE; convert to document currency for the allocation.
        const docOutstanding = round2(Number(t.outstanding_amount) / rate);
        if (docOutstanding <= 0) continue;
        const take = Math.min(remaining, docOutstanding);
        allocations.push({ invoice_id: t.document_id, amount: round2(take) });
        remaining = round2(remaining - take);
      }
    }

    // Two entry modes: explicit allocations (+ optional unapplied remainder),
    // or auto_apply_amount (server allocated oldest-first above; whatever could
    // not be applied becomes the remainder).
    const allocTotal = round2(allocations.reduce((s, a) => s + Number(a.amount || 0), 0));
    const remainder = Number(auto_apply_amount) > 0
      ? Math.max(0, round2(Number(auto_apply_amount) - allocTotal))
      : Math.max(0, round2(Number(body.unapplied_amount || 0)));
    const gross = round2(allocTotal + remainder);

    if (gross <= 0) errors.push("Receipt amount must be greater than 0");
    for (const a of allocations) {
      if (!a.invoice_id || !(Number(a.amount) > 0)) errors.push("Every allocation needs an invoice_id and a positive amount");
    }
    const dupCheck = new Set(allocations.map((a) => a.invoice_id));
    if (dupCheck.size !== allocations.length) errors.push("Duplicate invoice in allocations");

    const wht = Math.max(0, round2(Number(wht_amount || 0)));
    if (wht > gross + EPSILON) errors.push("Withheld tax cannot exceed the receipt amount");

    if (remainder > EPSILON) {
      if ((overpayment_action || "reject") !== "deposit") {
        errors.push(`Receipt exceeds the allocated invoices by ${remainder.toFixed(2)}. Allocate it or choose to hold it as a customer deposit.`);
      } else if (!settings?.customer_advance_account_id) {
        errors.push("Customer Advances account not configured (Settings → Account Mapping) — required to hold the overpayment on account.");
      }
    }
    if (errors.length) return json({ ok: false, error: "Cannot record receipt:\n• " + errors.join("\n• "), errors }, 200);

    // ── Load + validate allocated invoices ────────────────────────────
    const invoiceIds = allocations.map((a) => a.invoice_id);
    const { data: invoices } = invoiceIds.length
      ? await admin
          .from("invoices")
          .select("id, invoice_number, status, customer_id, tenant_id, currency, exchange_rate, total_amount, ar_account_id")
          .in("id", invoiceIds)
      : { data: [] as any[] };
    const invById = new Map((invoices || []).map((i: any) => [i.id, i]));

    let receiptCurrency = "LKR";
    for (const a of allocations) {
      const inv = invById.get(a.invoice_id);
      if (!inv) { errors.push(`Invoice ${a.invoice_id} not found`); continue; }
      if (inv.tenant_id !== appUser.tenant_id) { errors.push(`Invoice ${inv.invoice_number} belongs to another tenant`); continue; }
      if (inv.customer_id !== customer_id) errors.push(`Invoice ${inv.invoice_number} belongs to a different customer`);
      if (inv.status === "draft") errors.push(`Invoice ${inv.invoice_number} is a draft — post it before receiving payment`);
      if (inv.status === "voided") errors.push(`Invoice ${inv.invoice_number} is voided`);
    }
    const currencies = new Set((invoices || []).map((i: any) => i.currency || "LKR"));
    if (currencies.size > 1) errors.push("All invoices on one receipt must share the same currency");
    if (currencies.size === 1) receiptCurrency = [...currencies][0] as string;
    if (errors.length) return json({ ok: false, error: "Cannot record receipt:\n• " + errors.join("\n• "), errors }, 200);

    // ── Payment-date FX rate ──────────────────────────────────────────
    let payRate = 1;
    if (receiptCurrency !== "LKR") {
      if (Number(body.exchange_rate) > 0) {
        payRate = Number(body.exchange_rate);
      } else {
        const { data: rate } = await admin.rpc("fx_rate", {
          p_tenant_id: appUser.tenant_id,
          p_currency: receiptCurrency,
          p_date: payment_date,
        });
        if (Number(rate) > 0) payRate = Number(rate);
        else errors.push(`No ${receiptCurrency} exchange rate for ${payment_date} (Settings → Currencies)`);
      }
    }

    // ── Per-invoice outstanding check (BASE, from ar_transactions) ────
    type AllocResolved = Allocation & { amount_base: number; invoice_number: string; ar_txn_id: string | null; inv_rate: number };
    const resolved: AllocResolved[] = [];
    for (const a of allocations) {
      const inv = invById.get(a.invoice_id)!;
      const invRate = Number(inv.exchange_rate) || 1;
      const allocBase = round2(Number(a.amount) * invRate);

      const { data: invTxn } = await admin
        .from("ar_transactions")
        .select("id, outstanding_amount, status")
        .eq("tenant_id", appUser.tenant_id)
        .eq("transaction_type", "INVOICE")
        .eq("document_id", a.invoice_id)
        .maybeSingle();

      if (invTxn) {
        if (allocBase > Number(invTxn.outstanding_amount) + EPSILON * Math.max(1, invRate)) {
          errors.push(
            `Allocation to ${inv.invoice_number} (${Number(a.amount).toFixed(2)} ${receiptCurrency}) exceeds its outstanding balance ` +
            `(${Number(invTxn.outstanding_amount).toFixed(2)} base).`,
          );
        }
      } else {
        // Legacy invoice without an ar_transactions row: fall back to
        // allocations + non-voided credit notes recorded against it.
        const [{ data: paidAllocs }, { data: cns }] = await Promise.all([
          admin
            .from("payment_received_allocations")
            .select("amount, payments_received!inner(status)")
            .eq("invoice_id", a.invoice_id),
          admin
            .from("ar_credit_notes")
            .select("amount, status")
            .eq("invoice_id", a.invoice_id)
            .neq("status", "voided"),
        ]);
        const paid = (paidAllocs || [])
          .filter((p: any) => p.payments_received?.status !== "voided")
          .reduce((s: number, p: any) => s + Number(p.amount), 0);
        const credited = (cns || []).reduce((s: number, c: any) => s + Number(c.amount), 0);
        const outstandingDoc = round2(Number(inv.total_amount) - paid - credited);
        if (Number(a.amount) > outstandingDoc + EPSILON) {
          errors.push(`Allocation to ${inv.invoice_number} exceeds its outstanding balance (${outstandingDoc.toFixed(2)}).`);
        }
      }

      resolved.push({ ...a, amount_base: allocBase, invoice_number: inv.invoice_number, ar_txn_id: invTxn?.id ?? null, inv_rate: invRate });
    }

    // ── Accounts ──────────────────────────────────────────────────────
    const arAccountId = (body.ar_account_id as string) || (invoices?.[0]?.ar_account_id as string) || settings?.ar_account_id;
    if (!arAccountId && allocations.length > 0) errors.push("Accounts Receivable not configured (Settings → Account Mapping)");

    // Deposit-funded application (no bank movement).
    let fundingDeposit: any = null;
    if (funded_by_deposit_id) {
      const { data: dep } = await admin
        .from("customer_deposits")
        .select("*")
        .eq("id", funded_by_deposit_id)
        .eq("tenant_id", appUser.tenant_id)
        .single();
      if (!dep) errors.push("Funding deposit not found");
      else {
        fundingDeposit = dep;
        if (dep.customer_id !== customer_id) errors.push("Deposit belongs to a different customer");
        if (dep.status === "voided") errors.push("Deposit is voided");
        if (!dep.advance_account_id) errors.push("Deposit has no Customer Advances account");
        const unapplied = round2(Number(dep.amount) - Number(dep.applied_amount));
        if (gross > unapplied + EPSILON) errors.push(`Amount exceeds the deposit's unapplied balance (${unapplied.toFixed(2)})`);
        if (receiptCurrency !== "LKR") errors.push("Deposits can only settle LKR invoices");
        if (wht > 0) errors.push("Withholding tax does not apply to deposit applications");
        if (remainder > EPSILON) errors.push("Deposit applications cannot carry an overpayment remainder");
      }
    }

    // WHT code (customer-side withholding → AIT receivable).
    let whtMeta: { tax_code_id: string; account: string; rate: number } | null = null;
    if (wht > 0) {
      const { data: whtCode } = await admin
        .from("tax_codes")
        .select("id, code, wht_receivable_account_id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("collection_mode", "withholding_receivable")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (!whtCode?.wht_receivable_account_id) {
        errors.push("No active withholding-receivable tax code with a WHT Receivable account is configured (Settings → Tax Configuration)");
      } else {
        whtMeta = {
          tax_code_id: whtCode.id,
          account: whtCode.wht_receivable_account_id,
          rate: gross > 0 ? Math.round((wht / gross) * 10000) / 100 : 0,
        };
      }
    }

    // ── Build journal lines (BASE currency) ───────────────────────────
    const arCreditBase = round2(resolved.reduce((s, r) => s + r.amount_base, 0));
    const whtBase = round2(wht * payRate);
    const advanceBase = round2(remainder * payRate);
    const debitGrossBase = round2(gross * payRate);
    const debitNetBase = round2(debitGrossBase - whtBase);

    const lines: { account_id: string; debit: number; credit: number; customer_id?: string | null }[] = [];
    const debitAccountId = fundingDeposit ? fundingDeposit.advance_account_id : bank_account_id!;
    if (debitNetBase > 0) lines.push({ account_id: debitAccountId, debit: debitNetBase, credit: 0 });
    if (whtMeta && whtBase > 0) lines.push({ account_id: whtMeta.account, debit: whtBase, credit: 0 });
    if (arCreditBase > 0) lines.push({ account_id: arAccountId!, debit: 0, credit: arCreditBase, customer_id });
    if (advanceBase > 0) lines.push({ account_id: settings!.customer_advance_account_id!, debit: 0, credit: advanceBase });

    // Realized FX plug: cash valued at today's rate vs AR relieved at each
    // invoice's booked rate.
    const fxDelta = round2(
      lines.reduce((s, l) => s + l.debit, 0) - lines.reduce((s, l) => s + l.credit, 0),
    );
    if (Math.abs(fxDelta) > EPSILON) {
      if (!settings?.fx_gain_account_id || !settings?.fx_loss_account_id) {
        errors.push("Realized FX gain/loss accounts not configured (Settings → Account Mapping) — required for foreign-currency receipts");
      } else if (fxDelta > 0) {
        lines.push({ account_id: settings.fx_gain_account_id, debit: 0, credit: fxDelta });
      } else {
        lines.push({ account_id: settings.fx_loss_account_id, debit: -fxDelta, credit: 0 });
      }
    }

    // Validate referenced accounts (active + tenant).
    const acctIds = [...new Set(lines.map((l) => l.account_id))];
    const { data: accs } = await admin
      .from("accounts")
      .select("id, account_name, is_active, tenant_id")
      .in("id", acctIds);
    const accMap = new Map((accs || []).map((a: any) => [a.id, a]));
    for (const id of acctIds) {
      const a = accMap.get(id);
      if (!a) errors.push(`Account ${id} not found`);
      else if (a.tenant_id !== appUser.tenant_id) errors.push(`Account ${a.account_name} belongs to another tenant`);
      else if (!a.is_active) errors.push(`Account "${a.account_name}" is inactive`);
    }

    const finalDr = round2(lines.reduce((s, l) => s + l.debit, 0));
    const finalCr = round2(lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(finalDr - finalCr) > EPSILON) {
      errors.push(`Journal unbalanced: Debits=${finalDr.toFixed(2)} Credits=${finalCr.toFixed(2)}`);
    }
    if (errors.length) return json({ ok: false, error: "Cannot record receipt:\n• " + errors.join("\n• "), errors }, 200);

    // ── Create (or resume) the receipt header ─────────────────────────
    let paymentId = existing?.id as string | undefined;
    let paymentNumber = existing?.payment_number as string | undefined;
    if (!paymentId) {
      const { data: serial } = await admin.rpc("next_receipt_number", { p_tenant_id: appUser.tenant_id });
      paymentNumber = (serial as string) || undefined;
      const { data: pmt, error: pmtErr } = await admin
        .from("payments_received")
        .insert({
          tenant_id: appUser.tenant_id,
          customer_id,
          invoice_id: allocations.length === 1 ? allocations[0].invoice_id : null,
          amount: gross,
          payment_date,
          payment_method: fundingDeposit ? "deposit" : (payment_method || "bank_transfer"),
          reference: reference || null,
          bank_account_id: fundingDeposit ? null : bank_account_id,
          ar_account_id: arAccountId ?? null,
          wht_amount: wht,
          currency: receiptCurrency,
          exchange_rate: payRate,
          unapplied_amount: remainder,
          funded_by_deposit_id: fundingDeposit?.id ?? null,
          request_id,
          payment_number: paymentNumber ?? null,
          created_by: appUser.id,
          status: "posted",
        })
        .select("id, payment_number")
        .single();
      if (pmtErr) {
        // Unique request_id race: another submission won — report idempotent.
        if (pmtErr.code === "23505") {
          return json({ ok: true, message: "Already recorded (idempotent)" });
        }
        return json({ ok: false, error: `Failed to create receipt: ${pmtErr.message}` }, 200);
      }
      paymentId = pmt.id;
      paymentNumber = pmt.payment_number;
    }

    // ── JE (idempotency-guarded by the unique source index) ──────────
    const { data: je, error: jeErr } = await admin
      .from("journal_entries")
      .insert({
        tenant_id: appUser.tenant_id,
        entry_date: payment_date,
        description: `Receipt ${paymentNumber || ""} — ${customer.name}${wht > 0 ? " (customer withheld tax)" : ""}${fundingDeposit ? " (deposit applied)" : ""}`.trim(),
        reference: reference || paymentNumber || null,
        status: "draft",
        created_by: appUser.id,
        source_type: "payment_received",
        source_id: paymentId,
        is_system_generated: true,
        entry_type: "payment_received",
      })
      .select()
      .single();
    if (jeErr) {
      if (jeErr.code === "23505") {
        return json({ ok: true, message: "Already posted (idempotent)", payment_id: paymentId });
      }
      return json({ ok: false, error: `Failed to create journal: ${jeErr.message}` }, 200);
    }

    const { error: linesErr } = await admin.from("journal_lines").insert(
      lines.map((l) => ({
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
    await admin
      .from("journal_entries")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", je.id);

    // Link JE to the receipt (allowed: NULL → value transition).
    await admin.from("payments_received").update({ journal_entry_id: je.id }).eq("id", paymentId);

    // ── Allocations (append-only; unique per payment+invoice) ─────────
    if (resolved.length > 0) {
      const { error: allocErr } = await admin.from("payment_received_allocations").insert(
        resolved.map((r) => ({
          tenant_id: appUser.tenant_id,
          payment_id: paymentId,
          invoice_id: r.invoice_id,
          amount: r.amount,
          amount_base: r.amount_base,
        })),
      );
      if (allocErr && allocErr.code !== "23505") {
        console.error("Allocation insert failed:", allocErr.message);
      }
    }

    // ── AR sub-ledgers ────────────────────────────────────────────────
    const { data: arLine } = await admin
      .from("journal_lines")
      .select("id")
      .eq("journal_entry_id", je.id)
      .eq("account_id", arAccountId ?? "")
      .maybeSingle();

    for (const r of resolved) {
      await admin.from("ar_transactions").insert({
        tenant_id: appUser.tenant_id,
        customer_id,
        transaction_type: "PAYMENT",
        document_id: paymentId,
        document_ref: paymentNumber || reference || null,
        transaction_date: payment_date,
        amount: r.amount_base,
        outstanding_amount: 0,
        status: "PAID",
        journal_entry_id: je.id,
        journal_line_id: arLine?.id ?? null,
        related_transaction_id: r.ar_txn_id,
        ar_account_id: arAccountId ?? null,
      });
    }

    if (arCreditBase > 0) {
      await admin.from("ar_subledger").insert({
        tenant_id: appUser.tenant_id,
        customer_id,
        journal_id: je.id,
        journal_line_id: arLine?.id ?? null,
        debit: 0,
        credit: arCreditBase,
        amount: -arCreditBase,
        balance: -arCreditBase,
        document_type: "payment_received",
        document_id: paymentId,
      });
    }

    // ── WHT sub-ledger ────────────────────────────────────────────────
    if (whtMeta && wht > 0) {
      await admin.from("tax_transactions").insert({
        tenant_id: appUser.tenant_id,
        tax_code_id: whtMeta.tax_code_id,
        direction: "wht_receivable",
        source_type: "payment_received",
        source_id: paymentId,
        base_amount: round2(gross * payRate),
        tax_amount: whtBase,
        tax_amount_txn_currency: wht,
        currency: receiptCurrency,
        fx_rate: payRate,
        rate_applied: whtMeta.rate,
        transaction_date: payment_date,
        journal_entry_id: je.id,
      });
    }

    // ── Overpayment → customer deposit (credit on account) ────────────
    let depositId: string | null = null;
    if (remainder > EPSILON && settings?.customer_advance_account_id) {
      const { data: dep } = await admin
        .from("customer_deposits")
        .insert({
          tenant_id: appUser.tenant_id,
          customer_id,
          deposit_date: payment_date,
          amount: advanceBase,
          bank_account_id: bank_account_id ?? null,
          advance_account_id: settings.customer_advance_account_id,
          payment_method: payment_method || "bank_transfer",
          reference: reference || paymentNumber || null,
          notes: `Overpayment on receipt ${paymentNumber || paymentId}`,
          status: "unapplied",
          journal_entry_id: je.id,
          source_payment_id: paymentId,
          created_by: appUser.id,
        })
        .select("id")
        .single();
      depositId = dep?.id ?? null;
      if (depositId) {
        await admin.from("payments_received").update({ deposit_id: depositId }).eq("id", paymentId);
      }
    }

    // ── Deposit-funded: consume the funding deposit ────────────────────
    if (fundingDeposit) {
      for (const r of resolved) {
        await admin.from("deposit_applications").insert({
          tenant_id: appUser.tenant_id,
          deposit_id: fundingDeposit.id,
          invoice_id: r.invoice_id,
          amount: r.amount_base,
          applied_date: payment_date,
          journal_entry_id: je.id,
        });
      }
      const newApplied = round2(Number(fundingDeposit.applied_amount) + gross);
      await admin
        .from("customer_deposits")
        .update({
          applied_amount: newApplied,
          status: newApplied >= Number(fundingDeposit.amount) - EPSILON ? "applied" : "partially_applied",
          updated_at: new Date().toISOString(),
        })
        .eq("id", fundingDeposit.id);
    }

    await admin.from("audit_logs").insert({
      action: "Customer Receipt Posted",
      table_name: "payments_received",
      record_id: paymentId,
      user_id: appUser.id,
      tenant_id: appUser.tenant_id,
      details: {
        payment_number: paymentNumber,
        customer: customer.name,
        gross,
        currency: receiptCurrency,
        allocations: resolved.map((r) => ({ invoice: r.invoice_number, amount: r.amount })),
        wht,
        overpayment_held: remainder > EPSILON ? remainder : 0,
        funded_by_deposit: fundingDeposit?.id ?? null,
        journal_id: je.id,
      },
    });

    return json({
      ok: true,
      message: "Receipt posted",
      payment_id: paymentId,
      payment_number: paymentNumber,
      journal_id: je.id,
      allocated: allocTotal,
      held_on_account: remainder > EPSILON ? remainder : 0,
      deposit_id: depositId,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Internal error" }, 200);
  }
});
