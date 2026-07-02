import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getInvoiceVectorPdfFile } from "@/lib/invoicePdf";
import { toast } from "sonner";

/** Encode a File's bytes as base64 in chunks (avoids call-stack overflow on big PDFs). */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface SendInvoiceEmailArgs {
  invoiceId: string;
  tenantId: string;
  invoiceNumber: string;
  recipient: string;
  subject?: string;
  message?: string;
}

/**
 * Generates the invoice PDF client-side, then sends it through the
 * send-invoice-email edge function (Resend) with delivery tracking.
 */
export function useSendInvoiceEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: SendInvoiceEmailArgs) => {
      const file = await getInvoiceVectorPdfFile(args.invoiceId, args.tenantId);
      const pdf_base64 = await fileToBase64(file);

      const { data, error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          invoice_id: args.invoiceId,
          recipient: args.recipient,
          subject: args.subject,
          message: args.message,
          pdf_base64,
          pdf_filename: `Invoice-${args.invoiceNumber}.pdf`,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Failed to send invoice email");
      return data;
    },
    onSuccess: (_d, args) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice_emails", args.invoiceId] });
      toast.success("Invoice emailed");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to send invoice email"),
  });
}
