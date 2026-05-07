import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Items at or below reorder level. */
export function useReorderReport() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inv_reorder_report", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id,item_code,item_name,quantity_on_hand,reorder_level,reorder_quantity,max_stock_level,unit_cost,is_active")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("is_active", true);
      if (error) throw error;
      return (data || [])
        .map((r: any) => ({
          ...r,
          shortfall: Math.max(0, Number(r.reorder_level || 0) - Number(r.quantity_on_hand || 0)),
          suggested_qty: Math.max(
            0,
            Number(r.reorder_quantity || 0) ||
              Math.max(0, Number(r.max_stock_level || 0) - Number(r.quantity_on_hand || 0))
          ),
        }))
        .filter((r: any) => Number(r.reorder_level || 0) > 0 && Number(r.quantity_on_hand || 0) <= Number(r.reorder_level || 0))
        .sort((a: any, b: any) => b.shortfall - a.shortfall);
    },
    enabled: !!appUser?.tenant_id,
  });
}

export interface AgingBucket {
  item_id: string;
  item_code: string | null;
  item_name: string;
  qty_on_hand: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  total_value: number;
}

/** Inventory aging by FIFO lot receipt date. WAC items reported in 0-30 (no lot history). */
export function useStockAgingReport() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inv_aging_report", appUser?.tenant_id],
    queryFn: async (): Promise<AgingBucket[]> => {
      const tenantId = appUser!.tenant_id;
      const [itemsRes, lotsRes] = await Promise.all([
        supabase
          .from("inventory_items")
          .select("id,item_code,item_name,quantity_on_hand,unit_cost,valuation_method,is_active")
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
        supabase
          .from("stock_lots" as any)
          .select("item_id,receipt_date,qty_remaining,unit_cost")
          .eq("tenant_id", tenantId)
          .gt("qty_remaining", 0),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (lotsRes.error) throw lotsRes.error;

      const today = new Date();
      const ageDays = (d: string) => Math.floor((today.getTime() - new Date(d).getTime()) / 86400000);

      const lotByItem = new Map<string, any[]>();
      for (const l of (lotsRes.data || []) as any[]) {
        if (!lotByItem.has(l.item_id)) lotByItem.set(l.item_id, []);
        lotByItem.get(l.item_id)!.push(l);
      }

      const out: AgingBucket[] = [];
      for (const it of (itemsRes.data || []) as any[]) {
        const lots = lotByItem.get(it.id) || [];
        let b1 = 0, b2 = 0, b3 = 0, b4 = 0;
        if (lots.length > 0) {
          for (const lot of lots) {
            const v = Number(lot.qty_remaining) * Number(lot.unit_cost);
            const days = ageDays(lot.receipt_date);
            if (days <= 30) b1 += v;
            else if (days <= 60) b2 += v;
            else if (days <= 90) b3 += v;
            else b4 += v;
          }
        } else {
          // WAC fallback: full value in 0-30 (no lot history)
          b1 = Number(it.quantity_on_hand) * Number(it.unit_cost || 0);
        }
        const total = b1 + b2 + b3 + b4;
        if (total === 0 && Number(it.quantity_on_hand) === 0) continue;
        out.push({
          item_id: it.id,
          item_code: it.item_code,
          item_name: it.item_name,
          qty_on_hand: Number(it.quantity_on_hand),
          bucket_0_30: b1,
          bucket_31_60: b2,
          bucket_61_90: b3,
          bucket_90_plus: b4,
          total_value: total,
        });
      }
      return out.sort((a, b) => b.bucket_90_plus - a.bucket_90_plus);
    },
    enabled: !!appUser?.tenant_id,
  });
}

export interface MovementAnalysisRow {
  item_id: string;
  item_code: string | null;
  item_name: string;
  qty_on_hand: number;
  outbound_qty_90d: number;
  avg_daily_consumption: number;
  days_of_supply: number | null;
  classification: "fast" | "medium" | "slow" | "dead";
  last_movement_date: string | null;
}

/** Movement velocity / dead stock based on 90-day outbound activity. */
export function useMovementAnalysis() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inv_movement_analysis", appUser?.tenant_id],
    queryFn: async (): Promise<MovementAnalysisRow[]> => {
      const tenantId = appUser!.tenant_id;
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const sinceStr = since.toISOString().slice(0, 10);

      const [itemsRes, movRes] = await Promise.all([
        supabase
          .from("inventory_items")
          .select("id,item_code,item_name,quantity_on_hand,is_active")
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
        supabase
          .from("stock_movements")
          .select("item_id,quantity,movement_date,movement_type")
          .eq("tenant_id", tenantId)
          .gte("movement_date", sinceStr),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (movRes.error) throw movRes.error;

      const agg = new Map<string, { outbound: number; last: string | null }>();
      for (const m of (movRes.data || []) as any[]) {
        const e = agg.get(m.item_id) || { outbound: 0, last: null };
        const q = Number(m.quantity);
        if (q < 0) e.outbound += -q;
        if (!e.last || m.movement_date > e.last) e.last = m.movement_date;
        agg.set(m.item_id, e);
      }

      return ((itemsRes.data || []) as any[]).map((it: any) => {
        const a = agg.get(it.id) || { outbound: 0, last: null };
        const avg = a.outbound / 90;
        const dos = avg > 0 ? Number(it.quantity_on_hand) / avg : null;
        let cls: MovementAnalysisRow["classification"] = "dead";
        if (avg >= 1) cls = "fast";
        else if (avg >= 0.2) cls = "medium";
        else if (avg > 0) cls = "slow";
        return {
          item_id: it.id,
          item_code: it.item_code,
          item_name: it.item_name,
          qty_on_hand: Number(it.quantity_on_hand),
          outbound_qty_90d: a.outbound,
          avg_daily_consumption: avg,
          days_of_supply: dos,
          classification: cls,
          last_movement_date: a.last,
        };
      });
    },
    enabled: !!appUser?.tenant_id,
  });
}

export interface GLReconcileResult {
  inventory_account_code: string;
  inventory_account_name: string;
  gl_balance: number;
  subledger_value: number;
  variance: number;
  is_reconciled: boolean;
  per_item: { item_id: string; item_name: string; reported_value: number }[];
}

/** Reconcile Inventory Asset GL balance to subledger valuation. */
export function useInventoryGLReconciliation() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inv_gl_reconcile", appUser?.tenant_id],
    queryFn: async (): Promise<GLReconcileResult> => {
      const tenantId = appUser!.tenant_id;

      // 1. Find Inventory Asset account (code 1200 by seed convention)
      const { data: accts, error: aErr } = await supabase
        .from("accounts")
        .select("id,account_code,account_name,account_subtype,account_type")
        .eq("tenant_id", tenantId)
        .eq("account_type", "Asset");
      if (aErr) throw aErr;
      const invAcct =
        (accts || []).find((a: any) => a.account_code === "1200") ||
        (accts || []).find((a: any) => a.account_subtype === "Inventory") ||
        (accts || []).find((a: any) => /inventory/i.test(a.account_name));
      if (!invAcct) throw new Error("Inventory Asset account not found in Chart of Accounts");

      // 2. Sum journal lines for this account (posted entries only)
      const { data: lines, error: lErr } = await supabase
        .from("journal_lines")
        .select("debit,credit,journal_entry:journal_entries!inner(status,voided_at,tenant_id)")
        .eq("account_id", invAcct.id);
      if (lErr) throw lErr;
      const glBalance = ((lines || []) as any[])
        .filter((l: any) => l.journal_entry?.status === "posted" && !l.journal_entry?.voided_at && l.journal_entry?.tenant_id === tenantId)
        .reduce((s: number, l: any) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);

      // 3. Subledger valuation via RPC
      const { data: val, error: vErr } = await supabase.rpc("inventory_valuation_report" as any, {
        p_tenant_id: tenantId,
      });
      if (vErr) throw vErr;
      const perItem = ((val || []) as any[]).map((r: any) => ({
        item_id: r.item_id,
        item_name: r.item_name,
        reported_value: Number(r.reported_value) || 0,
      }));
      const subledger = perItem.reduce((s, r) => s + r.reported_value, 0);
      const variance = Math.round((glBalance - subledger) * 100) / 100;

      return {
        inventory_account_code: invAcct.account_code,
        inventory_account_name: invAcct.account_name,
        gl_balance: Math.round(glBalance * 100) / 100,
        subledger_value: Math.round(subledger * 100) / 100,
        variance,
        is_reconciled: Math.abs(variance) < 0.01,
        per_item: perItem,
      };
    },
    enabled: !!appUser?.tenant_id,
    staleTime: 30_000,
  });
}
