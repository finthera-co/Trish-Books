import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface Warehouse {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
}

export function useWarehouses() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["warehouses", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses" as any)
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as Warehouse[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateWarehouse() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { code: string; name: string; address?: string; is_default?: boolean }) => {
      const { data, error } = await supabase
        .from("warehouses" as any)
        .insert({ ...payload, tenant_id: appUser!.tenant_id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouses"] });
      toast.success("Warehouse created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface StockTransfer {
  id: string;
  tenant_id: string;
  transfer_number: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  transfer_date: string;
  status: string;
  notes: string | null;
  posted_at: string | null;
  created_at: string;
}

export function useStockTransfers() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["stock_transfers", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_transfers" as any)
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as StockTransfer[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateStockTransfer() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      from_warehouse_id: string;
      to_warehouse_id: string;
      transfer_date: string;
      notes?: string;
      lines: Array<{ item_id: string; quantity: number; unit_cost: number }>;
    }) => {
      const { lines, ...header } = payload;
      const { data: tr, error } = await supabase
        .from("stock_transfers" as any)
        .insert({ ...header, tenant_id: appUser!.tenant_id } as any)
        .select()
        .single();
      if (error) throw error;

      const trId = (tr as any).id;
      const linesPayload = lines.map((l) => ({
        transfer_id: trId,
        item_id: l.item_id,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        total_cost: Number((l.unit_cost * l.quantity).toFixed(2)),
      }));
      const { error: lerr } = await supabase.from("stock_transfer_lines" as any).insert(linesPayload as any);
      if (lerr) throw lerr;
      return tr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_transfers"] });
      toast.success("Transfer created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (transferId: string) => {
      const { data, error } = await supabase.rpc("post_stock_transfer" as any, { p_transfer_id: transferId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_transfers"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["inventory_items_enhanced"] });
      qc.invalidateQueries({ queryKey: ["computed_inventory_value"] });
      toast.success("Transfer posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
