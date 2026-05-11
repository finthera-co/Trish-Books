import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, Download, RefreshCw, Activity, CheckCircle2, XCircle,
  TrendingDown, BookOpen, Layers, BarChart3, Bell,
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { exportToCsv } from "@/lib/csvExport";
import { exportToPdf } from "@/lib/pdfExport";
import { FileDown } from "lucide-react";
import { format } from "date-fns";
import {
  useReorderReport, useStockAgingReport, useMovementAnalysis, useInventoryGLReconciliation,
} from "@/hooks/useInventoryReports";
import { useAbcAnalysis, useInventoryAlerts } from "@/hooks/useInventoryAnalytics";
import { InventoryValuationReport } from "./InventoryValuationReport";

export function InventoryReportsHub() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" /> Inventory Reports
        </h2>
        <p className="text-sm text-muted-foreground">
          Valuation, reorder, aging, movement velocity, and GL reconciliation.
        </p>
      </div>

      <Tabs defaultValue="valuation" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="valuation"><Layers className="w-4 h-4 mr-2" />Valuation</TabsTrigger>
          <TabsTrigger value="reconcile"><CheckCircle2 className="w-4 h-4 mr-2" />GL Reconciliation</TabsTrigger>
          <TabsTrigger value="reorder"><AlertTriangle className="w-4 h-4 mr-2" />Reorder</TabsTrigger>
          <TabsTrigger value="aging"><TrendingDown className="w-4 h-4 mr-2" />Aging</TabsTrigger>
          <TabsTrigger value="movement"><Activity className="w-4 h-4 mr-2" />Movement</TabsTrigger>
          <TabsTrigger value="abc"><BarChart3 className="w-4 h-4 mr-2" />ABC Analysis</TabsTrigger>
          <TabsTrigger value="alerts"><Bell className="w-4 h-4 mr-2" />Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="valuation"><InventoryValuationReport /></TabsContent>
        <TabsContent value="reconcile"><GLReconciliationCard /></TabsContent>
        <TabsContent value="reorder"><ReorderReportCard /></TabsContent>
        <TabsContent value="aging"><AgingReportCard /></TabsContent>
        <TabsContent value="movement"><MovementAnalysisCard /></TabsContent>
        <TabsContent value="abc"><AbcAnalysisCard /></TabsContent>
        <TabsContent value="alerts"><AlertsCard /></TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GL Reconciliation
// ────────────────────────────────────────────────────────────────────────────
function GLReconciliationCard() {
  const { data, isLoading, refetch, isFetching } = useInventoryGLReconciliation();

  const exportCsv = () => {
    if (!data) return;
    exportToCsv(
      `inventory-gl-reconcile-${format(new Date(), "yyyyMMdd")}.csv`,
      ["Item", "Reported Value"],
      [
        ...data.per_item.map((r) => [r.item_name, r.reported_value.toFixed(2)]),
        ["TOTAL Subledger", data.subledger_value.toFixed(2)],
        [`GL ${data.inventory_account_code} ${data.inventory_account_name}`, data.gl_balance.toFixed(2)],
        ["VARIANCE", data.variance.toFixed(2)],
      ]
    );
  };
  const exportPdf = () => {
    if (!data) return;
    exportToPdf(
      `inventory-gl-reconcile-${format(new Date(), "yyyyMMdd")}.pdf`,
      "Inventory ↔ GL Reconciliation",
      ["Item", "Reported Value (LKR)"],
      [
        ...data.per_item.map((r) => [r.item_name, r.reported_value.toFixed(2)]),
        ["TOTAL Subledger", data.subledger_value.toFixed(2)],
        [`GL ${data.inventory_account_code} ${data.inventory_account_name}`, data.gl_balance.toFixed(2)],
        ["VARIANCE", data.variance.toFixed(2)],
      ],
      { subtitle: data.is_reconciled ? "Status: Reconciled" : `Variance ${data.variance.toFixed(2)} LKR` }
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5" /> Inventory ↔ General Ledger Reconciliation
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
            <Download className="w-4 h-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={!data}>
            <FileDown className="w-4 h-4 mr-1" />PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">GL Balance ({data.inventory_account_code})</p>
                <p className="text-xl font-bold">{formatCurrency(data.gl_balance)}</p>
                <p className="text-xs text-muted-foreground mt-1">{data.inventory_account_name}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Subledger Value</p>
                <p className="text-xl font-bold">{formatCurrency(data.subledger_value)}</p>
                <p className="text-xs text-muted-foreground mt-1">From valuation engine</p>
              </div>
              <div className={`rounded-lg border p-4 ${data.is_reconciled ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
                <p className="text-xs text-muted-foreground">Variance</p>
                <p className={`text-xl font-bold ${data.is_reconciled ? "text-emerald-700" : "text-rose-700"}`}>
                  {formatCurrency(data.variance)}
                </p>
                <p className="text-xs mt-1 flex items-center gap-1">
                  {data.is_reconciled ? (
                    <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Reconciled</>
                  ) : (
                    <><XCircle className="w-3 h-3 text-rose-600" /> Out of balance</>
                  )}
                </p>
              </div>
            </div>

            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Reported Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.per_item.map((r) => (
                    <TableRow key={r.item_id}>
                      <TableCell>{r.item_name}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(r.reported_value)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Subledger Total</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(data.subledger_value)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Reorder
// ────────────────────────────────────────────────────────────────────────────
function ReorderReportCard() {
  const { data, isLoading } = useReorderReport();
  const rows = data || [];

  const exportCsv = () =>
    exportToCsv(
      `reorder-${format(new Date(), "yyyyMMdd")}.csv`,
      ["Code", "Item", "On Hand", "Reorder Level", "Shortfall", "Suggested Qty", "Unit Cost", "Est. PO Value"],
      rows.map((r: any) => [
        r.item_code || "",
        r.item_name,
        r.quantity_on_hand,
        r.reorder_level,
        r.shortfall,
        r.suggested_qty,
        Number(r.unit_cost || 0).toFixed(2),
        (Number(r.suggested_qty) * Number(r.unit_cost || 0)).toFixed(2),
      ])
    );

  const reorderRowsForExport = () => rows.map((r: any) => [
    r.item_code || "", r.item_name,
    Number(r.quantity_on_hand).toLocaleString(),
    Number(r.reorder_level).toLocaleString(),
    Number(r.shortfall).toLocaleString(),
    Number(r.suggested_qty).toLocaleString(),
    Number(r.unit_cost || 0).toFixed(2),
    (Number(r.suggested_qty) * Number(r.unit_cost || 0)).toFixed(2),
  ]);
  const exportPdf = () =>
    exportToPdf(
      `reorder-${format(new Date(), "yyyyMMdd")}.pdf`,
      "Reorder Report",
      ["Code", "Item", "On Hand", "Reorder Lvl", "Shortfall", "Suggested", "Unit Cost", "Est. Value"],
      reorderRowsForExport(),
      { subtitle: `${rows.length} item(s) below reorder level` }
    );

  const totalEstPO = rows.reduce(
    (s: number, r: any) => s + Number(r.suggested_qty) * Number(r.unit_cost || 0),
    0
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" /> Reorder Report
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={rows.length === 0}>
            <FileDown className="w-4 h-4 mr-1" />PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">All items above reorder level.</p>
        ) : (
          <>
            <div className="mb-3 text-sm text-muted-foreground">
              {rows.length} item(s) need reorder · Estimated total PO value:{" "}
              <span className="font-semibold text-foreground">{formatCurrency(totalEstPO)}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">On Hand</TableHead>
                  <TableHead className="text-right">Reorder Level</TableHead>
                  <TableHead className="text-right">Shortfall</TableHead>
                  <TableHead className="text-right">Suggested Qty</TableHead>
                  <TableHead className="text-right">Est. Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.item_code || "—"}</TableCell>
                    <TableCell>{r.item_name}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.quantity_on_hand).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.reorder_level).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-amber-700">{Number(r.shortfall).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{Number(r.suggested_qty).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(Number(r.suggested_qty) * Number(r.unit_cost || 0))}</TableCell>
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

// ────────────────────────────────────────────────────────────────────────────
// Aging
// ────────────────────────────────────────────────────────────────────────────
function AgingReportCard() {
  const { data, isLoading } = useStockAgingReport();
  const rows = data || [];
  const totals = rows.reduce(
    (acc, r) => ({
      b1: acc.b1 + r.bucket_0_30,
      b2: acc.b2 + r.bucket_31_60,
      b3: acc.b3 + r.bucket_61_90,
      b4: acc.b4 + r.bucket_90_plus,
      total: acc.total + r.total_value,
    }),
    { b1: 0, b2: 0, b3: 0, b4: 0, total: 0 }
  );

  const exportCsv = () =>
    exportToCsv(
      `inventory-aging-${format(new Date(), "yyyyMMdd")}.csv`,
      ["Code", "Item", "Qty", "0-30", "31-60", "61-90", "90+", "Total"],
      rows.map((r) => [
        r.item_code || "",
        r.item_name,
        r.qty_on_hand,
        r.bucket_0_30.toFixed(2),
        r.bucket_31_60.toFixed(2),
        r.bucket_61_90.toFixed(2),
        r.bucket_90_plus.toFixed(2),
        r.total_value.toFixed(2),
      ])
    );

  const exportPdf = () =>
    exportToPdf(
      `inventory-aging-${format(new Date(), "yyyyMMdd")}.pdf`,
      "Inventory Aging Report",
      ["Code", "Item", "Qty", "0-30", "31-60", "61-90", "90+", "Total"],
      rows.map((r) => [
        r.item_code || "", r.item_name, r.qty_on_hand,
        r.bucket_0_30.toFixed(2), r.bucket_31_60.toFixed(2),
        r.bucket_61_90.toFixed(2), r.bucket_90_plus.toFixed(2),
        r.total_value.toFixed(2),
      ]),
      { subtitle: `Total inventory value: ${totals.total.toFixed(2)} LKR` }
    );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="w-5 h-5" /> Inventory Aging
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={rows.length === 0}>
            <FileDown className="w-4 h-4 mr-1" />PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No stock to age.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Bucket label="0-30 days" value={totals.b1} tone="emerald" />
              <Bucket label="31-60 days" value={totals.b2} tone="blue" />
              <Bucket label="61-90 days" value={totals.b3} tone="amber" />
              <Bucket label="90+ days" value={totals.b4} tone="rose" />
              <Bucket label="Total" value={totals.total} tone="primary" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">0-30</TableHead>
                  <TableHead className="text-right">31-60</TableHead>
                  <TableHead className="text-right">61-90</TableHead>
                  <TableHead className="text-right">90+</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.item_id}>
                    <TableCell className="font-mono text-xs">{r.item_code || "—"}</TableCell>
                    <TableCell>{r.item_name}</TableCell>
                    <TableCell className="text-right font-mono">{r.qty_on_hand.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(r.bucket_0_30)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(r.bucket_31_60)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(r.bucket_61_90)}</TableCell>
                    <TableCell className={`text-right font-mono ${r.bucket_90_plus > 0 ? "text-rose-600 font-semibold" : ""}`}>
                      {formatCurrency(r.bucket_90_plus)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatCurrency(r.total_value)}</TableCell>
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

function Bucket({ label, value, tone }: { label: string; value: number; tone: string }) {
  const toneCls: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50",
    blue: "border-blue-200 bg-blue-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
    primary: "border-primary/30 bg-primary/5",
  };
  return (
    <div className={`rounded-lg border p-3 ${toneCls[tone]}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-bold">{formatCurrency(value)}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Movement Analysis
// ────────────────────────────────────────────────────────────────────────────
function MovementAnalysisCard() {
  const { data, isLoading } = useMovementAnalysis();
  const rows = data || [];

  const exportCsv = () =>
    exportToCsv(
      `movement-analysis-${format(new Date(), "yyyyMMdd")}.csv`,
      ["Code", "Item", "On Hand", "Outbound 90d", "Avg Daily", "Days of Supply", "Class", "Last Movement"],
      rows.map((r) => [
        r.item_code || "",
        r.item_name,
        r.qty_on_hand,
        r.outbound_qty_90d,
        r.avg_daily_consumption.toFixed(4),
        r.days_of_supply == null ? "" : r.days_of_supply.toFixed(1),
        r.classification,
        r.last_movement_date || "",
      ])
    );

  const counts = rows.reduce(
    (a, r) => ({ ...a, [r.classification]: (a as any)[r.classification] + 1 }),
    { fast: 0, medium: 0, slow: 0, dead: 0 } as any
  );

  const cls = (c: string) => {
    if (c === "fast") return "bg-emerald-100 text-emerald-700";
    if (c === "medium") return "bg-blue-100 text-blue-700";
    if (c === "slow") return "bg-amber-100 text-amber-700";
    return "bg-rose-100 text-rose-700";
  };

  const exportPdf = () =>
    exportToPdf(
      `movement-analysis-${format(new Date(), "yyyyMMdd")}.pdf`,
      "Movement Velocity (90 days)",
      ["Code", "Item", "On Hand", "Outbound 90d", "Avg/day", "Days Supply", "Class", "Last Move"],
      rows.map((r) => [
        r.item_code || "", r.item_name, r.qty_on_hand, r.outbound_qty_90d,
        r.avg_daily_consumption.toFixed(2),
        r.days_of_supply == null ? "∞" : r.days_of_supply.toFixed(0),
        r.classification, r.last_movement_date || "",
      ])
    );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" /> Movement Velocity (90 days)
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={rows.length === 0}>
            <FileDown className="w-4 h-4 mr-1" />PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No active items.</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4">
              {(["fast", "medium", "slow", "dead"] as const).map((c) => (
                <div key={c} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground capitalize">{c}-moving</p>
                  <p className="text-lg font-bold">{counts[c]}</p>
                </div>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">On Hand</TableHead>
                  <TableHead className="text-right">Outbound 90d</TableHead>
                  <TableHead className="text-right">Avg/day</TableHead>
                  <TableHead className="text-right">Days of Supply</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Last Movement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.item_id}>
                    <TableCell className="font-mono text-xs">{r.item_code || "—"}</TableCell>
                    <TableCell>{r.item_name}</TableCell>
                    <TableCell className="text-right font-mono">{r.qty_on_hand.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{r.outbound_qty_90d.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{r.avg_daily_consumption.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.days_of_supply == null ? "∞" : r.days_of_supply.toFixed(0)}
                    </TableCell>
                    <TableCell><Badge className={cls(r.classification)}>{r.classification}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_movement_date ? format(new Date(r.last_movement_date), "MMM d, yyyy") : "—"}
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

// ────────────────────────────────────────────────────────────────────────────
// ABC Analysis
// ────────────────────────────────────────────────────────────────────────────
function AbcAnalysisCard() {
  const { data, isLoading } = useAbcAnalysis();
  const rows = data || [];
  const counts = rows.reduce(
    (a, r) => ({ ...a, [r.abc_class]: (a as any)[r.abc_class] + 1 }),
    { A: 0, B: 0, C: 0 } as any,
  );
  const totals = rows.reduce(
    (a, r) => ({ ...a, [r.abc_class]: (a as any)[r.abc_class] + r.usage_value_90d }),
    { A: 0, B: 0, C: 0 } as any,
  );
  const exportCsv = () =>
    exportToCsv(
      `abc-analysis-${format(new Date(), "yyyyMMdd")}.csv`,
      ["Code", "Item", "Qty 90d", "Usage Value 90d", "Cumulative %", "Class"],
      rows.map((r) => [r.item_code || "", r.item_name, r.qty_consumed_90d, r.usage_value_90d.toFixed(2), r.cumulative_pct.toFixed(2), r.abc_class]),
    );
  const exportPdf = () =>
    exportToPdf(
      `abc-analysis-${format(new Date(), "yyyyMMdd")}.pdf`,
      "ABC Analysis (90-day usage value)",
      ["Code", "Item", "Qty 90d", "Usage Value", "Cumulative %", "Class"],
      rows.map((r) => [r.item_code || "", r.item_name, r.qty_consumed_90d, r.usage_value_90d.toFixed(2), r.cumulative_pct.toFixed(2) + "%", r.abc_class])
    );
  const cls = (c: string) => c === "A" ? "bg-emerald-100 text-emerald-700" : c === "B" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5" /> ABC Analysis (90-day usage value)</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={rows.length === 0}>
            <FileDown className="w-4 h-4 mr-1" />PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No usage data in the last 90 days.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {(["A", "B", "C"] as const).map((c) => (
                <div key={c} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Class {c} ({c === "A" ? "top 80%" : c === "B" ? "next 15%" : "last 5%"})</p>
                  <p className="text-base font-bold">{counts[c]} items · {formatCurrency(totals[c])}</p>
                </div>
              ))}
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead><TableHead>Item</TableHead>
                <TableHead className="text-right">Qty 90d</TableHead>
                <TableHead className="text-right">Usage Value</TableHead>
                <TableHead className="text-right">Cumulative %</TableHead>
                <TableHead>Class</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.item_id}>
                    <TableCell className="font-mono text-xs">{r.item_code || "—"}</TableCell>
                    <TableCell>{r.item_name}</TableCell>
                    <TableCell className="text-right font-mono">{r.qty_consumed_90d.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(r.usage_value_90d)}</TableCell>
                    <TableCell className="text-right font-mono">{r.cumulative_pct.toFixed(2)}%</TableCell>
                    <TableCell><Badge className={cls(r.abc_class)}>{r.abc_class}</Badge></TableCell>
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

// ────────────────────────────────────────────────────────────────────────────
// Alerts
// ────────────────────────────────────────────────────────────────────────────
function AlertsCard() {
  const { data, isLoading, refetch, isFetching } = useInventoryAlerts();
  const rows = data || [];
  const sevCls = (s: string) =>
    s === "critical" ? "bg-rose-100 text-rose-700" :
    s === "warning" ? "bg-amber-100 text-amber-700" :
    "bg-blue-100 text-blue-700";
  const counts = rows.reduce(
    (a, r) => ({ ...a, [r.severity]: (a as any)[r.severity] + 1 }),
    { critical: 0, warning: 0, info: 0 } as any,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" /> Inventory Alerts</CardTitle>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : rows.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No alerts. Inventory is healthy.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg border p-3 bg-rose-50 border-rose-200">
                <p className="text-xs text-muted-foreground">Critical</p>
                <p className="text-lg font-bold text-rose-700">{counts.critical}</p>
              </div>
              <div className="rounded-lg border p-3 bg-amber-50 border-amber-200">
                <p className="text-xs text-muted-foreground">Warning</p>
                <p className="text-lg font-bold text-amber-700">{counts.warning}</p>
              </div>
              <div className="rounded-lg border p-3 bg-blue-50 border-blue-200">
                <p className="text-xs text-muted-foreground">Info</p>
                <p className="text-lg font-bold text-blue-700">{counts.info}</p>
              </div>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Severity</TableHead><TableHead>Type</TableHead>
                <TableHead>Item</TableHead><TableHead>Message</TableHead><TableHead>Detail</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell><Badge className={sevCls(a.severity)}>{a.severity}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.type.replace(/_/g, " ")}</TableCell>
                    <TableCell>{a.item_code ? <span className="font-mono text-xs">{a.item_code} — </span> : null}{a.item_name}</TableCell>
                    <TableCell>{a.message}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.detail || "—"}</TableCell>
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
