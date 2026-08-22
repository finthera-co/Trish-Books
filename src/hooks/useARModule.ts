import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Find AR / Revenue accounts ──────────────────────────
export function useARAccounts() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["ar_accounts", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type, account_subtype")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;

      const arAccounts = data.filter((a) => a.account_subtype?.toLowerCase().includes("accounts receivable"));
      const revenueAccounts = data.filter((a) => ["Income", "Other Income"].includes(a.account_type));
      const bankAccounts = data.filter((a) =>
        ["Cash on Hand", "Checking", "Savings", "Bank"].includes(a.account_subtype || "")
      );
      const expenseAccounts = data.filter((a) =>
        ["Expense", "Cost of Goods Sold"].includes(a.account_type)
      );

      return { arAccounts, revenueAccounts, bankAccounts, expenseAccounts, allAccounts: data };
    },
    enabled: !!appUser?.tenant_id,
  });
}

// Everything a receipt / credit note touches.
function invalidateARCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["invoices"] });
  qc.invalidateQueries({ queryKey: ["payments_received"] });
  qc.invalidateQueries({ queryKey: ["customer_receipts"] });
  qc.invalidateQueries({ queryKey: ["ar_subledger"] });
  qc.invalidateQueries({ queryKey: ["ar_transactions"] });
  qc.invalidateQueries({ queryKey: ["ar_credit_notes"] });
  qc.invalidateQueries({ queryKey: ["customer_detail"] });
  qc.invalidateQueries({ queryKey: ["customer_deposits"] });
  qc.invalidateQueries({ queryKey: ["journal_entries"] });
  qc.invalidateQueries({ queryKey: ["ar_aging"] });
}

// ─── Receive customer payment (server-side posting) ──────
// One receipt can settle MANY invoices. The edge function validates ownership,
// outstanding balances, closed periods, WHT and FX, and books the GL + both AR
// sub-ledgers atomically-with-resume. request_id makes double-clicks harmless.
export interface ReceiptAllocation {
  invoice_id: string;
  /** Document-currency amount applied to this invoice. */
  amount: number;
}

export function useReceiveCustomerPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      customer_id: string;
      payment_date: string; // YYYY-MM-DD
      payment_method?: string;
      reference?: string;
      bank_account_id?: string;
      ar_account_id?: string;
      allocations: ReceiptAllocation[];
      /** Overpayment kept on account as a customer deposit (requires overpayment_action="deposit"). */
      unapplied_amount?: number;
      overpayment_action?: "deposit" | "reject";
      /** Tax the customer withheld from this payment (AIT receivable). */
      wht_amount?: number;
      /** Override the payment-date FX rate for foreign-currency receipts. */
      exchange_rate?: number;
      /** Settle from an existing customer deposit instead of bank (no cash movement). */
      funded_by_deposit_id?: string;
    }) => {
      const data = await invokeEdgeFunction<{
        ok?: boolean;
        error?: string;
        payment_id: string;
        payment_number?: string;
        held_on_account?: number;
      }>("post-payment-received", {
        action: "post",
        request_id: crypto.randomUUID(),
        ...params,
      });
      if (!data?.ok) throw new Error(data?.error || "Failed to record payment");
      return data;
    },
    onSuccess: (data) => {
      invalidateARCaches(qc);
      const held = Number(data?.held_on_account || 0);
      toast.success(
        held > 0
          ? `Payment posted — ${held.toFixed(2)} held on account as a customer deposit`
          : "Payment received and posted to GL",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Void a receipt (NSF / bounced cheque / recorded in error) ─────────
export function useVoidPaymentReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { payment_id: string; reason?: string }) => {
      const data = await invokeEdgeFunction<{ ok?: boolean; error?: string }>(
        "post-payment-received",
        { action: "void", ...params },
      );
      if (!data?.ok) throw new Error(data?.error || "Failed to void receipt");
      return data;
    },
    onSuccess: () => {
      invalidateARCaches(qc);
      toast.success("Receipt voided — invoice balances restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Credit notes ─────────────────────────────────────────
export interface CreditNoteItemInput {
  description?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  is_tax_inclusive?: boolean;
  account_id?: string | null;
  product_id?: string | null;
  tax_code_id?: string | null;
  tax_group_id?: string | null;
  sort_order?: number;
}

/** Create a DRAFT credit note (+ lines). Posting happens server-side. */
export function useCreateCreditNote() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      customer_id: string;
      credit_date: string;
      reason?: string;
      invoice_id?: string | null;
      currency?: string;
      exchange_rate?: number;
      ar_account_id?: string | null;
      revenue_account_id?: string | null;
      /** Document totals (client-computed with the shared tax engine; the server recomputes and rejects drift). */
      amount: number;
      subtotal?: number;
      tax_amount?: number;
      items?: CreditNoteItemInput[];
    }) => {
      const tenantId = appUser!.tenant_id;

      const { data: serial, error: serialErr } = await supabase
        .rpc("next_credit_note_number" as any, { p_tenant_id: tenantId });
      if (serialErr || !serial) throw new Error(serialErr?.message || "Failed to generate credit-note number");

      const { data: cn, error } = await supabase
        .from("ar_credit_notes")
        .insert({
          tenant_id: tenantId,
          customer_id: params.customer_id,
          credit_note_number: serial as string,
          credit_date: params.credit_date,
          amount: params.amount,
          subtotal: params.subtotal ?? params.amount,
          tax_amount: params.tax_amount ?? 0,
          currency: params.currency || "LKR",
          exchange_rate: params.exchange_rate ?? 1,
          reason: params.reason || null,
          status: "draft",
          ar_account_id: params.ar_account_id || null,
          revenue_account_id: params.revenue_account_id || null,
          invoice_id: params.invoice_id || null,
          created_by: appUser!.id,
        } as any)
        .select()
        .single();
      if (error) throw error;

      if (params.items?.length) {
        const { error: itemErr } = await supabase.from("ar_credit_note_items" as any).insert(
          params.items.map((it, idx) => ({
            credit_note_id: cn.id,
            description: it.description || null,
            quantity: it.quantity,
            unit_price: it.unit_price,
            discount_amount: it.discount_amount ?? 0,
            is_tax_inclusive: it.is_tax_inclusive ?? false,
            account_id: it.account_id || null,
            product_id: it.product_id || null,
            tax_code_id: it.tax_code_id || null,
            tax_group_id: it.tax_group_id || null,
            sort_order: it.sort_order ?? idx,
          })),
        );
        if (itemErr) {
          // Keep drafts consistent: a header without its lines is worse than no draft.
          await supabase.from("ar_credit_notes").delete().eq("id", cn.id);
          throw itemErr;
        }
      }
      return cn;
    },
    onSuccess: () => {
      invalidateARCaches(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Post a draft credit note: server recomputes tax, reverses output VAT/SSCL,
 *  enforces approval + period guards, books the GL. */
export function usePostCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { credit_note_id: string }) => {
      const data = await invokeEdgeFunction<{ ok?: boolean; error?: string }>(
        "post-credit-note",
        { action: "post", credit_note_id: params.credit_note_id },
      );
      if (!data?.ok) throw new Error(data?.error || "Failed to post credit note");
      return data;
    },
    onSuccess: () => {
      invalidateARCaches(qc);
      toast.success("Credit note posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Back-compat convenience used by InvoiceDetails' discount flow: creates a
 *  header-only draft and immediately posts it. If the amount trips the approval
 *  threshold the draft is kept and the server's explanation is surfaced. */
export function useCreateCreditNoteWithGL() {
  const createDraft = useCreateCreditNote();
  const postNote = usePostCreditNote();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      customer_id: string;
      credit_date: string;
      amount: number;
      reason?: string;
      ar_account_id: string;
      revenue_account_id: string;
      invoice_id?: string;
    }) => {
      const cn = await createDraft.mutateAsync({
        customer_id: params.customer_id,
        credit_date: params.credit_date,
        amount: params.amount,
        reason: params.reason,
        ar_account_id: params.ar_account_id,
        revenue_account_id: params.revenue_account_id,
        invoice_id: params.invoice_id ?? null,
      });
      await postNote.mutateAsync({ credit_note_id: cn.id });
      return cn;
    },
    onSuccess: () => {
      invalidateARCaches(qc);
    },
    // Errors are already toasted by the inner mutations.
    onError: () => {},
  });
}

export function useVoidCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { credit_note_id: string; reason?: string }) => {
      const data = await invokeEdgeFunction<{ ok?: boolean; error?: string }>(
        "post-credit-note",
        { action: "void", credit_note_id: params.credit_note_id, reason: params.reason },
      );
      if (!data?.ok) throw new Error(data?.error || "Failed to void credit note");
      return data;
    },
    onSuccess: () => {
      invalidateARCaches(qc);
      toast.success("Credit note voided");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Approve or reject a pending credit note (tiered, SoD-enforced, audit-logged). */
export function useApproveCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { credit_note_id: string; decision: "approved" | "rejected"; note?: string }) => {
      const { data, error } = await supabase.rpc("approve_credit_note" as any, {
        p_credit_note_id: params.credit_note_id,
        p_decision: params.decision,
        p_note: params.note ?? null,
      });
      if (error) throw new Error(error.message);
      return data as { status: string; collected?: number; required?: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ar_credit_notes"] });
      if (data?.status === "approved") toast.success("Credit note approved");
      else if (data?.status === "rejected") toast.success("Credit note rejected");
      else toast.success(`Approval recorded (${data?.collected}/${data?.required})`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Delete a DRAFT credit note (lines cascade; posted notes must be voided). */
export function useDeleteDraftCreditNote() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { credit_note_id: string }) => {
      const { error } = await supabase
        .from("ar_credit_notes")
        .delete()
        .eq("id", params.credit_note_id)
        .eq("tenant_id", appUser!.tenant_id)
        .eq("status", "draft");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ar_credit_notes"] });
      toast.success("Draft deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Customer Detail Data ────────────────────────────────
export function useCustomerDetail(customerId: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["customer_detail", customerId],
    queryFn: async () => {
      const tid = appUser!.tenant_id;

      const [customerRes, invoicesRes, paymentsRes, creditNotesRes, arRes] = await Promise.all([
        supabase.from("customers").select("*").eq("id", customerId!).single(),
        supabase
          .from("invoices")
          .select("*, payment_received_allocations(amount, payments_received(status)), ar_credit_notes(amount, status)")
          .eq("customer_id", customerId!)
          .eq("tenant_id", tid)
          .order("issue_date", { ascending: false }),
        supabase
          .from("payments_received")
          .select("*, payment_received_allocations(invoice_id, amount)")
          .eq("customer_id", customerId!)
          .eq("tenant_id", tid)
          .order("payment_date", { ascending: false }),
        supabase.from("ar_credit_notes").select("*").eq("customer_id", customerId!).eq("tenant_id", tid).order("credit_date", { ascending: false }),
        supabase.from("ar_subledger").select("*").eq("customer_id", customerId!).eq("tenant_id", tid).order("created_at"),
      ]);

      if (customerRes.error) throw customerRes.error;

      // Per-invoice paid = non-voided receipt allocations; credits reduce what's owed.
      const invoices = (invoicesRes.data || []).map((inv: any) => {
        const paid = ((inv.payment_received_allocations as any[]) || [])
          .filter((a: any) => a.payments_received?.status !== "voided")
          .reduce((s: number, a: any) => s + Number(a.amount), 0);
        const creditTotal = ((inv.ar_credit_notes as any[]) || [])
          .filter((c: any) => c.status !== "voided")
          .reduce((s: number, c: any) => s + Number(c.amount), 0);
        return { ...inv, amount_paid: paid, credit_total: creditTotal, balance_due: Number(inv.total_amount) - paid - creditTotal };
      });

      return {
        customer: customerRes.data,
        invoices,
        payments: paymentsRes.data || [],
        creditNotes: creditNotesRes.data || [],
        arEntries: arRes.data || [],
      };
    },
    enabled: !!customerId && !!appUser?.tenant_id,
  });
}

// ─── AR Aging Data (from ar_aging_report RPC or fallback) ────────────────────
export type AgingRow = {
  customer_id: string;
  customer_name: string;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_120: number;
  over_120: number;
  total: number;
};

export type AgingTotals = {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_120: number;
  over_120: number;
  grand_total: number;
};

export type ReconciliationResult = {
  subledger_balance: number;
  gl_balance: number;
  variance: number;
  status: "RECONCILED" | "VARIANCE_DETECTED";
  as_of_date: string;
};

export function useARAging(asOfDate?: string) {
  const { appUser } = useAuth();
  const dateParam = asOfDate ?? new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["ar_aging", appUser?.tenant_id, dateParam],
    queryFn: async () => {
      // Try the DB RPC first (Phase 3 data — ar_transactions)
      const { data: rpcData, error: rpcErr } = await supabase.rpc("ar_aging_report", {
        p_as_of_date: dateParam,
      });

      if (!rpcErr && rpcData) {
        const result = rpcData as { rows: AgingRow[]; totals: AgingTotals };
        return { rows: result.rows ?? [], totals: result.totals };
      }

      // Fallback: client-side from ar_subledger (Phase 1/2 data)
      const tid = appUser!.tenant_id;
      const { data: arEntries } = await supabase
        .from("ar_subledger")
        .select("customer_id, document_type, document_id, debit, credit, due_date, created_at")
        .eq("tenant_id", tid);

      const { data: customers } = await supabase
        .from("customers")
        .select("id, name")
        .eq("tenant_id", tid);
      const custNameMap = new Map((customers || []).map((c: any) => [c.id, c.name]));

      const customerBalanceMap = new Map<string, number>();
      for (const e of arEntries || []) {
        const prev = customerBalanceMap.get(e.customer_id) || 0;
        customerBalanceMap.set(e.customer_id, prev + Number(e.debit) - Number(e.credit));
      }

      const invoiceBalances = new Map<string, { customer_id: string; due_date: string | null; balance: number }>();
      for (const e of arEntries || []) {
        if (e.document_type === "invoice" || e.document_type === "opening_balance") {
          const key = e.document_id || e.customer_id;
          const existing = invoiceBalances.get(key);
          if (existing) existing.balance += Number(e.debit) - Number(e.credit);
          else invoiceBalances.set(key, { customer_id: e.customer_id, due_date: e.due_date, balance: Number(e.debit) - Number(e.credit) });
        }
      }

      const today = new Date(dateParam);
      const fallbackRows = new Map<string, AgingRow>();

      for (const [custId, totalBalance] of customerBalanceMap) {
        if (totalBalance <= 0) continue;
        const custName = custNameMap.get(custId) || "Unknown";
        if (!fallbackRows.has(custId)) {
          fallbackRows.set(custId, { customer_id: custId, customer_name: custName, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, over_120: 0, total: totalBalance });
        }
      }

      for (const [, inv] of invoiceBalances) {
        if (inv.balance <= 0) continue;
        const row = fallbackRows.get(inv.customer_id);
        if (!row) continue;
        const dueDate = inv.due_date ? new Date(inv.due_date) : today;
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOverdue <= 0)         row.current      += inv.balance;
        else if (daysOverdue <= 30)   row.days_1_30    += inv.balance;
        else if (daysOverdue <= 60)   row.days_31_60   += inv.balance;
        else if (daysOverdue <= 90)   row.days_61_90   += inv.balance;
        else if (daysOverdue <= 120)  row.days_91_120  += inv.balance;
        else                          row.over_120     += inv.balance;
      }

      const rows = Array.from(fallbackRows.values()).sort((a, b) => b.total - a.total);
      const totals: AgingTotals = rows.reduce(
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

// ─── AR Reconciliation ────────────────────────────────────────────────────────
export function useARReconciliation(asOfDate?: string) {
  const { appUser } = useAuth();
  const dateParam = asOfDate ?? new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["ar_reconciliation", appUser?.tenant_id, dateParam],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ar_reconciliation_check", {
        p_as_of_date: dateParam,
      });
      if (error) throw error;
      return data as ReconciliationResult;
    },
    enabled: !!appUser?.tenant_id,
  });
}

// ─── Customer Accounts ───────────────────────────────────────────────────────
export function useCustomerAccount(customerId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["customer_accounts", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_accounts")
        .select("*")
        .eq("customer_id", customerId!)
        .eq("tenant_id", appUser!.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!customerId && !!appUser?.tenant_id,
  });
}

// ─── AR Transactions for a customer ─────────────────────────────────────────
export function useARTransactions(customerId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["ar_transactions", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ar_transactions")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("customer_id", customerId!)
        .order("transaction_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!customerId && !!appUser?.tenant_id,
  });
}

// ─── Credit Notes list ───────────────────────────────────
export function useCreditNotes() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["ar_credit_notes", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ar_credit_notes")
        .select("*, customers(name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

// ─── Receipts list (payments across the tenant, allocation-aware) ────────────
export function useCustomerReceipts(customerId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["customer_receipts", appUser?.tenant_id, customerId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("payments_received")
        .select("*, customers(name), payment_received_allocations(invoice_id, amount, invoices(invoice_number))")
        .eq("tenant_id", appUser!.tenant_id)
        .order("payment_date", { ascending: false })
        .limit(200);
      if (customerId) q = q.eq("customer_id", customerId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!appUser?.tenant_id,
  });
}
