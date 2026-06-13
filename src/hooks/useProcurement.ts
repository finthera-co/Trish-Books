import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ────────────────────────────────────────────────────────────────────────────
// Inventory Master (extended)
// ────────────────────────────────────────────────────────────────────────────

export interface InventoryItemMaster {
  id: string;
  tenant_id: string;
  item_code: string | null;
  item_name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  sub_category: string | null;
  uom_primary: string | null;
  uom_secondary: string | null;
  uom_conversion_factor: number | null;
  valuation_method: "weighted_average" | "fifo" | "lifo";
  reorder_level: number | null;
  reorder_quantity: number | null;
  max_stock_level: number | null;
  standard_cost: number | null;
  last_purchase_price: number | null;
  selling_price: number | null;
  unit_cost: number;
  quantity_on_hand: number;
  account_id: string | null;
  cogs_account_id: string | null;
  purchase_account_id: string | null;
  purchase_return_account_id: string | null;
  sales_return_account_id: string | null;
  adjustment_account_id: string | null;
  tax_id: string | null;
  default_purchase_tax_code_id: string | null;
  default_purchase_tax_group_id: string | null;
  is_active: boolean;
  notes: string | null;
}

export function useInventoryMaster() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inventory_master", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("item_name");
      if (error) throw error;
      return data as unknown as InventoryItemMaster[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useUpsertInventoryItem() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<InventoryItemMaster> & { item_name: string }) => {
      const row = { ...payload, tenant_id: appUser!.tenant_id } as any;
      if (row.id) {
        const { id, ...rest } = row;
        const { error } = await supabase.from("inventory_items").update(rest).eq("id", id);
        if (error) throw error;
        return id as string;
      }
      const { data, error } = await supabase.from("inventory_items").insert(row).select("id").single();
      if (error) throw error;
      return data!.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_master"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      toast.success("Item saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Purchase Orders
// ────────────────────────────────────────────────────────────────────────────

export interface POLineInput {
  item_id: string;
  description?: string;
  qty_ordered: number;
  unit_cost: number;
  tax_code_id?: string | null;
  tax_group_id?: string | null;
  is_tax_inclusive?: boolean;
}

export function usePurchaseOrders() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["purchase_orders", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders" as any)
        .select("*, vendor:vendors(id,name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function usePurchaseOrder(id: string | undefined) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["purchase_order", id],
    queryFn: async () => {
      const { data: po, error } = await supabase
        .from("purchase_orders" as any)
        .select("*, vendor:vendors(id,name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      const { data: lines, error: le } = await supabase
        .from("purchase_order_lines" as any)
        .select("*, item:inventory_items(id,item_name,item_code,uom_primary)")
        .eq("po_id", id!);
      if (le) throw le;
      return { ...(po as any), lines: lines as any[] };
    },
    enabled: !!id && !!appUser?.tenant_id,
  });
}

export function useCreatePurchaseOrder() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      vendor_id: string;
      order_date: string;
      expected_date?: string;
      notes?: string;
      lines: POLineInput[];
    }) => {
      const subtotal = payload.lines.reduce((s, l) => s + l.qty_ordered * l.unit_cost, 0);
      const { data: po, error } = await supabase
        .from("purchase_orders" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          vendor_id: payload.vendor_id,
          order_date: payload.order_date,
          expected_date: payload.expected_date || null,
          notes: payload.notes || null,
          subtotal,
          tax_amount: 0,
          total_amount: subtotal,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const lines = payload.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        po_id: (po as any).id,
        item_id: l.item_id,
        description: l.description || null,
        qty_ordered: l.qty_ordered,
        unit_cost: l.unit_cost,
        line_total: Math.round(l.qty_ordered * l.unit_cost * 100) / 100,
        tax_code_id: l.tax_code_id || null,
        tax_group_id: l.tax_group_id || null,
        is_tax_inclusive: l.is_tax_inclusive ?? false,
      }));
      const { error: le } = await supabase.from("purchase_order_lines" as any).insert(lines as any);
      if (le) throw le;
      return (po as any).id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      toast.success("Purchase order created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdatePOStatus() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const patch: any = { status };
      const now = new Date().toISOString();
      if (status === "approved") { patch.approved_by = appUser?.id ?? null; patch.approved_at = now; }
      if (status === "cancelled") { patch.cancelled_by = appUser?.id ?? null; patch.cancelled_at = now; patch.cancel_reason = reason ?? null; }
      if (status === "closed") { patch.closed_by = appUser?.id ?? null; patch.closed_at = now; }
      const { error } = await supabase.from("purchase_orders" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["purchase_order"] });
      const verb = vars.status === "approved" ? "approved" : vars.status === "cancelled" ? "cancelled" : vars.status === "closed" ? "closed" : "updated";
      toast.success(`Purchase order ${verb}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Goods Receipt Notes
// ────────────────────────────────────────────────────────────────────────────

export interface GRNLineInput {
  po_line_id?: string | null;
  item_id: string;
  qty_received: number;
  unit_cost: number;
}

export function useGRNs() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["grns", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipt_notes" as any)
        .select("*, vendor:vendors(id,name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useGRN(id: string | undefined) {
  return useQuery({
    queryKey: ["grn", id],
    queryFn: async () => {
      const { data: grn, error } = await supabase
        .from("goods_receipt_notes" as any)
        .select("*, vendor:vendors(id,name), po:purchase_orders(id,po_number)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      const { data: lines, error: le } = await supabase
        .from("grn_lines" as any)
        .select("*, item:inventory_items(id,item_name,item_code)")
        .eq("grn_id", id!);
      if (le) throw le;
      return { ...(grn as any), lines: lines as any[] };
    },
    enabled: !!id,
  });
}

export function useCreateGRN() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      vendor_id: string;
      po_id?: string | null;
      receipt_date: string;
      notes?: string;
      lines: GRNLineInput[];
    }) => {
      const total = payload.lines.reduce((s, l) => s + l.qty_received * l.unit_cost, 0);
      const { data: grn, error } = await supabase
        .from("goods_receipt_notes" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          vendor_id: payload.vendor_id,
          po_id: payload.po_id || null,
          receipt_date: payload.receipt_date,
          notes: payload.notes || null,
          total_value: total,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const lines = payload.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        grn_id: (grn as any).id,
        po_line_id: l.po_line_id || null,
        item_id: l.item_id,
        qty_received: l.qty_received,
        unit_cost: l.unit_cost,
        line_total: Math.round(l.qty_received * l.unit_cost * 100) / 100,
      }));
      const { error: le } = await supabase.from("grn_lines" as any).insert(lines as any);
      if (le) throw le;
      return (grn as any).id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grns"] });
      toast.success("GRN created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostGRN() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("post_grn" as any, { p_grn_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grns"] });
      qc.invalidateQueries({ queryKey: ["grn"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["inventory_master"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["computed_inventory_value"] });
      toast.success("GRN posted to General Ledger");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Supplier Bills
// ────────────────────────────────────────────────────────────────────────────

export interface BillLineInput {
  grn_line_id?: string | null;
  item_id?: string | null;
  account_id?: string | null;
  description?: string;
  qty: number;
  unit_cost: number;
  tax_code_id?: string | null;
  tax_group_id?: string | null;
  is_tax_inclusive?: boolean;
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
        .select("*, item:inventory_items(id,item_name), grn_line:grn_lines(id,qty_received,unit_cost,grn:goods_receipt_notes(grn_number))")
        .eq("bill_id", id!);
      if (le) throw le;
      return { ...(bill as any), lines: lines as any[] };
    },
    enabled: !!id,
  });
}

/** Returns unbilled GRN lines for 3-way matching: qty_received - qty_billed > 0 */
export function useUnbilledGRNLines(vendorId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["unbilled_grn_lines", appUser?.tenant_id, vendorId],
    queryFn: async () => {
      let query = supabase
        .from("grn_lines" as any)
        .select(
          "id, item_id, qty_received, qty_billed, unit_cost, grn:goods_receipt_notes!inner(id, grn_number, vendor_id, status, receipt_date), item:inventory_items(id, item_name, item_code)"
        )
        .eq("tenant_id", appUser!.tenant_id);
      const { data, error } = await query;
      if (error) throw error;
      return ((data as any[]) || []).filter(
        (l) =>
          l.grn?.status === "posted" &&
          (!vendorId || l.grn.vendor_id === vendorId) &&
          Number(l.qty_received) - Number(l.qty_billed) > 0.0001
      );
    },
    enabled: !!appUser?.tenant_id,
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
      tax_amount?: number;
      notes?: string;
      lines: BillLineInput[];
    }) => {
      const subtotal = payload.lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
      const total = subtotal + (payload.tax_amount || 0);
      const { data: bill, error } = await supabase
        .from("supplier_bills" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          vendor_id: payload.vendor_id,
          bill_date: payload.bill_date,
          due_date: payload.due_date || null,
          vendor_ref: payload.vendor_ref || null,
          subtotal,
          tax_amount: payload.tax_amount || 0,
          total_amount: total,
          notes: payload.notes || null,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const lines = payload.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        bill_id: (bill as any).id,
        grn_line_id: l.grn_line_id || null,
        item_id: l.item_id || null,
        account_id: l.account_id || null,
        description: l.description || null,
        qty: l.qty,
        unit_cost: l.unit_cost,
        line_total: Math.round(l.qty * l.unit_cost * 100) / 100,
        // When grn_line_id is set, the bill_line_carry_tax trigger fills tax
        // from the GRN line; an explicit selection here overrides it.
        tax_code_id: l.tax_code_id || null,
        tax_group_id: l.tax_group_id || null,
        is_tax_inclusive: l.is_tax_inclusive ?? false,
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

export function usePostSupplierBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("post_supplier_bill" as any, { p_bill_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier_bills"] });
      qc.invalidateQueries({ queryKey: ["supplier_bill"] });
      qc.invalidateQueries({ queryKey: ["unbilled_grn_lines"] });
      toast.success("Bill posted to Accounts Payable");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
