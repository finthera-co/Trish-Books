import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ───────── Delivery Notes ─────────
export function useDeliveryNotes() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["delivery_notes", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_notes" as any)
        .select("*, customers(name), warehouses(name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("dispatch_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateDeliveryNote() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customer_id?: string;
      invoice_id?: string;
      warehouse_id?: string;
      dispatch_date: string;
      notes?: string;
      lines: { item_id: string; qty: number; warehouse_id?: string; invoice_item_id?: string }[];
    }) => {
      const { data: dn, error } = await supabase
        .from("delivery_notes" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          customer_id: input.customer_id,
          invoice_id: input.invoice_id,
          warehouse_id: input.warehouse_id,
          dispatch_date: input.dispatch_date,
          notes: input.notes,
        } as any)
        .select()
        .single();
      if (error) throw error;
      const dnId = (dn as any).id;
      const linesPayload = input.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        dn_id: dnId,
        item_id: l.item_id,
        qty: l.qty,
        warehouse_id: l.warehouse_id || input.warehouse_id,
        invoice_item_id: l.invoice_item_id,
      }));
      const { error: lErr } = await supabase.from("delivery_note_lines" as any).insert(linesPayload as any);
      if (lErr) throw lErr;
      return dn;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery_notes"] });
      toast.success("Delivery Note created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostDeliveryNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("post_delivery_note" as any, { p_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery_notes"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Delivery Note posted — COGS recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ───────── Sales Returns ─────────
export function useSalesReturns() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["sales_returns", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_returns" as any)
        .select("*, customers(name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("return_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateSalesReturn() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customer_id?: string;
      invoice_id?: string;
      warehouse_id?: string;
      return_date: string;
      reason?: string;
      lines: { item_id: string; qty: number; unit_price: number; unit_cost?: number; warehouse_id?: string }[];
    }) => {
      const { data: sr, error } = await supabase
        .from("sales_returns" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          customer_id: input.customer_id,
          invoice_id: input.invoice_id,
          warehouse_id: input.warehouse_id,
          return_date: input.return_date,
          reason: input.reason,
        } as any)
        .select()
        .single();
      if (error) throw error;
      const srId = (sr as any).id;
      const linesPayload = input.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        sr_id: srId,
        item_id: l.item_id,
        qty: l.qty,
        unit_price: l.unit_price,
        unit_cost: l.unit_cost || 0,
        warehouse_id: l.warehouse_id || input.warehouse_id,
      }));
      const { error: lErr } = await supabase.from("sales_return_lines" as any).insert(linesPayload as any);
      if (lErr) throw lErr;
      return sr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales_returns"] });
      toast.success("Sales Return created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostSalesReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("post_sales_return" as any, { p_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales_returns"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Sales Return posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ───────── Purchase Returns ─────────
export function usePurchaseReturns() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["purchase_returns", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_returns" as any)
        .select("*, vendors(name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("return_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreatePurchaseReturn() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      vendor_id?: string;
      grn_id?: string;
      bill_id?: string;
      warehouse_id?: string;
      return_date: string;
      reason?: string;
      lines: { item_id: string; qty: number; unit_cost?: number; warehouse_id?: string }[];
    }) => {
      const { data: pr, error } = await supabase
        .from("purchase_returns" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          vendor_id: input.vendor_id,
          grn_id: input.grn_id,
          bill_id: input.bill_id,
          warehouse_id: input.warehouse_id,
          return_date: input.return_date,
          reason: input.reason,
        } as any)
        .select()
        .single();
      if (error) throw error;
      const prId = (pr as any).id;
      const linesPayload = input.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        pr_id: prId,
        item_id: l.item_id,
        qty: l.qty,
        unit_cost: l.unit_cost || 0,
        warehouse_id: l.warehouse_id || input.warehouse_id,
      }));
      const { error: lErr } = await supabase.from("purchase_return_lines" as any).insert(linesPayload as any);
      if (lErr) throw lErr;
      return pr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_returns"] });
      toast.success("Purchase Return created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostPurchaseReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("post_purchase_return" as any, { p_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_returns"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Purchase Return posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
