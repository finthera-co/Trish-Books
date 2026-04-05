import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { postCustomerOpeningBalance, postVendorOpeningBalance } from "@/lib/postingEngine";

// ─── Helper: find AR control account ──────────────────────
async function findARAccountId(tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_control_account", true)
    .ilike("account_subtype", "%accounts receivable%")
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function findAPAccountId(tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_control_account", true)
    .ilike("account_subtype", "%accounts payable%")
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function findInventoryControlAccountId(tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_control_account", true)
    .ilike("account_subtype", "%inventory%")
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

async function findFixedAssetControlAccountId(tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_control_account", true)
    .ilike("account_subtype", "%fixed asset%")
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

// Common query keys to invalidate for COA/subledger consistency
const COA_QUERY_KEYS = ["accounts", "chart_of_accounts", "trial_balance", "balance_sheet"];

// ─── Customers with AR Subledger Balance ──────────────────
export function useCustomersWithBalance() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["customers_with_balance", appUser?.tenant_id],
    queryFn: async () => {
      const tid = appUser!.tenant_id;
      // Fetch customers
      const { data: customers, error } = await supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", tid)
        .order("name");
      if (error) throw error;

      // Fetch AR subledger balances grouped by customer
      const { data: arBalances } = await supabase
        .from("ar_subledger")
        .select("customer_id, debit, credit")
        .eq("tenant_id", tid);

      // Calculate balance per customer from subledger
      const balanceMap = new Map<string, number>();
      for (const row of arBalances || []) {
        const prev = balanceMap.get(row.customer_id) || 0;
        balanceMap.set(row.customer_id, prev + Number(row.debit) - Number(row.credit));
      }

      return (customers || []).map((c: any) => ({
        ...c,
        ar_balance: balanceMap.get(c.id) || 0,
      }));
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
      credit_limit?: number;
      payment_terms?: string;
    }) => {
      const tenantId = appUser!.tenant_id;

      // 1. Create customer record
      const { data, error } = await supabase
        .from("customers")
        .insert({
          name: customer.name,
          email: customer.email || null,
          phone: customer.phone || null,
          address: customer.address || null,
          opening_balance: customer.opening_balance || 0,
          credit_limit: customer.credit_limit || 0,
          payment_terms: customer.payment_terms || "net_30",
          tenant_id: tenantId,
        })
        .select()
        .single();
      if (error) throw error;

      // 2. If opening_balance > 0, post via posting engine
      const ob = customer.opening_balance || 0;
      if (ob > 0) {
        const arAccountId = await findARAccountId(tenantId);
        if (!arAccountId) throw new Error("Accounts Receivable control account not found. Please set up your Chart of Accounts first.");

        await postCustomerOpeningBalance({
          tenant_id: tenantId,
          customer_id: data.id,
          customer_name: customer.name,
          amount: ob,
          ar_account_id: arAccountId,
          date: new Date().toISOString().split("T")[0],
        });
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers_with_balance"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["ar_subledger"] });
      COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Customer created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; email?: string; phone?: string; address?: string; credit_limit?: number; payment_terms?: string }) => {
      // Don't allow changing opening_balance via update - it's managed by subledger
      const { opening_balance, ...safeUpdates } = updates as any;
      const { error } = await supabase.from("customers").update(safeUpdates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers_with_balance"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Customer updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Block if subledger entries exist
      const { count } = await supabase
        .from("ar_subledger")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", id);

      if (count && count > 0) {
        throw new Error("Cannot delete customer with existing AR transactions. Void the related journal entries first.");
      }

      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers_with_balance"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Customer deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Vendors with AP Subledger Balance ────────────────────
export function useVendorsWithBalance() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["vendors_with_balance", appUser?.tenant_id],
    queryFn: async () => {
      const tid = appUser!.tenant_id;
      const { data: vendors, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("tenant_id", tid)
        .order("name");
      if (error) throw error;

      const { data: apBalances } = await supabase
        .from("ap_subledger")
        .select("vendor_id, debit, credit")
        .eq("tenant_id", tid);

      const balanceMap = new Map<string, number>();
      for (const row of apBalances || []) {
        const prev = balanceMap.get(row.vendor_id) || 0;
        balanceMap.set(row.vendor_id, prev + Number(row.credit) - Number(row.debit));
      }

      return (vendors || []).map((v: any) => ({
        ...v,
        ap_balance: balanceMap.get(v.id) || 0,
      }));
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
      const tenantId = appUser!.tenant_id;

      const { data, error } = await supabase
        .from("vendors")
        .insert({
          name: vendor.name,
          email: vendor.email || null,
          phone: vendor.phone || null,
          address: vendor.address || null,
          opening_balance: vendor.opening_balance || 0,
          tenant_id: tenantId,
        })
        .select()
        .single();
      if (error) throw error;

      const ob = vendor.opening_balance || 0;
      if (ob > 0) {
        const apAccountId = await findAPAccountId(tenantId);
        if (!apAccountId) throw new Error("Accounts Payable control account not found.");

        await postVendorOpeningBalance({
          tenant_id: tenantId,
          vendor_id: data.id,
          vendor_name: vendor.name,
          amount: ob,
          ap_account_id: apAccountId,
          date: new Date().toISOString().split("T")[0],
        });
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      qc.invalidateQueries({ queryKey: ["ap_subledger"] });
      COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Vendor created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; email?: string; phone?: string; address?: string }) => {
      const { opening_balance, ...safeUpdates } = updates as any;
      const { error } = await supabase.from("vendors").update(safeUpdates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors_with_balance"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Vendor updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { count } = await supabase
        .from("ap_subledger")
        .select("id", { count: "exact", head: true })
        .eq("vendor_id", id);

      if (count && count > 0) {
        throw new Error("Cannot delete vendor with existing AP transactions.");
      }

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
      const tenantId = appUser!.tenant_id;
      const qty = item.quantity_on_hand || 0;
      const cost = item.unit_cost || 0;

      // Auto-link to inventory control account if not specified
      let accountId = item.account_id || null;
      if (!accountId) {
        accountId = await findInventoryControlAccountId(tenantId);
      }

      const { data, error } = await supabase
        .from("inventory_items")
        .insert({
          item_name: item.item_name,
          sku: item.sku || null,
          description: item.description || null,
          unit_cost: cost,
          quantity_on_hand: qty,
          account_id: accountId,
          tenant_id: tenantId,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items_enhanced"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["inventory_subledger"] });
      COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
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
      COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Inventory item updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { count } = await supabase
        .from("inventory_subledger")
        .select("id", { count: "exact", head: true })
        .eq("item_id", id);

      if (count && count > 0) {
        throw new Error("Cannot delete inventory item with existing subledger transactions.");
      }

      const { error } = await supabase.from("inventory_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items_enhanced"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      COA_QUERY_KEYS.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Inventory item deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
