import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, AlertTriangle, ClipboardCheck, Lock, RefreshCw } from "lucide-react";
import { useFiscalPeriods, useCurrentFiscalPeriod } from "@/hooks/useFiscalPeriodBalances";
import { format } from "date-fns";

interface ChecklistRow {
  key: string;
  label: string;
  count: number;
  detail?: string;
  blocking: boolean;
}

function useClosingChecklist(periodStart?: string, periodEnd?: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["closing_checklist", appUser?.tenant_id, periodStart, periodEnd],
    enabled: !!appUser?.tenant_id && !!periodStart && !!periodEnd,
    queryFn: async () => {
      const tid = appUser!.tenant_id;
      const inRange = (col: string, q: any) =>
        q.gte(col, periodStart!).lte(col, periodEnd!);

      const [grns, adj, dn, sr, pr, counts, bills] = await Promise.all([
        inRange("receipt_date", supabase.from("goods_receipt_notes" as any).select("id, grn_number, receipt_date, status").eq("tenant_id", tid).eq("status", "draft")),
        inRange("adjustment_date", supabase.from("stock_adjustments" as any).select("id, adjustment_number, adjustment_date, status").eq("tenant_id", tid).in("status", ["draft", "pending_approval"])),
        inRange("dispatch_date", supabase.from("delivery_notes" as any).select("id, dn_number, dispatch_date, status").eq("tenant_id", tid).eq("status", "draft")),
        inRange("return_date", supabase.from("sales_returns" as any).select("id, sr_number, return_date, status").eq("tenant_id", tid).eq("status", "draft")),
        inRange("return_date", supabase.from("purchase_returns" as any).select("id, pr_number, return_date, status").eq("tenant_id", tid).eq("status", "draft")),
        inRange("count_date", supabase.from("stock_counts" as any).select("id, count_number, count_date, status").eq("tenant_id", tid).in("status", ["draft", "in_progress", "counted"])),
        inRange("bill_date", supabase.from("supplier_bills" as any).select("id, bill_number, bill_date, status").eq("tenant_id", tid).eq("status", "draft")),
      ]);

      const rows: ChecklistRow[] = [
        { key: "grns", label: "Unposted Goods Receipts (GRNs)", count: (grns.data || []).length, blocking: true,
          detail: (grns.data || []).map((r: any) => r.grn_number).join(", ") },
        { key: "bills", label: "Draft Supplier Bills", count: (bills.data || []).length, blocking: true,
          detail: (bills.data || []).map((r: any) => r.bill_number).join(", ") },
        { key: "dn", label: "Unposted Delivery Notes", count: (dn.data || []).length, blocking: true,
          detail: (dn.data || []).map((r: any) => r.dn_number).join(", ") },
        { key: "adj", label: "Pending / Draft Stock Adjustments", count: (adj.data || []).length, blocking: true,
          detail: (adj.data || []).map((r: any) => r.adjustment_number).join(", ") },
        { key: "sr", label: "Draft Sales Returns", count: (sr.data || []).length, blocking: true,
          detail: (sr.data || []).map((r: any) => r.sr_number).join(", ") },
        { key: "pr", label: "Draft Purchase Returns", count: (pr.data || []).length, blocking: true,
          detail: (pr.data || []).map((r: any) => r.pr_number).join(", ") },
        { key: "counts", label: "Open Physical Counts", count: (counts.data || []).length, blocking: false,
          detail: (counts.data || []).map((r: any) => r.count_number).join(", ") },
      ];

      // GL ↔ Subledger reconciliation check
      let reconVariance = 0;
      try {
        const { data: rec } = await supabase.rpc("inventory_valuation_report" as any, { p_tenant_id: tid });
        const subledger = (rec || []).reduce((s: number, r: any) => s + Number(r.reported_value || 0), 0);
        const { data: lines } = await supabase
          .from("journal_lines")
          .select("debit, credit, account:accounts!inner(account_code, tenant_id), journal_entry:journal_entries!inner(status, voided_at)")
          .eq("account.tenant_id", tid)
          .eq("account.account_code", "1200");
        const gl = (lines || [])
          .filter((l: any) => l.journal_entry?.status === "posted" && !l.journal_entry?.voided_at)
          .reduce((s: number, l: any) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
        reconVariance = Math.round((gl - subledger) * 100) / 100;
      } catch { /* ignore */ }

      rows.push({
        key: "recon",
        label: "Inventory GL ↔ Subledger Reconciliation",
        count: Math.abs(reconVariance) < 0.01 ? 0 : 1,
        blocking: true,
        detail: Math.abs(reconVariance) < 0.01 ? "In balance" : `Variance: ${reconVariance.toFixed(2)} LKR`,
      });

      const totalBlocking = rows.filter((r) => r.blocking).reduce((s, r) => s + r.count, 0);
      return { rows, ready: totalBlocking === 0, totalBlocking };
    },
    staleTime: 30_000,
  });
}

export function PeriodClosingChecklist() {
  const { data: periods } = useFiscalPeriods();
  const current = useCurrentFiscalPeriod();
  const period = current || (periods || []).find((p: any) => p.status === "open");

  const { data, isLoading, refetch, isFetching } = useClosingChecklist(period?.period_start, period?.period_end);

  if (!period) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No open fiscal period found. Configure fiscal periods first.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" /> Period-End Closing Checklist
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Period: <span className="font-medium text-foreground">{period.name}</span>{" "}
            ({format(new Date(period.period_start), "MMM d")} → {format(new Date(period.period_end), "MMM d, yyyy")})
            {period.status === "closed" && <Badge variant="outline" className="ml-2"><Lock className="w-3 h-3 mr-1" />Closed</Badge>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div
              className={`mb-4 rounded-lg border p-4 flex items-center gap-3 ${
                data.ready ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
              }`}
            >
              {data.ready ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              )}
              <div>
                <p className="font-semibold">
                  {data.ready ? "Ready to close period" : `${data.totalBlocking} blocking item(s) outstanding`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.ready
                    ? "All inventory transactions are posted and the inventory ledger reconciles to GL 1200."
                    : "Resolve blocking items before locking this period."}
                </p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check</TableHead>
                  <TableHead className="text-right w-24">Count</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right font-mono">{r.count}</TableCell>
                    <TableCell>
                      {r.count === 0 ? (
                        <Badge className="bg-emerald-100 text-emerald-700">Clear</Badge>
                      ) : r.blocking ? (
                        <Badge className="bg-rose-100 text-rose-700">Blocking</Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700">Review</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[360px] truncate">
                      {r.detail || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
