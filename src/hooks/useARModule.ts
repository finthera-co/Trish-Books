import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { postInvoice, postPaymentReceived, postCreditNote } from "@/lib/postingEngine";

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

// ─── Create Invoice with GL Auto-Post ────────────────────
export function useCreateInvoiceWithGL() {
  const { appUser } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      customer_id: string;
      invoice_number: string;
      issue_date: string;
      due_date: string;
      total_amount: number;
      ar_account_id: string;
      revenue_account_id: string;
      items?: { description: string; quantity: number; unit_price: number; total: number }[];
    }) => {
      const tenantId = appUser!.tenant_id;

      // 1. Create invoice record first to get ID
      const { data: inv, error } = await supabase
        .from("invoices")
        .insert({
          tenant_id: tenantId,
          customer_id: params.customer_id,
          invoice_number: params.invoice_number,
          issue_date: params.issue_date,
          due_date: params.due_date,
          total_amount: params.total_amount,
          status: "sent",
          ar_account_id: params.ar_account_id,
          revenue_account_id: params.revenue_account_id,
        })
        .select()
        .single();
      if (error) throw error;

      // 2. Post via posting engine: Dr AR / Cr Revenue + AR subledger
      const result = await postInvoice({
        tenant_id: tenantId,
        invoice_id: inv.id,
        customer_id: params.customer_id,
        invoice_number: params.invoice_number,
        issue_date: params.issue_date,
        due_date: params.due_date,
        total_amount: params.total_amount,
        ar_account_id: params.ar_account_id,
        revenue_account_id: params.revenue_account_id,
      });

      // 3. Link journal entry to invoice
      await supabase
        .from("invoices")
        .update({ journal_entry_id: result.journal_entry_id })
        .eq("id", inv.id);

      // 4. Insert invoice items
      if (params.items?.length) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(
          params.items.map((item) => ({
            invoice_id: inv.id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.total,
          }))
        );
        if (itemErr) throw itemErr;
      }

      return inv;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["ar_subledger"] });
      toast.success("Invoice created and posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Receive Payment with GL Auto-Post ───────────────────
export function useReceivePaymentWithGL() {
  const { appUser } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      invoice_id: string;
      customer_id: string;
      amount: number;
      payment_date: string;
      payment_method?: string;
      reference?: string;
      bank_account_id: string;
      ar_account_id: string;
    }) => {
      const tenantId = appUser!.tenant_id;

      // 1. Record payment first to get ID
      const { data: pmt, error } = await supabase
        .from("payments_received")
        .insert({
          invoice_id: params.invoice_id,
          amount: params.amount,
          payment_date: params.payment_date,
          payment_method: params.payment_method || "bank_transfer",
          reference: params.reference || null,
          bank_account_id: params.bank_account_id,
          ar_account_id: params.ar_account_id,
        })
        .select()
        .single();
      if (error) throw error;

      // 2. Post via posting engine: Dr Bank / Cr AR + AR subledger
      const result = await postPaymentReceived({
        tenant_id: tenantId,
        payment_id: pmt.id,
        customer_id: params.customer_id,
        amount: params.amount,
        payment_date: params.payment_date,
        bank_account_id: params.bank_account_id,
        ar_account_id: params.ar_account_id,
        reference: params.reference,
        invoice_id: params.invoice_id,
      });

      // 3. Link journal entry to payment
      await supabase
        .from("payments_received")
        .update({ journal_entry_id: result.journal_entry_id })
        .eq("id", pmt.id);

      return pmt;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["payments_received"] });
      qc.invalidateQueries({ queryKey: ["ar_subledger"] });
      qc.invalidateQueries({ queryKey: ["customer_detail"] });
      toast.success("Payment received and posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Create Credit Note with GL Auto-Post ────────────────
export function useCreateCreditNoteWithGL() {
  const { appUser } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      customer_id: string;
      credit_note_number: string;
      credit_date: string;
      amount: number;
      reason?: string;
      ar_account_id: string;
      revenue_account_id: string;
      invoice_id?: string;
    }) => {
      const tenantId = appUser!.tenant_id;

      // 1. Create credit note record first
      const { data, error } = await supabase
        .from("ar_credit_notes")
        .insert({
          tenant_id: tenantId,
          customer_id: params.customer_id,
          credit_note_number: params.credit_note_number,
          credit_date: params.credit_date,
          amount: params.amount,
          reason: params.reason || null,
          status: "applied",
          ar_account_id: params.ar_account_id,
          revenue_account_id: params.revenue_account_id,
          invoice_id: params.invoice_id || null,
        })
        .select()
        .single();
      if (error) throw error;

      // 2. Post via posting engine: Dr Revenue / Cr AR + AR subledger
      const result = await postCreditNote({
        tenant_id: tenantId,
        credit_note_id: data.id,
        customer_id: params.customer_id,
        credit_note_number: params.credit_note_number,
        credit_date: params.credit_date,
        amount: params.amount,
        ar_account_id: params.ar_account_id,
        revenue_account_id: params.revenue_account_id,
      });

      // 3. Link journal entry
      await supabase
        .from("ar_credit_notes")
        .update({ journal_entry_id: result.journal_entry_id })
        .eq("id", data.id);

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["ar_credit_notes"] });
      qc.invalidateQueries({ queryKey: ["ar_subledger"] });
      qc.invalidateQueries({ queryKey: ["customer_detail"] });
      toast.success("Credit note created and posted to GL");
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
        supabase.from("invoices").select("*, payments_received(amount)").eq("customer_id", customerId!).eq("tenant_id", tid).order("issue_date", { ascending: false }),
        supabase.from("payments_received").select("*").order("payment_date", { ascending: false }),
        supabase.from("ar_credit_notes").select("*").eq("customer_id", customerId!).eq("tenant_id", tid).order("credit_date", { ascending: false }),
        supabase.from("ar_subledger").select("*").eq("customer_id", customerId!).eq("tenant_id", tid).order("created_at"),
      ]);

      if (customerRes.error) throw customerRes.error;

      // Filter payments to only those linked to this customer's invoices
      const customerInvoiceIds = new Set((invoicesRes.data || []).map((i: any) => i.id));
      const customerPayments = (paymentsRes.data || []).filter((p: any) => customerInvoiceIds.has(p.invoice_id));

      // Calculate totals from invoices for the invoices tab
      const invoices = (invoicesRes.data || []).map((inv: any) => {
        const paid = ((inv.payments_received as any[]) || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
        return { ...inv, amount_paid: paid, balance_due: Number(inv.total_amount) - paid };
      });

      return {
        customer: customerRes.data,
        invoices,
        payments: customerPayments,
        creditNotes: creditNotesRes.data || [],
        arEntries: arRes.data || [],
      };
    },
    enabled: !!customerId && !!appUser?.tenant_id,
  });
}

// ─── AR Aging Data (from ar_subledger) ───────────────────
export function useARAging() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["ar_aging", appUser?.tenant_id],
    queryFn: async () => {
      const tid = appUser!.tenant_id;

      // Get all AR subledger entries with open invoice balances
      const { data: arEntries, error: arErr } = await supabase
        .from("ar_subledger")
        .select("customer_id, document_type, document_id, debit, credit, due_date, created_at")
        .eq("tenant_id", tid);
      if (arErr) throw arErr;

      // Get customer names
      const { data: customers } = await supabase
        .from("customers")
        .select("id, name")
        .eq("tenant_id", tid);
      const custNameMap = new Map((customers || []).map((c: any) => [c.id, c.name]));

      // Calculate net balance per customer
      const customerBalanceMap = new Map<string, number>();
      for (const e of arEntries || []) {
        const prev = customerBalanceMap.get(e.customer_id) || 0;
        customerBalanceMap.set(e.customer_id, prev + Number(e.debit) - Number(e.credit));
      }

      // For aging buckets, use invoice-type entries with positive open balances
      // Group by document_id to get per-invoice balance
      const invoiceBalances = new Map<string, { customer_id: string; due_date: string | null; balance: number }>();
      for (const e of arEntries || []) {
        if (e.document_type === "invoice" || e.document_type === "opening_balance") {
          const key = e.document_id || e.customer_id;
          const existing = invoiceBalances.get(key);
          if (existing) {
            existing.balance += Number(e.debit) - Number(e.credit);
          } else {
            invoiceBalances.set(key, {
              customer_id: e.customer_id,
              due_date: e.due_date,
              balance: Number(e.debit) - Number(e.credit),
            });
          }
        } else {
          // payments/credits reduce invoices - apply to oldest doc
          // For simplicity, reduce the overall customer balance (already tracked above)
        }
      }

      const today = new Date();
      type AgingRow = { customer_id: string; customer_name: string; current: number; days_1_30: number; days_31_60: number; days_61_90: number; over_90: number; total: number };
      const customerMap = new Map<string, AgingRow>();

      // Use net customer balance and distribute across aging buckets from invoices
      for (const [custId, totalBalance] of customerBalanceMap) {
        if (totalBalance <= 0) continue;

        const custName = custNameMap.get(custId) || "Unknown";
        if (!customerMap.has(custId)) {
          customerMap.set(custId, { customer_id: custId, customer_name: custName, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0, total: totalBalance });
        }
      }

      // Distribute into aging buckets based on invoice due dates
      for (const [, inv] of invoiceBalances) {
        if (inv.balance <= 0) continue;
        const row = customerMap.get(inv.customer_id);
        if (!row) continue;

        const dueDate = inv.due_date ? new Date(inv.due_date) : new Date();
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysOverdue <= 0) row.current += inv.balance;
        else if (daysOverdue <= 30) row.days_1_30 += inv.balance;
        else if (daysOverdue <= 60) row.days_31_60 += inv.balance;
        else if (daysOverdue <= 90) row.days_61_90 += inv.balance;
        else row.over_90 += inv.balance;
      }

      return Array.from(customerMap.values()).sort((a, b) => b.total - a.total);
    },
    enabled: !!appUser?.tenant_id,
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
        .order("credit_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}
