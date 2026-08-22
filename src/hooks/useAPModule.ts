import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { post, type BillPaymentWht } from "@/lib/postingEngine";
import { calculateWht, type WhtRuleInput } from "@/lib/taxEngine";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Settlement-based AIT computation for a bill payment. Pure data assembly
 * around the shared engine: vendor attributes + effective wht_rules +
 * month-to-date paid drive the threshold semantics. Returns null when no
 * WHT applies (tenant not a WHT agent, vendor exempt, below threshold...).
 * Exported so the payment dialog can preview the exact posting amounts.
 */
export async function computeBillPaymentWht(args: {
  tenantId: string;
  vendorId: string;
  amount: number;
  paymentDate: string;
  paymentNature?: string;
  override?: { amount: number; reason: string } | null;
}): Promise<BillPaymentWht | null> {
  const { data: profile } = await supabase
    .from("tenant_tax_profiles" as any)
    .select("wht_agent")
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (profile && !(profile as any).wht_agent) return null;

  const { data: vendor } = await supabase
    .from("vendors")
    .select("payee_type, default_payment_nature, wht_exempt")
    .eq("id", args.vendorId)
    .single();
  if (!vendor) return null;

  const { data: ruleRows } = await supabase
    .from("wht_rules" as any)
    .select("*, tax_codes(id, code, wht_payable_account_id)")
    .eq("tenant_id", args.tenantId);
  const rules: WhtRuleInput[] = ((ruleRows as any[]) || []).map((r) => ({
    id: r.id,
    taxCodeId: r.tax_code_id,
    paymentNature: r.payment_nature,
    payeeType: r.payee_type,
    rate: Number(r.rate),
    thresholdAmount: r.threshold_amount === null ? null : Number(r.threshold_amount),
    thresholdPeriod: r.threshold_period,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    certificateRequired: r.certificate_required,
  }));

  // Month-to-date paid to this vendor (settlement basis, excludes this payment)
  const monthStart = args.paymentDate.slice(0, 8) + "01";
  const { data: mtdRows } = await supabase
    .from("bill_payments" as any)
    .select("amount")
    .eq("tenant_id", args.tenantId)
    .eq("vendor_id", args.vendorId)
    .eq("status", "posted")
    .gte("payment_date", monthStart)
    .lte("payment_date", args.paymentDate);
  const monthToDatePaid = ((mtdRows as any[]) || []).reduce((s, r) => s + Number(r.amount), 0);

  const computed = calculateWht(
    args.amount,
    {
      payeeType: (vendor as any).payee_type,
      defaultPaymentNature: (vendor as any).default_payment_nature,
      whtExempt: !!(vendor as any).wht_exempt,
    },
    rules,
    args.paymentDate,
    monthToDatePaid,
    args.paymentNature
  );
  if (!computed && !args.override) return null;

  const ruleRow = computed
    ? ((ruleRows as any[]) || []).find((r) => r.id === computed.ruleId)
    : ((ruleRows as any[]) || []).find((r) => r.tax_codes?.wht_payable_account_id);
  const whtAccount = ruleRow?.tax_codes?.wht_payable_account_id as string | undefined;
  const taxCodeId = (computed?.taxCodeId ?? ruleRow?.tax_code_id) as string | undefined;
  const finalAmount = args.override ? args.override.amount : computed!.whtAmount;
  if (!finalAmount || finalAmount <= 0) return null;
  if (!whtAccount || !taxCodeId) {
    throw new Error("WHT applies to this payment but the WHT tax code has no WHT Payable account mapped (Settings → Tax Configuration)");
  }

  let certificateNo: string | null = null;
  if (ruleRow?.certificate_required !== false) {
    const { data: cert } = await supabase.rpc("generate_wht_certificate_no" as any, {
      p_tenant_id: args.tenantId,
    });
    certificateNo = (cert as any) ?? null;
  }

  return {
    amount: finalAmount,
    base_amount: computed?.taxableAmount ?? args.amount,
    rate: computed?.rate ?? (ruleRow ? Number(ruleRow.rate) : 0),
    tax_code_id: taxCodeId,
    wht_payable_account_id: whtAccount,
    rule_id: computed?.ruleId ?? ruleRow?.id ?? null,
    certificate_no: certificateNo,
    override_reason: args.override?.reason,
  };
}

export type APAgingRow = {
  vendor_id: string;
  vendor_name: string;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_120: number;
  over_120: number;
  total: number;
};

export type APAgingTotals = {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_120: number;
  over_120: number;
  grand_total: number;
};

export type APReconciliationResult = {
  subledger_balance: number;
  gl_balance: number;
  variance: number;
  status: "RECONCILED" | "VARIANCE_DETECTED";
  as_of_date: string;
};

export function useAPAging(asOfDate?: string) {
  const { appUser } = useAuth();
  const dateParam = asOfDate ?? new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["ap_aging", appUser?.tenant_id, dateParam],
    queryFn: async () => {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("ap_aging_report", {
        p_as_of_date: dateParam,
      });

      if (!rpcErr && rpcData) {
        const result = rpcData as { rows: APAgingRow[]; totals: APAgingTotals };
        return { rows: result.rows ?? [], totals: result.totals };
      }

      // Fallback: client-side from ap_subledger
      const tid = appUser!.tenant_id;
      const { data: apEntries } = await supabase
        .from("ap_subledger")
        .select("vendor_id, document_type, document_id, debit, credit, due_date, created_at, tenant_id")
        .eq("tenant_id", tid);

      const { data: vendors } = await supabase
        .from("vendors")
        .select("id, name")
        .eq("tenant_id", tid);
      const vendorNameMap = new Map((vendors || []).map((v: any) => [v.id, v.name]));

      const invoiceBalances = new Map<string, { vendor_id: string; due_date: string | null; balance: number }>();
      for (const e of apEntries || []) {
        if (e.document_type === "bill" || e.document_type === "opening_balance") {
          const key = e.document_id || e.vendor_id;
          const existing = invoiceBalances.get(key);
          const delta = Number(e.credit ?? 0) - Number(e.debit ?? 0);
          if (existing) existing.balance += delta;
          else invoiceBalances.set(key, { vendor_id: e.vendor_id, due_date: e.due_date, balance: delta });
        }
      }

      const today = new Date(dateParam);
      const fallbackRows = new Map<string, APAgingRow>();

      for (const [, inv] of invoiceBalances) {
        if (inv.balance <= 0) continue;
        const vid = inv.vendor_id;
        if (!fallbackRows.has(vid)) {
          fallbackRows.set(vid, {
            vendor_id: vid,
            vendor_name: vendorNameMap.get(vid) || "Unknown",
            current: 0, days_1_30: 0, days_31_60: 0,
            days_61_90: 0, days_91_120: 0, over_120: 0, total: 0,
          });
        }
        const row = fallbackRows.get(vid)!;
        const dueDate = inv.due_date ? new Date(inv.due_date) : today;
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOverdue <= 0)        row.current      += inv.balance;
        else if (daysOverdue <= 30)  row.days_1_30    += inv.balance;
        else if (daysOverdue <= 60)  row.days_31_60   += inv.balance;
        else if (daysOverdue <= 90)  row.days_61_90   += inv.balance;
        else if (daysOverdue <= 120) row.days_91_120  += inv.balance;
        else                         row.over_120     += inv.balance;
        row.total += inv.balance;
      }

      const rows = Array.from(fallbackRows.values()).sort((a, b) => b.total - a.total);
      const totals: APAgingTotals = rows.reduce(
        (acc, r) => ({
          current:     acc.current     + r.current,
          days_1_30:   acc.days_1_30   + r.days_1_30,
          days_31_60:  acc.days_31_60  + r.days_31_60,
          days_61_90:  acc.days_61_90  + r.days_61_90,
          days_91_120: acc.days_91_120 + r.days_91_120,
          over_120:    acc.over_120    + r.over_120,
          grand_total: acc.grand_total + r.total,
        }),
        { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, over_120: 0, grand_total: 0 }
      );
      return { rows, totals };
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useAPReconciliation(asOfDate?: string) {
  const { appUser } = useAuth();
  const dateParam = asOfDate ?? new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["ap_reconciliation", appUser?.tenant_id, dateParam],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ap_reconciliation_check", {
        p_as_of_date: dateParam,
      });
      if (error) throw error;
      return data as APReconciliationResult;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useSupplierAccount(vendorId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["supplier_accounts", vendorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_accounts")
        .select("*")
        .eq("vendor_id", vendorId!)
        .eq("tenant_id", appUser!.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!vendorId && !!appUser?.tenant_id,
  });
}

export function useAPTransactions(vendorId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["ap_transactions", vendorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ap_transactions")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("vendor_id", vendorId!)
        .order("transaction_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!vendorId && !!appUser?.tenant_id,
  });
}

// ─── Supplier Bills for a vendor ─────────────────────────
export function useSupplierBillsForVendor(vendorId: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["supplier_bills", "vendor", vendorId, appUser?.tenant_id],
    enabled: !!vendorId && !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_bills" as any)
        .select("*, supplier_bill_lines(*)")
        .eq("vendor_id", vendorId!)
        .eq("tenant_id", appUser!.tenant_id)
        .order("bill_date", { ascending: false });
      if (error) throw error;
      return ((data as any[]) ?? []).map((bill) => ({
        ...bill,
        amount_paid: Number(bill.amount_paid ?? 0),
        balance_due: Number(bill.total_amount) - Number(bill.amount_paid ?? 0),
      }));
    },
  });
}

// ─── Record a bill payment ────────────────────────────────
export function useRecordBillPayment() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      vendor_id: string;
      payment_date: string;
      amount: number;
      bank_account_id: string;
      ap_account_id: string;
      reference?: string;
      notes?: string;
      allocations: { bill_id: string; amount_applied: number }[];
      payment_nature?: string;
      /** Manual WHT override — requires a reason, audited in the sub-ledger. */
      wht_override?: { amount: number; reason: string } | null;
      payment_method: string;
      /** Cheque only: queue for batch printing instead of assigning a number now. */
      print_later?: boolean;
      check_number?: string | null;
    }) => {
      const tenantId = appUser!.tenant_id;

      // 0a. Resolve the currency this payment settles in from the bills being
      //     paid — a single payment run must be one currency (mirrors AR's
      //     payments_received, which is also one currency per receipt).
      const billIds = params.allocations.map((a) => a.bill_id);
      const { data: billRows, error: billErr } = await supabase
        .from("supplier_bills" as any)
        .select("id, currency, exchange_rate")
        .in("id", billIds);
      if (billErr) throw billErr;
      const billMap = new Map((billRows ?? []).map((b: any) => [b.id, b]));
      const currencies = new Set((billRows ?? []).map((b: any) => b.currency || "LKR"));
      if (currencies.size > 1) {
        throw new Error("All bills in one payment run must share the same currency.");
      }
      const currency = currencies.size > 0 ? [...currencies][0] : "LKR";
      const isForeign = currency !== "LKR";

      // 0b. WHT at settlement (AIT) — LKR only. Withholding tax is a domestic
      //     SL concept; combining it with FX conversion is out of scope here.
      const wht = isForeign
        ? null
        : await computeBillPaymentWht({
            tenantId,
            vendorId: params.vendor_id,
            amount: params.amount,
            paymentDate: params.payment_date,
            paymentNature: params.payment_nature,
            override: params.wht_override ?? null,
          });

      // 0c. Foreign-currency settlement rate + FX accounts, and the AP relief
      //     amount in base (each bill's OWN exchange_rate, not today's rate).
      let fx: { net_bank_base: number; fx_gain_account_id: string; fx_loss_account_id: string } | null = null;
      let apReliefBase = params.amount;
      if (isForeign) {
        const { data: rateData, error: rateErr } = await supabase.rpc("fx_rate" as any, {
          p_tenant_id: tenantId,
          p_currency: currency,
          p_date: params.payment_date,
        });
        if (rateErr) throw rateErr;
        const settlementRate = Number(rateData) || 1;

        const { data: settingsRow, error: settingsErr } = await supabase
          .from("account_settings")
          .select("fx_gain_account_id, fx_loss_account_id")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (settingsErr) throw settingsErr;
        if (!settingsRow?.fx_gain_account_id || !settingsRow?.fx_loss_account_id) {
          throw new Error("FX Gain/Loss accounts are not configured (Settings → Account Mapping) — required to pay a foreign-currency bill.");
        }

        apReliefBase = round2(
          params.allocations.reduce((s, a) => {
            const bill = billMap.get(a.bill_id) as any;
            return s + a.amount_applied * Number(bill?.exchange_rate ?? 1);
          }, 0),
        );
        fx = {
          net_bank_base: round2(params.amount * settlementRate),
          fx_gain_account_id: settingsRow.fx_gain_account_id,
          fx_loss_account_id: settingsRow.fx_loss_account_id,
        };
      }

      // 1. Atomic write: payment + allocations + journal entry + AP subledger
      //    + WHT/FX + bill status, all inside one DB transaction. Previously
      //    this was five separate client-side writes with no rollback — a
      //    failure partway through (e.g. the GL post step) could leave a
      //    bill_payments row + allocations committed, and the bill's
      //    amount_paid already reduced, with no journal entry ever created.
      //    The RPC also takes row locks on the bills being paid, so two
      //    concurrent payments can't jointly over-allocate the same bill —
      //    the client-side balance_due check alone couldn't guarantee that.
      const { data: result, error: rpcErr } = await supabase.rpc("record_bill_payment" as any, {
        p_vendor_id: params.vendor_id,
        p_payment_date: params.payment_date,
        p_amount: params.amount,
        p_bank_account_id: params.bank_account_id,
        p_ap_account_id: params.ap_account_id,
        p_allocations: params.allocations,
        p_reference: params.reference || null,
        p_notes: params.notes || null,
        p_payment_nature: params.payment_nature || null,
        p_wht: wht ?? null,
        p_payment_method: params.payment_method,
        p_print_later: params.print_later ?? false,
        p_check_number: params.print_later ? null : (params.check_number || null),
        p_currency: currency,
        p_ap_amount_base: apReliefBase,
        p_fx: fx,
      });
      if (rpcErr) throw rpcErr;

      return result as { payment_id: string; journal_entry_id: string; wht_certificate_no: string | null; net_bank_amount: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["bill_payments"] });
      qc.invalidateQueries({ queryKey: ["vendor_detail"] });
      toast.success("Payment recorded and posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Void a posted bill (requires amount_paid = 0) ────────
export function useVoidSupplierBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bill_id, reason }: { bill_id: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("void_supplier_bill" as any, {
        p_bill_id: bill_id,
        p_reason: reason || null,
      });
      if (error) throw error;
      return data as { ok: boolean; reversal_journal_id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendor_detail"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Bill voided");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Void a posted bill payment (restores bill balances) ──
export function useVoidBillPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ payment_id, reason }: { payment_id: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("void_bill_payment" as any, {
        p_payment_id: payment_id,
        p_reason: reason || null,
      });
      if (error) throw error;
      return data as { ok: boolean; reversal_journal_id: string; bills_restored: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["bill_payments"] });
      qc.invalidateQueries({ queryKey: ["vendor_detail"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Payment voided");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Vendor credit notes ──────────────────────────────────
export function useVendorCreditNotes(vendorId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["vendor_credit_notes", appUser?.tenant_id, vendorId ?? "all"],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      let q = supabase
        .from("vendor_credit_notes" as any)
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("credit_date", { ascending: false });
      if (vendorId) q = (q as any).eq("vendor_id", vendorId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });
}

// ─── Create vendor credit note ────────────────────────────
export function useCreateVendorCreditNote() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      vendor_id: string;
      credit_note_number: string;
      credit_date: string;
      amount: number;
      reason?: string;
      expense_account_id: string;
      ap_account_id: string;
      bill_id?: string;
    }) => {
      const tenantId = appUser!.tenant_id;

      // 1. Insert credit note record
      const { data: cn, error: cnErr } = await supabase
        .from("vendor_credit_notes" as any)
        .insert({
          tenant_id: tenantId,
          vendor_id: params.vendor_id,
          credit_note_number: params.credit_note_number,
          credit_date: params.credit_date,
          amount: params.amount,
          reason: params.reason || null,
          expense_account_id: params.expense_account_id,
          ap_account_id: params.ap_account_id,
          bill_id: params.bill_id || null,
          status: "draft",
        } as any)
        .select()
        .single();
      if (cnErr) throw cnErr;

      const cnId = (cn as any).id as string;

      // 2. Post GL: Dr AP / Cr Expense (reduces liability and reverses expense)
      const result = await post({
        tenant_id: tenantId,
        entry_date: params.credit_date,
        description: `Vendor Credit Note ${params.credit_note_number}`,
        source_type: "vendor_credit",
        source_id: cnId,
        reference: params.credit_note_number,
        lines: [
          { account_id: params.ap_account_id, debit: params.amount, credit: 0, vendor_id: params.vendor_id },
          { account_id: params.expense_account_id, debit: 0, credit: params.amount },
        ],
        subledger_entries: [
          {
            type: "ap",
            entity_id: params.vendor_id,
            document_type: "vendor_credit",
            document_id: cnId,
            debit: params.amount,
            credit: 0,
          },
        ],
      });

      // 3. Update status and link journal entry
      await supabase
        .from("vendor_credit_notes" as any)
        .update({ status: "posted", journal_entry_id: result.journal_entry_id } as any)
        .eq("id", cnId);

      return cn;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor_credit_notes"] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendor_detail"] });
      toast.success("Credit note created and posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Vendor refunds (cash received back from a vendor) ────
export function useRecordVendorRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      vendor_id: string;
      refund_date: string;
      amount: number;
      bank_account_id: string;
      ap_account_id: string;
      reference?: string;
      memo?: string;
      credit_note_id?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("record_vendor_refund" as any, {
        p_vendor_id: params.vendor_id,
        p_refund_date: params.refund_date,
        p_amount: params.amount,
        p_bank_account_id: params.bank_account_id,
        p_ap_account_id: params.ap_account_id,
        p_reference: params.reference || null,
        p_memo: params.memo || null,
        p_credit_note_id: params.credit_note_id || null,
      });
      if (error) throw error;
      return data as { ok: boolean; refund_id: string; journal_entry_id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor_refunds"] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendor_detail"] });
      toast.success("Vendor refund recorded and posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useVoidVendorRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ refund_id, reason }: { refund_id: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("void_vendor_refund" as any, {
        p_refund_id: refund_id,
        p_reason: reason || null,
      });
      if (error) throw error;
      return data as { ok: boolean; reversal_journal_id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor_refunds"] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendor_detail"] });
      toast.success("Refund voided");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Post a draft supplier bill ───────────────────────────
export function usePostSupplierBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (billId: string) => {
      const { data, error } = await supabase.rpc("post_supplier_bill" as any, {
        p_bill_id: billId,
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_data, billId) => {
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      qc.invalidateQueries({ queryKey: ["supplier_bill", billId] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      qc.invalidateQueries({ queryKey: ["vendor_detail"] });
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      toast.success("Bill posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Vendor detail (parallel fetch) ──────────────────────
export function useVendorDetail(vendorId: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["vendor_detail", vendorId, appUser?.tenant_id],
    enabled: !!vendorId && !!appUser?.tenant_id,
    queryFn: async () => {
      const tid = appUser!.tenant_id;

      const [vendorRes, billsRes, paymentsRes, creditNotesRes, apRes, refundsRes] = await Promise.all([
        supabase.from("vendors").select("*").eq("id", vendorId!).single(),
        supabase
          .from("supplier_bills" as any)
          .select("*")
          .eq("vendor_id", vendorId!)
          .eq("tenant_id", tid)
          .order("bill_date", { ascending: false }),
        supabase
          .from("bill_payments" as any)
          .select("*")
          .eq("vendor_id", vendorId!)
          .eq("tenant_id", tid)
          .order("payment_date", { ascending: false }),
        supabase
          .from("vendor_credit_notes" as any)
          .select("*")
          .eq("vendor_id", vendorId!)
          .eq("tenant_id", tid)
          .order("credit_date", { ascending: false }),
        supabase
          .from("ap_subledger")
          .select("*")
          .eq("vendor_id", vendorId!)
          .eq("tenant_id", tid)
          .order("created_at"),
        supabase
          .from("vendor_refunds" as any)
          .select("*")
          .eq("vendor_id", vendorId!)
          .eq("tenant_id", tid)
          .order("refund_date", { ascending: false }),
      ]);

      if (vendorRes.error) throw vendorRes.error;

      const bills = ((billsRes.data as any[]) ?? []).map((b) => ({
        ...b,
        amount_paid: Number(b.amount_paid ?? 0),
        balance_due: Number(b.total_amount) - Number(b.amount_paid ?? 0),
      }));

      return {
        vendor: vendorRes.data,
        bills,
        payments: (paymentsRes.data as any[]) ?? [],
        creditNotes: (creditNotesRes.data as any[]) ?? [],
        apEntries: apRes.data ?? [],
        refunds: (refundsRes.data as any[]) ?? [],
      };
    },
  });
}
