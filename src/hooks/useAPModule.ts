import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type APAgingRow = {
  vendor_id: string;
  vendor_name: string;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_120: number;
  over_120: number;
  total: number;
};

export type APAgingTotals = {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_120: number;
  over_120: number;
  grand_total: number;
};

export type APReconciliationResult = {
  subledger_balance: number;
  gl_balance: number;
  variance: number;
  status: "RECONCILED" | "VARIANCE_DETECTED";
  as_of_date: string;
};

export function useAPAging(asOfDate?: string) {
  const { appUser } = useAuth();
  const dateParam = asOfDate ?? new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["ap_aging", appUser?.tenant_id, dateParam],
    queryFn: async () => {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("ap_aging_report", {
        p_as_of_date: dateParam,
      });

      if (!rpcErr && rpcData) {
        const result = rpcData as { rows: APAgingRow[]; totals: APAgingTotals };
        return { rows: result.rows ?? [], totals: result.totals };
      }

      // Fallback: client-side from ap_subledger
      const tid = appUser!.tenant_id;
      const { data: apEntries } = await supabase
        .from("ap_subledger")
        .select("vendor_id, document_type, document_id, debit, credit, due_date, created_at, tenant_id")
        .eq("tenant_id", tid);

      const { data: vendors } = await supabase
        .from("vendors")
        .select("id, name")
        .eq("tenant_id", tid);
      const vendorNameMap = new Map((vendors || []).map((v: any) => [v.id, v.name]));

      const invoiceBalances = new Map<string, { vendor_id: string; due_date: string | null; balance: number }>();
      for (const e of apEntries || []) {
        if (e.document_type === "bill" || e.document_type === "opening_balance") {
          const key = e.document_id || e.vendor_id;
          const existing = invoiceBalances.get(key);
          const delta = Number(e.credit ?? 0) - Number(e.debit ?? 0);
          if (existing) existing.balance += delta;
          else invoiceBalances.set(key, { vendor_id: e.vendor_id, due_date: e.due_date, balance: delta });
        }
      }

      const today = new Date(dateParam);
      const fallbackRows = new Map<string, APAgingRow>();

      for (const [, inv] of invoiceBalances) {
        if (inv.balance <= 0) continue;
        const vid = inv.vendor_id;
        if (!fallbackRows.has(vid)) {
          fallbackRows.set(vid, {
            vendor_id: vid,
            vendor_name: vendorNameMap.get(vid) || "Unknown",
            current: 0, days_1_30: 0, days_31_60: 0,
            days_61_90: 0, days_91_120: 0, over_120: 0, total: 0,
          });
        }
        const row = fallbackRows.get(vid)!;
        const dueDate = inv.due_date ? new Date(inv.due_date) : today;
        const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOverdue <= 0)        row.current      += inv.balance;
        else if (daysOverdue <= 30)  row.days_1_30    += inv.balance;
        else if (daysOverdue <= 60)  row.days_31_60   += inv.balance;
        else if (daysOverdue <= 90)  row.days_61_90   += inv.balance;
        else if (daysOverdue <= 120) row.days_91_120  += inv.balance;
        else                         row.over_120     += inv.balance;
        row.total += inv.balance;
      }

      const rows = Array.from(fallbackRows.values()).sort((a, b) => b.total - a.total);
      const totals: APAgingTotals = rows.reduce(
        (acc, r) => ({
          current:     acc.current     + r.current,
          days_1_30:   acc.days_1_30   + r.days_1_30,
          days_31_60:  acc.days_31_60  + r.days_31_60,
          days_61_90:  acc.days_61_90  + r.days_61_90,
          days_91_120: acc.days_91_120 + r.days_91_120,
          over_120:    acc.over_120    + r.over_120,
          grand_total: acc.grand_total + r.total,
        }),
        { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, over_120: 0, grand_total: 0 }
      );
      return { rows, totals };
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useAPReconciliation(asOfDate?: string) {
  const { appUser } = useAuth();
  const dateParam = asOfDate ?? new Date().toISOString().split("T")[0];
  return useQuery({
    queryKey: ["ap_reconciliation", appUser?.tenant_id, dateParam],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ap_reconciliation_check", {
        p_as_of_date: dateParam,
      });
      if (error) throw error;
      return data as APReconciliationResult;
    },
    enabled: !!appUser?.tenant_id,
  });
}

export function useSupplierAccount(vendorId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["supplier_accounts", vendorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_accounts")
        .select("*")
        .eq("vendor_id", vendorId!)
        .eq("tenant_id", appUser!.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!vendorId && !!appUser?.tenant_id,
  });
}

export function useAPTransactions(vendorId?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["ap_transactions", vendorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ap_transactions")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("vendor_id", vendorId!)
        .order("transaction_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!vendorId && !!appUser?.tenant_id,
  });
}
