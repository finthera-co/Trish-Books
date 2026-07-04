import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SerialRow {
  id: string; serial: string; branch_code: string; yy: number; mmm: string; seq: number;
  invoice_id: string | null; status: "reserved" | "issued" | "cancelled"; reason: string | null; created_at: string;
}

export interface SerialGroup {
  key: string; branch_code: string; yy: number; mmm: string;
  rows: SerialRow[]; minSeq: number; maxSeq: number;
  missing: number[]; // seq numbers with no register row = unexplained gaps (should be empty)
  issued: number; cancelled: number; reserved: number;
}

export function useSerialRegister() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["invoice_serial_register", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async (): Promise<SerialGroup[]> => {
      const { data, error } = await supabase
        .from("invoice_serial_register" as any)
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .order("branch_code").order("yy", { ascending: false }).order("mmm").order("seq");
      if (error) throw error;
      const rows = (data || []) as unknown as SerialRow[];

      const groups = new Map<string, SerialGroup>();
      for (const r of rows) {
        const key = `${r.branch_code}·${r.yy}·${r.mmm}`;
        let g = groups.get(key);
        if (!g) {
          g = { key, branch_code: r.branch_code, yy: r.yy, mmm: r.mmm, rows: [], minSeq: r.seq, maxSeq: r.seq, missing: [], issued: 0, cancelled: 0, reserved: 0 };
          groups.set(key, g);
        }
        g.rows.push(r);
        g.minSeq = Math.min(g.minSeq, r.seq);
        g.maxSeq = Math.max(g.maxSeq, r.seq);
        if (r.status === "issued") g.issued++;
        else if (r.status === "cancelled") g.cancelled++;
        else g.reserved++;
      }
      // Flag any seq in the contiguous range with no register row.
      for (const g of groups.values()) {
        const present = new Set(g.rows.map((r) => r.seq));
        for (let s = g.minSeq; s <= g.maxSeq; s++) if (!present.has(s)) g.missing.push(s);
      }
      return [...groups.values()];
    },
  });
}
