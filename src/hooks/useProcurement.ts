import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ────────────────────────────────────────────────────────────────────────────
// Supplier Bills
// ────────────────────────────────────────────────────────────────────────────

export interface BillLineInput {
  account_id?: string | null;
  description?: string;
  sku?: string;
  product_id?: string | null;
  qty: number;
  unit_cost: number;
  tax_code_id?: string | null;
  tax_group_id?: string | null;
  is_tax_inclusive?: boolean;
  customer_id?: string | null;
  is_billable?: boolean;
  cost_center_id?: string | null;
}

export function useSupplierBills() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["supplier_bills", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_bills" as any)
        .select("*, vendor:vendors(id,name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useSupplierBill(id: string | undefined) {
  return useQuery({
    queryKey: ["supplier_bill", id],
    queryFn: async () => {
      const { data: bill, error } = await supabase
        .from("supplier_bills" as any)
        .select("*, vendor:vendors(id,name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      const { data: lines, error: le } = await supabase
        .from("supplier_bill_lines" as any)
        .select("*, customers(name)")
        .eq("bill_id", id!);
      if (le) throw le;
      return { ...(bill as any), lines: lines as any[] };
    },
    enabled: !!id,
  });
}

export function useCreateSupplierBill() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      vendor_id: string;
      bill_date: string;
      due_date?: string;
      vendor_ref?: string;
      permit_no?: string;
      tax_amount?: number;
      notes?: string;
      payment_terms?: string;
      address_block?: string;
      discount_type?: "percentage" | "fixed";
      discount_value?: number;
      shipping_amount?: number;
      shipping_account_id?: string | null;
      location_id?: string | null;
      currency?: string;
      exchange_rate?: number;
      lines: BillLineInput[];
    }) => {
      const rawSubtotal = payload.lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
      const discountValue = payload.discount_value || 0;
      const discountTotal =
        payload.discount_type === "fixed"
          ? Math.min(discountValue, rawSubtotal)
          : Math.round(rawSubtotal * (discountValue / 100) * 100) / 100;
      const subtotal = Math.round((rawSubtotal - discountTotal) * 100) / 100;
      const total = subtotal + (payload.tax_amount || 0) + (payload.shipping_amount || 0);
      const { data: bill, error } = await supabase
        .from("supplier_bills" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          vendor_id: payload.vendor_id,
          bill_date: payload.bill_date,
          due_date: payload.due_date || null,
          vendor_ref: payload.vendor_ref || null,
          permit_no: payload.permit_no || null,
          currency: payload.currency || "LKR",
          exchange_rate: payload.exchange_rate || 1,
          subtotal,
          tax_amount: payload.tax_amount || 0,
          total_amount: total,
          notes: payload.notes || null,
          payment_terms: payload.payment_terms || "net_30",
          address_block: payload.address_block || null,
          discount_type: payload.discount_type || "percentage",
          discount_value: discountValue,
          shipping_amount: payload.shipping_amount || 0,
          shipping_account_id: payload.shipping_account_id || null,
          location_id: payload.location_id || null,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const lines = payload.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        bill_id: (bill as any).id,
        account_id: l.account_id || null,
        description: l.description || null,
        qty: l.qty,
        unit_cost: l.unit_cost,
        line_total: Math.round(l.qty * l.unit_cost * 100) / 100,
        tax_code_id: l.tax_code_id || null,
        tax_group_id: l.tax_group_id || null,
        is_tax_inclusive: l.is_tax_inclusive ?? false,
        customer_id: l.customer_id || null,
        is_billable: l.is_billable ?? false,
        cost_center_id: l.cost_center_id || null,
        sku: l.sku || null,
        product_id: l.product_id || null,
      }));
      const { error: le } = await supabase.from("supplier_bill_lines" as any).insert(lines as any);
      if (le) throw le;
      return (bill as any).id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      toast.success("Bill created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateSupplierBill() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id: string;
      vendor_id: string;
      bill_date: string;
      due_date?: string;
      vendor_ref?: string;
      permit_no?: string;
      tax_amount?: number;
      notes?: string;
      payment_terms?: string;
      address_block?: string;
      discount_type?: "percentage" | "fixed";
      discount_value?: number;
      shipping_amount?: number;
      shipping_account_id?: string | null;
      location_id?: string | null;
      currency?: string;
      exchange_rate?: number;
      lines: BillLineInput[];
    }) => {
      const { data: existing, error: fetchErr } = await supabase
        .from("supplier_bills" as any)
        .select("status")
        .eq("id", payload.id)
        .single();
      if (fetchErr) throw fetchErr;
      if ((existing as any)?.status !== "draft") {
        throw new Error("Only draft bills can be edited. Void and re-enter to make changes.");
      }

      const rawSubtotal = payload.lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
      const discountValue = payload.discount_value || 0;
      const discountTotal =
        payload.discount_type === "fixed"
          ? Math.min(discountValue, rawSubtotal)
          : Math.round(rawSubtotal * (discountValue / 100) * 100) / 100;
      const subtotal = Math.round((rawSubtotal - discountTotal) * 100) / 100;
      const total = subtotal + (payload.tax_amount || 0) + (payload.shipping_amount || 0);

      const { error } = await supabase
        .from("supplier_bills" as any)
        .update({
          vendor_id: payload.vendor_id,
          bill_date: payload.bill_date,
          due_date: payload.due_date || null,
          vendor_ref: payload.vendor_ref || null,
          permit_no: payload.permit_no || null,
          currency: payload.currency || "LKR",
          exchange_rate: payload.exchange_rate || 1,
          subtotal,
          tax_amount: payload.tax_amount || 0,
          total_amount: total,
          notes: payload.notes || null,
          payment_terms: payload.payment_terms || "net_30",
          address_block: payload.address_block || null,
          discount_type: payload.discount_type || "percentage",
          discount_value: discountValue,
          shipping_amount: payload.shipping_amount || 0,
          shipping_account_id: payload.shipping_account_id || null,
          location_id: payload.location_id || null,
        } as any)
        .eq("id", payload.id);
      if (error) throw error;

      await supabase.from("supplier_bill_lines" as any).delete().eq("bill_id", payload.id);
      const lines = payload.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        bill_id: payload.id,
        account_id: l.account_id || null,
        description: l.description || null,
        qty: l.qty,
        unit_cost: l.unit_cost,
        line_total: Math.round(l.qty * l.unit_cost * 100) / 100,
        tax_code_id: l.tax_code_id || null,
        tax_group_id: l.tax_group_id || null,
        is_tax_inclusive: l.is_tax_inclusive ?? false,
        customer_id: l.customer_id || null,
        is_billable: l.is_billable ?? false,
        cost_center_id: l.cost_center_id || null,
        sku: l.sku || null,
        product_id: l.product_id || null,
      }));
      const { error: le } = await supabase.from("supplier_bill_lines" as any).insert(lines as any);
      if (le) throw le;
      return payload.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      qc.invalidateQueries({ queryKey: ["supplier_bill", id] });
      toast.success("Bill updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Duplicate-bill detection — checked client-side before save, not enforced
 * server-side (per spec: warn, don't silently block). Primary check is
 * Supplier + their invoice reference (vendor_ref, since bill_number is an
 * internally-generated sequence, not user-entered); secondary is Supplier +
 * Date + Amount.
 */
export async function checkForDuplicateBills(args: {
  tenantId: string;
  vendorId: string;
  vendorRef?: string;
  billDate: string;
  totalAmount: number;
  excludeBillId?: string;
}): Promise<any[]> {
  if (!args.vendorId) return [];
  let query = supabase
    .from("supplier_bills" as any)
    .select("id, bill_number, vendor_ref, bill_date, total_amount, status")
    .eq("tenant_id", args.tenantId)
    .eq("vendor_id", args.vendorId)
    .neq("status", "cancelled");
  if (args.excludeBillId) query = query.neq("id", args.excludeBillId);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as any[];
  return rows.filter((b) => {
    const sameRef = args.vendorRef && b.vendor_ref && b.vendor_ref.trim().toLowerCase() === args.vendorRef.trim().toLowerCase();
    const sameDateAmount = b.bill_date === args.billDate && Math.abs(Number(b.total_amount) - args.totalAmount) < 0.01;
    return sameRef || sameDateAmount;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Bill attachments — mirrors useInvoiceAttachments.ts exactly, reusing the
// same private `invoice-attachments` bucket under a /bills/ path (its RLS
// keys only on the tenant_id path segment, so no new bucket policy is needed).
// ────────────────────────────────────────────────────────────────────────────

export interface BillAttachment {
  id: string; file_name: string; file_path: string; file_url: string; content_type: string | null; size_bytes: number | null; created_at: string;
}

const BILL_ATTACHMENTS_BUCKET = "invoice-attachments";

/** Count of payments and credit notes applied against this bill — the "X linked transactions" line under the bill title. */
export function useBillLinkedTransactionsCount(billId?: string) {
  return useQuery({
    queryKey: ["bill_linked_transactions_count", billId],
    enabled: !!billId,
    queryFn: async () => {
      const [{ count: paymentCount, error: payErr }, { count: creditCount, error: crErr }] = await Promise.all([
        supabase
          .from("bill_payment_allocations" as any)
          .select("id", { count: "exact", head: true })
          .eq("bill_id", billId!),
        supabase
          .from("vendor_credit_notes" as any)
          .select("id", { count: "exact", head: true })
          .eq("bill_id", billId!),
      ]);
      if (payErr) throw payErr;
      if (crErr) throw crErr;
      return (paymentCount ?? 0) + (creditCount ?? 0);
    },
  });
}

export function useBillAttachments(billId?: string) {
  return useQuery({
    queryKey: ["bill_attachments", billId],
    enabled: !!billId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bill_attachments")
        .select("*")
        .eq("bill_id", billId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as BillAttachment[];
      return Promise.all(
        rows.map(async (row) => {
          const { data: signed } = await supabase.storage
            .from(BILL_ATTACHMENTS_BUCKET)
            .createSignedUrl(row.file_path, 3600);
          return { ...row, file_url: signed?.signedUrl ?? "" };
        })
      );
    },
  });
}

export function useUploadBillAttachment() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ billId, file }: { billId: string; file: File }) => {
      if (file.size > 10 * 1024 * 1024) throw new Error("File must be under 10 MB");
      const tenant_id = appUser!.tenant_id;
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${tenant_id}/bills/${billId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BILL_ATTACHMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from("bill_attachments" as any).insert({
        tenant_id, bill_id: billId, file_name: file.name, file_path: path, file_url: path,
        content_type: file.type, size_bytes: file.size, uploaded_by: appUser!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["bill_attachments", v.billId] });
      toast.success("Attachment uploaded");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteBillAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (att: BillAttachment & { bill_id?: string }) => {
      await supabase.storage.from(BILL_ATTACHMENTS_BUCKET).remove([att.file_path]);
      const { error } = await supabase.from("bill_attachments" as any).delete().eq("id", att.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bill_attachments"] });
      toast.success("Attachment removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
