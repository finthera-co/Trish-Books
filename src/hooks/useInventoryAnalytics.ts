import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AbcRow {
  item_id: string;
  item_code: string | null;
  item_name: string;
  qty_consumed_90d: number;
  usage_value_90d: number;
  cumulative_pct: number;
  abc_class: "A" | "B" | "C";
}

/** ABC analysis: Pareto by 90-day outbound usage value. A=top 80%, B=next 15%, C=last 5%. */
export function useAbcAnalysis() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inv_abc", appUser?.tenant_id],
    queryFn: async (): Promise<AbcRow[]> => {
      const tenantId = appUser!.tenant_id;
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const sinceStr = since.toISOString().slice(0, 10);

      const [itemsRes, movRes] = await Promise.all([
        supabase
          .from("inventory_items")
          .select("id,item_code,item_name,unit_cost,is_active")
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
        supabase
          .from("stock_movements")
          .select("item_id,quantity,unit_cost,movement_date")
          .eq("tenant_id", tenantId)
          .gte("movement_date", sinceStr),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (movRes.error) throw movRes.error;

      const itemMap = new Map<string, any>();
      for (const it of (itemsRes.data || []) as any[]) itemMap.set(it.id, it);

      const agg = new Map<string, { qty: number; value: number }>();
      for (const m of (movRes.data || []) as any[]) {
        const q = Number(m.quantity);
        if (q >= 0) continue;
        const it = itemMap.get(m.item_id);
        if (!it) continue;
        const cost = Number(m.unit_cost) || Number(it.unit_cost) || 0;
        const e = agg.get(m.item_id) || { qty: 0, value: 0 };
        e.qty += -q;
        e.value += -q * cost;
        agg.set(m.item_id, e);
      }

      const rows = Array.from(itemMap.values()).map((it: any) => {
        const a = agg.get(it.id) || { qty: 0, value: 0 };
        return {
          item_id: it.id,
          item_code: it.item_code,
          item_name: it.item_name,
          qty_consumed_90d: a.qty,
          usage_value_90d: Math.round(a.value * 100) / 100,
        };
      });
      rows.sort((a, b) => b.usage_value_90d - a.usage_value_90d);
      const total = rows.reduce((s, r) => s + r.usage_value_90d, 0) || 1;
      let cum = 0;
      return rows.map((r) => {
        cum += r.usage_value_90d;
        const pct = (cum / total) * 100;
        let cls: "A" | "B" | "C" = "C";
        if (pct <= 80) cls = "A";
        else if (pct <= 95) cls = "B";
        return { ...r, cumulative_pct: Math.round(pct * 100) / 100, abc_class: cls };
      });
    },
    enabled: !!appUser?.tenant_id,
    staleTime: 60_000,
  });
}

export interface InventoryAlert {
  id: string;
  type: "low_stock" | "negative_stock" | "dead_stock" | "aged_90_plus" | "no_reorder_level";
  severity: "info" | "warning" | "critical";
  item_id: string;
  item_code: string | null;
  item_name: string;
  message: string;
  detail?: string;
}

/** Aggregated inventory alerts across critical conditions. */
export function useInventoryAlerts() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["inv_alerts", appUser?.tenant_id],
    queryFn: async (): Promise<InventoryAlert[]> => {
      const tenantId = appUser!.tenant_id;
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const sinceStr = since.toISOString().slice(0, 10);

      const [itemsRes, movRes, lotsRes] = await Promise.all([
        supabase
          .from("inventory_items")
          .select("id,item_code,item_name,quantity_on_hand,reorder_level,unit_cost,is_active")
          .eq("tenant_id", tenantId)
          .eq("is_active", true),
        supabase
          .from("stock_movements")
          .select("item_id,quantity,movement_date")
          .eq("tenant_id", tenantId)
          .gte("movement_date", sinceStr),
        supabase
          .from("stock_lots" as any)
          .select("item_id,receipt_date,qty_remaining")
          .eq("tenant_id", tenantId)
          .gt("qty_remaining", 0),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      if (movRes.error) throw movRes.error;
      if (lotsRes.error) throw lotsRes.error;

      const movByItem = new Map<string, number>();
      for (const m of (movRes.data || []) as any[]) {
        const q = Number(m.quantity);
        if (q < 0) movByItem.set(m.item_id, (movByItem.get(m.item_id) || 0) + -q);
      }
      const today = new Date();
      const oldestByItem = new Map<string, number>();
      for (const l of (lotsRes.data || []) as any[]) {
        const days = Math.floor((today.getTime() - new Date(l.receipt_date).getTime()) / 86400000);
        oldestByItem.set(l.item_id, Math.max(oldestByItem.get(l.item_id) || 0, days));
      }

      const alerts: InventoryAlert[] = [];
      for (const it of (itemsRes.data || []) as any[]) {
        const qty = Number(it.quantity_on_hand);
        if (qty < 0) {
          alerts.push({
            id: `neg-${it.id}`, type: "negative_stock", severity: "critical",
            item_id: it.id, item_code: it.item_code, item_name: it.item_name,
            message: "Negative stock", detail: `Qty: ${qty}`,
          });
        }
        const rl = Number(it.reorder_level || 0);
        if (rl > 0 && qty <= rl) {
          alerts.push({
            id: `low-${it.id}`, type: "low_stock", severity: qty === 0 ? "critical" : "warning",
            item_id: it.id, item_code: it.item_code, item_name: it.item_name,
            message: qty === 0 ? "Out of stock" : "Low stock",
            detail: `On hand ${qty} ≤ reorder level ${rl}`,
          });
        }
        if (rl === 0 && qty > 0) {
          alerts.push({
            id: `nrl-${it.id}`, type: "no_reorder_level", severity: "info",
            item_id: it.id, item_code: it.item_code, item_name: it.item_name,
            message: "No reorder level set", detail: "Configure reorder thresholds",
          });
        }
        const out = movByItem.get(it.id) || 0;
        if (qty > 0 && out === 0) {
          alerts.push({
            id: `dead-${it.id}`, type: "dead_stock", severity: "warning",
            item_id: it.id, item_code: it.item_code, item_name: it.item_name,
            message: "Dead stock (no movement 90d)",
            detail: `Value ≈ ${(qty * Number(it.unit_cost || 0)).toFixed(2)}`,
          });
        }
        const oldest = oldestByItem.get(it.id);
        if (oldest && oldest > 90) {
          alerts.push({
            id: `aged-${it.id}`, type: "aged_90_plus", severity: "warning",
            item_id: it.id, item_code: it.item_code, item_name: it.item_name,
            message: "Aged inventory > 90 days",
            detail: `Oldest lot: ${oldest} days`,
          });
        }
      }
      const order = { critical: 0, warning: 1, info: 2 };
      return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
    },
    enabled: !!appUser?.tenant_id,
    staleTime: 60_000,
  });
}
