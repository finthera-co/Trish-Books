import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface BomComponentInput {
  component_item_id: string;
  qty_per_output: number;
  scrap_pct?: number;
  notes?: string;
}

export interface BomInput {
  bom_code: string;
  fg_item_id: string;
  output_qty: number;
  labor_cost_per_unit?: number;
  overhead_cost_per_unit?: number;
  notes?: string;
  components: BomComponentInput[];
}

export function useBoms() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["boms", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boms" as any)
        .select("*, fg:inventory_items!fg_item_id(id,item_code,item_name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useBomComponents(bomId: string | undefined) {
  return useQuery({
    queryKey: ["bom_components", bomId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bom_components" as any)
        .select("*, component:inventory_items!component_item_id(id,item_code,item_name,unit_cost)")
        .eq("bom_id", bomId!);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!bomId,
  });
}

export function useCreateBom() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: BomInput) => {
      const { data: hdr, error } = await supabase
        .from("boms" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          bom_code: p.bom_code,
          fg_item_id: p.fg_item_id,
          output_qty: p.output_qty,
          labor_cost_per_unit: p.labor_cost_per_unit || 0,
          overhead_cost_per_unit: p.overhead_cost_per_unit || 0,
          notes: p.notes || null,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      const rows = p.components.map((c) => ({
        tenant_id: appUser!.tenant_id,
        bom_id: (hdr as any).id,
        component_item_id: c.component_item_id,
        qty_per_output: c.qty_per_output,
        scrap_pct: c.scrap_pct || 0,
        notes: c.notes || null,
      }));
      const { error: ce } = await supabase.from("bom_components" as any).insert(rows as any);
      if (ce) throw ce;
      return (hdr as any).id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boms"] });
      toast.success("BOM created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("boms" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boms"] });
      toast.success("BOM deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAssemblyOrders() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["assembly_orders", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assembly_orders" as any)
        .select("*, fg:inventory_items!fg_item_id(id,item_code,item_name), bom:boms(id,bom_code)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export interface CreateAOInput {
  bom_id: string;
  ao_date: string;
  output_qty: number;
  warehouse_id?: string | null;
  labor_cost?: number;
  overhead_cost?: number;
  notes?: string;
}

export function useCreateAssemblyOrder() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: CreateAOInput) => {
      // load BOM + components
      const { data: bom, error: be } = await supabase
        .from("boms" as any)
        .select("*")
        .eq("id", p.bom_id)
        .single();
      if (be) throw be;
      const { data: comps, error: ce } = await supabase
        .from("bom_components" as any)
        .select("*, component:inventory_items!component_item_id(unit_cost)")
        .eq("bom_id", p.bom_id);
      if (ce) throw ce;

      const ratio = p.output_qty / Number((bom as any).output_qty);
      const labor = p.labor_cost ?? Number((bom as any).labor_cost_per_unit || 0) * p.output_qty;
      const overhead = p.overhead_cost ?? Number((bom as any).overhead_cost_per_unit || 0) * p.output_qty;

      // generate AO number
      const { count } = await supabase
        .from("assembly_orders" as any)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", appUser!.tenant_id);
      const aoNumber = `AO-${String((count || 0) + 1).padStart(5, "0")}`;

      const { data: hdr, error } = await supabase
        .from("assembly_orders" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          ao_number: aoNumber,
          ao_date: p.ao_date,
          bom_id: p.bom_id,
          fg_item_id: (bom as any).fg_item_id,
          output_qty: p.output_qty,
          warehouse_id: p.warehouse_id || null,
          labor_cost: labor,
          overhead_cost: overhead,
          notes: p.notes || null,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const lines = (comps as any[]).map((c) => {
        const qty = Number(c.qty_per_output) * ratio * (1 + Number(c.scrap_pct || 0));
        const unitCost = Number(c.component?.unit_cost || 0);
        return {
          tenant_id: appUser!.tenant_id,
          assembly_order_id: (hdr as any).id,
          component_item_id: c.component_item_id,
          qty_required: qty,
          unit_cost: unitCost,
          total_cost: Math.round(qty * unitCost * 100) / 100,
        };
      });
      const { error: le } = await supabase.from("assembly_order_lines" as any).insert(lines as any);
      if (le) throw le;
      return (hdr as any).id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assembly_orders"] });
      toast.success("Assembly order created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostAssemblyOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("post_assembly_order" as any, { p_ao_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assembly_orders"] });
      qc.invalidateQueries({ queryKey: ["inventory_master"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["computed_inventory_value"] });
      toast.success("Assembly order posted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAssemblyOrderLines(aoId: string | undefined) {
  return useQuery({
    queryKey: ["assembly_order_lines", aoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assembly_order_lines" as any)
        .select("*, component:inventory_items!component_item_id(item_code,item_name,quantity_on_hand)")
        .eq("assembly_order_id", aoId!);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!aoId,
  });
}
