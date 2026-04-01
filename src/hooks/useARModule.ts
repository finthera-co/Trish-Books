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

      // 1. Post journal: Dr AR / Cr Revenue
      const je = await postJournalEntry(
        tenantId,
        params.issue_date,
        `Invoice ${params.invoice_number}`,
        [
          { account_id: params.ar_account_id, debit: params.total_amount, credit: 0 },
          { account_id: params.revenue_account_id, debit: 0, credit: params.total_amount },
        ],
        "invoice",
        params.invoice_number
      );

      // 2. Create invoice record
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
          journal_entry_id: je.id,
          ar_account_id: params.ar_account_id,
          revenue_account_id: params.revenue_account_id,
        })
        .select()
        .single();
      if (error) throw error;

      // 3. Insert invoice items
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

      // 4. Create AR subledger entry
      // Get the AR journal line
      const { data: jeLines } = await supabase
        .from("journal_lines")
        .select("id")
        .eq("journal_entry_id", je.id)
        .eq("account_id", params.ar_account_id)
        .single();

      if (jeLines) {
        await supabase.from("ar_subledger").insert({
          journal_line_id: jeLines.id,
          customer_id: params.customer_id,
          amount: params.total_amount,
          tenant_id: tenantId,
          invoice_no: params.invoice_number,
          due_date: params.due_date,
        });
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

      // 1. Post journal: Dr Bank / Cr AR
      const je = await postJournalEntry(
        tenantId,
        params.payment_date,
        `Payment received - ${params.reference || ""}`,
        [
          { account_id: params.bank_account_id, debit: params.amount, credit: 0 },
          { account_id: params.ar_account_id, debit: 0, credit: params.amount },
        ],
        "payment",
        params.reference
      );

      // 2. Record payment
      const { data: pmt, error } = await supabase
        .from("payments_received")
        .insert({
          invoice_id: params.invoice_id,
          amount: params.amount,
          payment_date: params.payment_date,
          payment_method: params.payment_method || "bank_transfer",
          reference: params.reference || null,
          journal_entry_id: je.id,
          bank_account_id: params.bank_account_id,
          ar_account_id: params.ar_account_id,
        })
        .select()
        .single();
      if (error) throw error;

      // 3. AR subledger entry (credit side)
      const { data: jeLines } = await supabase
        .from("journal_lines")
        .select("id")
        .eq("journal_entry_id", je.id)
        .eq("account_id", params.ar_account_id)
        .single();

      if (jeLines) {
        await supabase.from("ar_subledger").insert({
          journal_line_id: jeLines.id,
          customer_id: params.customer_id,
          amount: -params.amount, // negative = credit to AR
          tenant_id: tenantId,
        });
      }

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

      // Post journal: Dr Revenue / Cr AR (reversal)
      const je = await postJournalEntry(
        tenantId,
        params.credit_date,
        `Credit Note ${params.credit_note_number}`,
        [
          { account_id: params.revenue_account_id, debit: params.amount, credit: 0 },
          { account_id: params.ar_account_id, debit: 0, credit: params.amount },
        ],
        "credit_note",
        params.credit_note_number
      );

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
          journal_entry_id: je.id,
          ar_account_id: params.ar_account_id,
          revenue_account_id: params.revenue_account_id,
          invoice_id: params.invoice_id || null,
        })
        .select()
        .single();
      if (error) throw error;

      // AR subledger entry
      const { data: jeLines } = await supabase
        .from("journal_lines")
        .select("id")
        .eq("journal_entry_id", je.id)
        .eq("account_id", params.ar_account_id)
        .single();

      if (jeLines) {
        await supabase.from("ar_subledger").insert({
          journal_line_id: jeLines.id,
          customer_id: params.customer_id,
          amount: -params.amount,
          tenant_id: tenantId,
        });
      }

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
        supabase.from("ar_subledger").select("*, journal_lines(journal_entry_id, debit, credit, journal_entries:journal_entry_id(entry_date, description, reference, status))").eq("customer_id", customerId!).eq("tenant_id", tid),
      ]);

      if (customerRes.error) throw customerRes.error;

      // Filter payments to only those linked to this customer's invoices
      const customerInvoiceIds = new Set((invoicesRes.data || []).map((i: any) => i.id));
      const customerPayments = (paymentsRes.data || []).filter((p: any) => customerInvoiceIds.has(p.invoice_id));

      // Calculate totals
      const invoices = (invoicesRes.data || []).map((inv: any) => {
        const paid = ((inv.payments_received as any[]) || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
        return { ...inv, amount_paid: paid, balance_due: Number(inv.total_amount) - paid };
      });

      const totalInvoiced = invoices.reduce((s: number, i: any) => s + Number(i.total_amount), 0);
      const totalPaid = customerPayments.reduce((s: number, p: any) => s + Number(p.amount), 0);
      const totalCredits = (creditNotesRes.data || []).reduce((s: number, c: any) => s + Number(c.amount), 0);
      const balance = totalInvoiced - totalPaid - totalCredits;

      return {
        customer: customerRes.data,
        invoices,
        payments: customerPayments,
        creditNotes: creditNotesRes.data || [],
        arEntries: arRes.data || [],
        summary: { totalInvoiced, totalPaid, totalCredits, balance },
      };
    },
    enabled: !!customerId && !!appUser?.tenant_id,
  });
}

// ─── AR Aging Data ───────────────────────────────────────
export function useARAging() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["ar_aging", appUser?.tenant_id],
    queryFn: async () => {
      const tid = appUser!.tenant_id;
      const { data: invoices, error } = await supabase
        .from("invoices")
        .select("*, customers(name), payments_received(amount)")
        .eq("tenant_id", tid)
        .order("due_date");
      if (error) throw error;

      const today = new Date();
      const aging: {
        customer_id: string;
        customer_name: string;
        current: number;
        days_1_30: number;
        days_31_60: number;
        days_61_90: number;
        over_90: number;
        total: number;
      }[] = [];

      const customerMap = new Map<string, typeof aging[0]>();

      for (const inv of invoices || []) {
        const paid = ((inv.payments_received as any[]) || []).reduce((s: number, p: any) => s + Number(p.amount), 0);
        const balance = Number(inv.total_amount) - paid;
        if (balance <= 0) continue;

        const dueDate = new Date(inv.due_date || inv.issue_date);
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        const custId = inv.customer_id || "unknown";
        const custName = (inv.customers as any)?.name || "Unknown";

        if (!customerMap.has(custId)) {
          customerMap.set(custId, {
            customer_id: custId,
            customer_name: custName,
            current: 0,
            days_1_30: 0,
            days_31_60: 0,
            days_61_90: 0,
            over_90: 0,
            total: 0,
          });
        }

        const row = customerMap.get(custId)!;
        row.total += balance;

        if (daysOverdue <= 0) row.current += balance;
        else if (daysOverdue <= 30) row.days_1_30 += balance;
        else if (daysOverdue <= 60) row.days_31_60 += balance;
        else if (daysOverdue <= 90) row.days_61_90 += balance;
        else row.over_90 += balance;
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
