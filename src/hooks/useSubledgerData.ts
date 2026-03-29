import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Customers with Opening Balance ───────────────────────
export function useCustomersWithBalance() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["customers_with_balance", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateCustomerWithOB() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (customer: {
      name: string;
      email?: string;
      phone?: string;
      address?: string;
      opening_balance?: number;
    }) => {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          name: customer.name,
          email: customer.email || null,
          phone: customer.phone || null,
          address: customer.address || null,
          opening_balance: customer.opening_balance || 0,
          tenant_id: appUser!.tenant_id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers_with_balance"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; email?: string; phone?: string; address?: string; opening_balance?: number }) => {
      const { error } = await supabase.from("customers").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers_with_balance"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers_with_balance"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Vendors with Opening Balance ─────────────────────────
export function useVendorsWithBalance() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["vendors_with_balance", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateVendorWithOB() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vendor: {
      name: string;
      email?: string;
      phone?: string;
      address?: string;
      opening_balance?: number;
    }) => {
      const { data, error } = await supabase
        .from("vendors")
        .insert({
          name: vendor.name,
          email: vendor.email || null,
          phone: vendor.phone || null,
          address: vendor.address || null,
          opening_balance: vendor.opening_balance || 0,
          tenant_id: appUser!.tenant_id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; email?: string; phone?: string; address?: string; opening_balance?: number }) => {
      const { error } = await supabase.from("vendors").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vendors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Inventory Items (enhanced) ───────────────────────────
export function useInventoryItemsEnhanced() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inventory_items_enhanced", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("item_name");
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useCreateInventoryItemEnhanced() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: {
      item_name: string;
      sku?: string;
      description?: string;
      unit_cost?: number;
      quantity_on_hand?: number;
      account_id?: string;
    }) => {
      const qty = item.quantity_on_hand || 0;
      const cost = item.unit_cost || 0;
      const { data, error } = await supabase
        .from("inventory_items")
        .insert({
          item_name: item.item_name,
          sku: item.sku || null,
          description: item.description || null,
          unit_cost: cost,
          quantity_on_hand: qty,
          account_id: item.account_id || null,
          tenant_id: appUser!.tenant_id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items_enhanced"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      toast.success("Inventory item created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; item_name?: string; sku?: string; description?: string; unit_cost?: number; quantity_on_hand?: number }) => {
      const { error } = await supabase.from("inventory_items").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items_enhanced"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      toast.success("Inventory item updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items_enhanced"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      toast.success("Inventory item deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
