import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type AllocationMethod = "value" | "qty" | "weight";

export interface LandedCostChargeInput {
  description: string;
  amount: number;
  offset_account_id: string;
}

export interface CreateLandedCostInput {
  voucher_date: string;
  allocation_method: AllocationMethod;
  notes?: string;
  grn_ids: string[];
  charges: LandedCostChargeInput[];
}

export function useLandedCostVouchers() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["landed_cost_vouchers", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landed_cost_vouchers" as any)
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useLandedCostVoucher(id: string | undefined) {
  return useQuery({
    queryKey: ["landed_cost_voucher", id],
    queryFn: async () => {
      const [v, charges, grns, allocs] = await Promise.all([
        supabase.from("landed_cost_vouchers" as any).select("*").eq("id", id!).single(),
        supabase.from("landed_cost_charges" as any).select("*, account:accounts(account_code,account_name)").eq("voucher_id", id!),
        supabase.from("landed_cost_voucher_grns" as any).select("*, grn:goods_receipt_notes(grn_number,receipt_date,total_value)").eq("voucher_id", id!),
        supabase.from("landed_cost_allocations" as any).select("*, item:inventory_items(item_name,item_code), grn_line:grn_lines(qty_received,unit_cost)").eq("voucher_id", id!),
      ]);
      if (v.error) throw v.error;
      return {
        ...(v.data as any),
        charges: (charges.data as any[]) || [],
        grns: (grns.data as any[]) || [],
        allocations: (allocs.data as any[]) || [],
      };
    },
    enabled: !!id,
  });
}

export function useCreateLandedCostVoucher() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateLandedCostInput) => {
      const totalCharges = payload.charges.reduce((s, c) => s + c.amount, 0);
      const { data: v, error } = await supabase
        .from("landed_cost_vouchers" as any)
        .insert({
          tenant_id: appUser!.tenant_id,
          voucher_date: payload.voucher_date,
          allocation_method: payload.allocation_method,
          notes: payload.notes || null,
          total_charges: totalCharges,
          status: "draft",
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      const voucherId = (v as any).id as string;

      const grnRows = payload.grn_ids.map((g) => ({
        tenant_id: appUser!.tenant_id,
        voucher_id: voucherId,
        grn_id: g,
      }));
      if (grnRows.length) {
        const { error: ge } = await supabase.from("landed_cost_voucher_grns" as any).insert(grnRows as any);
        if (ge) throw ge;
      }

      const chargeRows = payload.charges.map((c) => ({
        tenant_id: appUser!.tenant_id,
        voucher_id: voucherId,
        description: c.description,
        amount: c.amount,
        offset_account_id: c.offset_account_id,
      }));
      const { error: ce } = await supabase.from("landed_cost_charges" as any).insert(chargeRows as any);
      if (ce) throw ce;

      return voucherId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landed_cost_vouchers"] });
      toast.success("Landed cost voucher created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostLandedCostVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("post_landed_cost_voucher" as any, { p_voucher_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landed_cost_vouchers"] });
      qc.invalidateQueries({ queryKey: ["landed_cost_voucher"] });
      qc.invalidateQueries({ queryKey: ["inventory_master"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["computed_inventory_value"] });
      toast.success("Landed costs posted to GL — inventory uplifted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteLandedCostVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("landed_cost_vouchers" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landed_cost_vouchers"] });
      toast.success("Voucher deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Posted GRNs (for selection in landed cost voucher) */
export function usePostedGRNs() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["posted_grns", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goods_receipt_notes" as any)
        .select("id, grn_number, receipt_date, total_value, vendor:vendors(name)")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("status", "posted")
        .order("receipt_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!appUser?.tenant_id,
  });
}
