import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface QuoteItemInput {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  product_id?: string | null;
  account_id?: string | null;
  discount_amount?: number;
  is_tax_inclusive?: boolean;
  tax_code_id?: string | null;
  tax_group_id?: string | null;
}

export interface CreateQuoteInput {
  customer_id: string;
  issue_date: string;
  expiry_date?: string | null;
  branch_code?: string | null;
  payment_terms: string;
  notes?: string | null;
  terms?: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  items: QuoteItemInput[];
}

export function useQuotes() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["quotes", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("quotes")
        .select("*, customers(name), quote_items(id)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

// Full estimate document: the quote with its items + customer + company header.
export function useQuoteDocument(quoteId: string | null) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["quote_document", quoteId],
    enabled: !!quoteId,
    queryFn: async () => {
      const { data: quote, error } = await (supabase as any)
        .from("quotes")
        .select("*, customers(name, legal_name, address, email, phone), quote_items(*)")
        .eq("id", quoteId)
        .single();
      if (error) throw error;
      const { data: company } = await (supabase as any)
        .from("tenants")
        .select("company_name, address, phone, tax_id, logo_url")
        .eq("id", appUser!.tenant_id)
        .maybeSingle();
      return { quote, company };
    },
  });
}

export function useCreateQuote() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateQuoteInput) => {
      const tenantId = appUser!.tenant_id;
      const { data: serial, error: serErr } = await supabase
        .rpc("next_quote_number" as any, { p_tenant_id: tenantId });
      if (serErr || !serial) throw new Error(serErr?.message || "Failed to generate quote number");

      const { items, ...header } = input;
      const { data: quote, error } = await (supabase as any)
        .from("quotes")
        .insert({
          tenant_id: tenantId,
          created_by: appUser!.id,
          quote_number: serial,
          status: "draft",
          ...header,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (items.length) {
        const { error: itemErr } = await (supabase as any)
          .from("quote_items")
          .insert(items.map((it, i) => ({
            quote_id: quote.id,
            description: it.description,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total: it.total,
            product_id: it.product_id || null,
            account_id: it.account_id || null,
            discount_amount: it.discount_amount || 0,
            is_tax_inclusive: !!it.is_tax_inclusive,
            tax_code_id: it.tax_code_id || null,
            tax_group_id: it.tax_group_id || null,
            sort_order: i,
          })));
        if (itemErr) throw itemErr;
      }
      return quote;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.success("Quote created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetQuoteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "draft" | "sent" | "accepted" | "declined" }) => {
      const { error } = await (supabase as any)
        .from("quotes")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotes"] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("quotes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.success("Quote deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * One-click conversion: clone an accepted quote into a DRAFT invoice (fresh IRD
 * serial), copy its lines, then mark the quote 'converted' and link it. The
 * invoice stays a draft so the user can review and post it.
 */
export function useConvertQuoteToInvoice() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (quoteId: string) => {
      const tenantId = appUser!.tenant_id;

      const { data: quote, error } = await (supabase as any)
        .from("quotes")
        .select("*, quote_items(*)")
        .eq("id", quoteId)
        .eq("tenant_id", tenantId)
        .single();
      if (error || !quote) throw new Error("Quote not found");
      if (quote.status === "converted" || quote.converted_invoice_id) {
        throw new Error("Quote has already been converted");
      }

      const issueDate = new Date().toISOString().slice(0, 10);
      const branchCode = (quote.branch_code || "MAIN").trim();
      const { data: serial, error: serErr } = await supabase.rpc("next_invoice_serial", {
        p_branch_code: branchCode,
        p_issue_date: issueDate,
      });
      if (serErr || !serial) throw new Error(serErr?.message || "Failed to generate invoice serial");

      // Due date = issue + the quote's term days (mirrors CreateInvoice mapping).
      const termDays: Record<string, number> = { due_on_receipt: 0, net_15: 15, net_30: 30, net_45: 45, net_60: 60 };
      const due = new Date(issueDate + "T00:00:00");
      due.setDate(due.getDate() + (termDays[quote.payment_terms] ?? 30));

      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          tenant_id: tenantId,
          customer_id: quote.customer_id,
          invoice_number: serial,
          issue_date: issueDate,
          due_date: due.toISOString().slice(0, 10),
          payment_terms: quote.payment_terms,
          date_of_supply: issueDate,
          branch_code: branchCode,
          total_amount: quote.total_amount,
          subtotal: quote.subtotal,
          tax_amount: quote.tax_amount,
          discount_amount: quote.discount_amount,
          notes: quote.notes,
          terms: quote.terms,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (invErr) throw invErr;

      const items = (quote.quote_items ?? []) as any[];
      if (items.length) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(
          items.map((it) => ({
            invoice_id: invoice.id,
            description: it.description,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total: it.total,
            product_id: it.product_id || null,
            account_id: it.account_id || null,
            discount_amount: it.discount_amount || 0,
            is_tax_inclusive: !!it.is_tax_inclusive,
            tax_code_id: it.tax_code_id || null,
            tax_group_id: it.tax_group_id || null,
          })) as any,
        );
        if (itemErr) throw itemErr;
      }

      await (supabase as any)
        .from("quotes")
        .update({ status: "converted", converted_invoice_id: invoice.id, updated_at: new Date().toISOString() })
        .eq("id", quoteId);

      return invoice as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Quote converted to draft invoice");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
