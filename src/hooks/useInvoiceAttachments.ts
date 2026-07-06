import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface InvoiceAttachment {
  id: string; file_name: string; file_path: string; file_url: string; content_type: string | null; size_bytes: number | null; created_at: string;
}

const ATTACHMENTS_BUCKET = "invoice-attachments";

export function useInvoiceAttachments(invoiceId?: string) {
  return useQuery({
    queryKey: ["invoice_attachments", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("invoice_attachments")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as InvoiceAttachment[];
      // The bucket is private, so mint short-lived signed URLs for display.
      return Promise.all(
        rows.map(async (row) => {
          const { data: signed } = await supabase.storage
            .from(ATTACHMENTS_BUCKET)
            .createSignedUrl(row.file_path, 3600);
          return { ...row, file_url: signed?.signedUrl ?? "" };
        })
      );
    },
  });
}

export function useUploadAttachment() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, file }: { invoiceId: string; file: File }) => {
      if (file.size > 10 * 1024 * 1024) throw new Error("File must be under 10 MB");
      const tenant_id = appUser!.tenant_id;
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${tenant_id}/invoices/${invoiceId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      // Private bucket: no public URL is stored. file_url is derived as a signed
      // URL on read; we persist the object path (file_url is NOT NULL).
      const { error } = await (supabase as any).from("invoice_attachments").insert({
        tenant_id, invoice_id: invoiceId, file_name: file.name, file_path: path, file_url: path,
        content_type: file.type, size_bytes: file.size, uploaded_by: appUser!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["invoice_attachments", v.invoiceId] });
      toast.success("Attachment uploaded");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (att: InvoiceAttachment & { invoice_id?: string }) => {
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([att.file_path]);
      const { error } = await (supabase as any).from("invoice_attachments").delete().eq("id", att.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice_attachments"] });
      toast.success("Attachment removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
