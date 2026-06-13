import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { postBillPayment, post, type BillPaymentWht } from "@/lib/postingEngine";
import { calculateWht, type WhtRuleInput } from "@/lib/taxEngine";

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
    }) => {
      const tenantId = appUser!.tenant_id;

      // 0. WHT at settlement (AIT). Computed per PAYMENT amount with the
      //    vendor's month-to-date paid (threshold semantics live in the
      //    shared engine). Skipped when the tenant is not a WHT agent.
      const wht = await computeBillPaymentWht({
        tenantId,
        vendorId: params.vendor_id,
        amount: params.amount,
        paymentDate: params.payment_date,
        paymentNature: params.payment_nature,
        override: params.wht_override ?? null,
      });

      // 1. Insert payment record
      const { data: payment, error: pmtErr } = await supabase
        .from("bill_payments" as any)
        .insert({
          tenant_id: tenantId,
          vendor_id: params.vendor_id,
          payment_date: params.payment_date,
          amount: params.amount,
          bank_account_id: params.bank_account_id,
          ap_account_id: params.ap_account_id,
          reference: params.reference || null,
          notes: params.notes || null,
          status: "posted",
          wht_amount: wht?.amount ?? 0,
          wht_rule_id: wht?.rule_id ?? null,
          wht_certificate_no: wht?.certificate_no ?? null,
          wht_override_reason: wht?.override_reason ?? null,
          payment_nature: params.payment_nature ?? null,
        } as any)
        .select()
        .single();
      if (pmtErr) throw pmtErr;

      const pmtId = (payment as any).id as string;

      // 2. Insert allocations (trigger auto-updates amount_paid on each bill)
      if (params.allocations.length > 0) {
        const { error: allocErr } = await supabase
          .from("bill_payment_allocations" as any)
          .insert(
            params.allocations.map((a) => ({
              tenant_id: tenantId,
              payment_id: pmtId,
              bill_id: a.bill_id,
              amount_applied: a.amount_applied,
            })) as any
          );
        if (allocErr) throw allocErr;
      }

      // 3. Post GL: Dr AP (gross) / Cr Bank (net) / Cr WHT Payable
      const result = await postBillPayment({
        tenant_id: tenantId,
        payment_id: pmtId,
        vendor_id: params.vendor_id,
        amount: params.amount,
        payment_date: params.payment_date,
        bank_account_id: params.bank_account_id,
        ap_account_id: params.ap_account_id,
        reference: params.reference,
        wht,
      });

      // 4. Link journal entry to payment
      await supabase
        .from("bill_payments" as any)
        .update({ journal_entry_id: result.journal_entry_id } as any)
        .eq("id", pmtId);

      // 5. Mark fully-paid bills as 'paid' (amount_paid updated by trigger above)
      for (const alloc of params.allocations) {
        const { data: bill } = await supabase
          .from("supplier_bills" as any)
          .select("total_amount, amount_paid")
          .eq("id", alloc.bill_id)
          .single();
        if (bill && Number((bill as any).amount_paid) >= Number((bill as any).total_amount)) {
          await supabase
            .from("supplier_bills" as any)
            .update({ status: "paid" } as any)
            .eq("id", alloc.bill_id);
        }
      }

      return payment;
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      qc.invalidateQueries({ queryKey: ["vendor_detail"] });
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

      const [vendorRes, billsRes, paymentsRes, creditNotesRes, apRes] = await Promise.all([
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
      };
    },
  });
}
