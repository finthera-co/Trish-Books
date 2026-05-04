import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type AdjustmentType = "count" | "writeoff" | "writeup" | "damage" | "loss" | "found";
export type AdjustmentStatus = "draft" | "pending_approval" | "posted" | "rejected" | "cancelled";

export interface AdjustmentLineInput {
  item_id: string;
  warehouse_id?: string | null;
  qty_delta: number; // signed
  unit_cost: number;
  notes?: string;
}

export function useStockAdjustments() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["stock_adjustments", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_adjustments" as any)
        .select("*, warehouse:warehouses(id,name,code)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useStockAdjustment(id: string | undefined) {
  return useQuery({
    queryKey: ["stock_adjustment", id],
    queryFn: async () => {
      const { data: hdr, error } = await supabase
        .from("stock_adjustments" as any)
        .select("*, warehouse:warehouses(id,name,code)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      const { data: lines, error: le } = await supabase
        .from("stock_adjustment_lines" as any)
        .select("*, item:inventory_items(id,item_name,item_code,unit_cost,quantity_on_hand)")
        .eq("adjustment_id", id!);
      if (le) throw le;
      return { ...(hdr as any), lines: lines as any[] };
    },
    enabled: !!id,
  });
}

export function useCreateStockAdjustment() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      adjustment_date: string;
      warehouse_id?: string | null;
      adjustment_type: AdjustmentType;
      reason?: string;
      notes?: string;
      lines: AdjustmentLineInput[];
    }) => {
      const total = payload.lines.reduce(
        (s, l) => s + Math.abs(l.qty_delta) * l.unit_cost,
        0,
      );
      const { data: hdr, error } = await supabase
        .from("stock_adjustments" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          adjustment_date: payload.adjustment_date,
          warehouse_id: payload.warehouse_id || null,
          adjustment_type: payload.adjustment_type,
          reason: payload.reason || null,
          notes: payload.notes || null,
          total_value: total,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const lines = payload.lines.map((l) => ({
        tenant_id: appUser!.tenant_id,
        adjustment_id: (hdr as any).id,
        item_id: l.item_id,
        warehouse_id: l.warehouse_id || payload.warehouse_id || null,
        qty_delta: l.qty_delta,
        unit_cost: l.unit_cost,
        line_value: Math.round(Math.abs(l.qty_delta) * l.unit_cost * 100) / 100,
        notes: l.notes || null,
      }));
      const { error: le } = await supabase
        .from("stock_adjustment_lines" as any)
        .insert(lines as any);
      if (le) throw le;
      return (hdr as any).id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_adjustments"] });
      toast.success("Adjustment draft saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function useAdjMutation(rpc: string, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: any) => {
      const { data, error } = await supabase.rpc(rpc as any, args);
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["stock_adjustments"] });
      qc.invalidateQueries({ queryKey: ["stock_adjustment"] });
      qc.invalidateQueries({ queryKey: ["inventory_master"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["computed_inventory_value"] });
      qc.invalidateQueries({ queryKey: ["inventory_valuation"] });
      const status = (data as any)?.status;
      toast.success(status === "pending_approval" ? "Sent for approval" : success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSubmitAdjustment() {
  return useAdjMutation("submit_stock_adjustment", "Adjustment posted");
}

export function useApproveAdjustment() {
  return useAdjMutation("approve_stock_adjustment", "Adjustment approved & posted");
}

export function useRejectAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc("reject_stock_adjustment" as any, {
        p_adjustment_id: id,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_adjustments"] });
      toast.success("Adjustment rejected");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
