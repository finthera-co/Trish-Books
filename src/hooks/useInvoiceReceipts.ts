import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type InvoiceReceipt = Database["public"]["Tables"]["invoice_receipts"]["Row"];

/**
 * An issued receipt is the invoice's settlement document — one per invoice,
 * enforced by a unique constraint and written only by issue_invoice_receipt().
 * Its existence is what puts the red PAID stamp under the invoice's Balance Due
 * bar (see paidStampFromReceipt).
 */

/** The receipt issued against one invoice, or null when none has been issued. */
export function useInvoiceReceipt(invoiceId?: string | null) {
  return useQuery({
    queryKey: ["invoice_receipt", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_receipts")
        .select("*")
        .eq("invoice_id", invoiceId!)
        .maybeSingle();
      if (error) throw error;
      return (data as InvoiceReceipt) ?? null;
    },
  });
}

/**
 * Every invoice id in the tenant that already carries a receipt. The list
 * screen needs the yes/no answer for many rows at once, so one set read beats
 * a query per row.
 */
export function useReceiptedInvoiceIds() {
  return useQuery({
    queryKey: ["invoice_receipts", "ids"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_receipts").select("invoice_id");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.invoice_id as string));
    },
  });
}

export interface IssueReceiptArgs {
  invoiceId: string;
  receiptDate?: string;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  receivedFrom?: string | null;
  customerAddress?: string | null;
}

/**
 * The server owns every rule here — settled-in-full, posted, one-per-invoice,
 * and the receipt number itself — so these messages just translate its codes.
 */
const ISSUE_ERRORS: Record<string, string> = {
  RECEIPT_ALREADY_ISSUED: "This invoice already has a receipt. Only one receipt can be issued per invoice.",
  INVOICE_NOT_SETTLED: "A receipt can only be issued once the invoice is paid in full.",
  INVOICE_NOT_POSTED: "Post the invoice before issuing a receipt.",
  INVOICE_NOT_FOUND: "Invoice not found.",
  FORBIDDEN: "That invoice belongs to another company.",
};

function issueErrorMessage(raw: string): string {
  for (const [code, message] of Object.entries(ISSUE_ERRORS)) {
    if (raw.includes(code)) {
      // INVOICE_NOT_SETTLED carries the outstanding figure — keep it.
      return code === "INVOICE_NOT_SETTLED"
        ? `${message} ${raw.split("INVOICE_NOT_SETTLED:")[1]?.trim() ?? ""} still outstanding.`.trim()
        : message;
    }
  }
  return raw;
}

export function useIssueInvoiceReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: IssueReceiptArgs) => {
      const { data, error } = await supabase.rpc("issue_invoice_receipt", {
        p_invoice_id: args.invoiceId,
        p_receipt_date: args.receiptDate ?? null,
        p_payment_method: args.paymentMethod ?? null,
        p_reference: args.reference ?? null,
        p_notes: args.notes ?? null,
        p_received_from: args.receivedFrom ?? null,
        p_customer_address: args.customerAddress ?? null,
      });
      if (error) throw new Error(issueErrorMessage(error.message));
      return data as unknown as InvoiceReceipt;
    },
    onSuccess: (receipt) => {
      queryClient.invalidateQueries({ queryKey: ["invoice_receipt", receipt.invoice_id] });
      queryClient.invalidateQueries({ queryKey: ["invoice_receipts"] });
      toast.success(`Receipt ${receipt.receipt_number} issued`);
    },
    onError: (e: any) => toast.error(e?.message || "Could not issue the receipt"),
  });
}
