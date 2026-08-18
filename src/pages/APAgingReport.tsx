import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, Printer, CheckCircle2, AlertTriangle, RefreshCw, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadDataExcel } from "@/lib/reportExcel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { useAPAging, useAPReconciliation } from "@/hooks/useAPModule";
import { formatDate } from "@/lib/format";

const BUCKETS = [
  { key: "current",     label: "Current",    color: "text-green-600" },
  { key: "days_1_30",   label: "1–30 Days",  color: "text-yellow-600" },
  { key: "days_31_60",  label: "31–60 Days", color: "text-orange-500" },
  { key: "days_61_90",  label: "61–90 Days", color: "text-red-500" },
  { key: "days_91_120", label: "91–120 Days",color: "text-red-700" },
  { key: "over_120",    label: "120+ Days",  color: "text-red-900" },
] as const;

export default function APAgingReport() {
  const navigate = useNavigate();
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split("T")[0]);

  const { data: aging, isLoading: agingLoading, refetch: refetchAging } = useAPAging(asOfDate);
  const { data: recon, isLoading: reconLoading, refetch: refetchRecon } = useAPReconciliation(asOfDate);

  const rows    = aging?.rows    ?? [];
  const totals  = aging?.totals  ?? { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, over_120: 0, grand_total: 0 };
  const isLoading = agingLoading || reconLoading;

  const handleRefresh = () => { refetchAging(); refetchRecon(); };

  const handleExportCSV = () => {
    const header = ["Vendor", "Current", "1-30 Days", "31-60 Days", "61-90 Days", "91-120 Days", "120+ Days", "Total"];
    const dataRows = rows.map((r) => [
      r.vendor_name,
      r.current.toFixed(2), r.days_1_30.toFixed(2), r.days_31_60.toFixed(2),
      r.days_61_90.toFixed(2), r.days_91_120.toFixed(2), r.over_120.toFixed(2),
      r.total.toFixed(2),
    ]);
    const totalRow = [
      "TOTAL",
      totals.current.toFixed(2), totals.days_1_30.toFixed(2), totals.days_31_60.toFixed(2),
      totals.days_61_90.toFixed(2), totals.days_91_120.toFixed(2), totals.over_120.toFixed(2),
      totals.grand_total.toFixed(2),
    ];
    const csv = [header, ...dataRows, totalRow].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ap-aging-${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    downloadDataExcel(
      {
        title: "AP Aging Report",
        subtitle: "Outstanding payables by age from due date",
        dateLine: `As of ${asOfDate}`,
        fileName: `AP Aging ${asOfDate}.xlsx`,
      },
      [
        { header: "Vendor", value: (r: typeof rows[number]) => r.vendor_name },
        ...BUCKETS.map((b) => ({
          header: b.label,
          numeric: true,
          value: (r: typeof rows[number]) => Number(r[b.key as keyof typeof r] ?? 0),
        })),
        { header: "Total", numeric: true, value: (r: typeof rows[number]) => Number(r.total) },
      ],
      rows,
      ["TOTAL", ...BUCKETS.map((b) => Number(totals[b.key as keyof typeof totals] ?? 0)), Number(totals.grand_total)],
    );
  };

  return (
    <div className="space-y-6 print:space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="print:hidden">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Clock className="w-6 h-6 text-destructive" />
              AP Aging Report
            </h1>
            <p className="text-sm text-muted-foreground">Outstanding payables by age from due date</p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="text-sm border border-input rounded-lg px-3 py-1.5 bg-background"
          />
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={rows.length === 0}>
            <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Export Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1.5" /> Print
          </Button>
        </div>
      </div>

      {/* ── GL Reconciliation Panel ── */}
      {recon && (
        <div className={`rounded-lg border px-5 py-4 flex flex-wrap items-center gap-6 ${
          recon.status === "RECONCILED"
            ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
            : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
        }`}>
          <div className="flex items-center gap-2.5">
            {recon.status === "RECONCILED" ? (
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
            )}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">GL Reconciliation</p>
              <Badge
                className={`mt-0.5 text-xs font-semibold ${
                  recon.status === "RECONCILED"
                    ? "bg-green-100 text-green-800 border-green-300"
                    : "bg-red-100 text-red-800 border-red-300"
                }`}
                variant="outline"
              >
                {recon.status === "RECONCILED" ? "RECONCILED" : "VARIANCE DETECTED"}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Sub-ledger Total</p>
              <p className="font-bold tabular-nums text-foreground">{formatCurrency(recon.subledger_balance)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">GL Control Account (2100)</p>
              <p className="font-bold tabular-nums text-foreground">{formatCurrency(recon.gl_balance)}</p>
            </div>
            {Math.abs(recon.variance) >= 0.01 && (
              <div>
                <p className="text-xs text-muted-foreground">Variance</p>
                <p className="font-bold tabular-nums text-red-600">{formatCurrency(recon.variance)}</p>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground ml-auto">As of {formatDate(recon.as_of_date)}</p>
        </div>
      )}

      {reconLoading && (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-5 py-3 text-sm text-muted-foreground">
          Checking GL reconciliation…
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-7 gap-3">
        {BUCKETS.map((b) => (
          <Card key={b.key} className="shadow-sm">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p className={`text-lg font-bold tabular-nums ${b.color}`}>
                {formatCurrency(totals[b.key as keyof typeof totals] as number)}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card className="shadow-sm border-foreground/20">
          <CardContent className="pt-3 pb-3">
            <p className="text-xs text-muted-foreground font-semibold">Total AP</p>
            <p className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(totals.grand_total)}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Detail Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Aging by Vendor</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-10 text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">No outstanding payables</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="min-w-[160px]">Vendor</TableHead>
                    {BUCKETS.map((b) => (
                      <TableHead key={b.key} className="text-right min-w-[100px]">{b.label}</TableHead>
                    ))}
                    <TableHead className="text-right min-w-[110px] font-semibold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.vendor_id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => navigate(`/accounting/vendors/${row.vendor_id}`)}
                    >
                      <TableCell className="font-medium text-primary underline-offset-2 hover:underline">{row.vendor_name}</TableCell>
                      <TableCell className="text-right tabular-nums text-green-700">
                        {row.current > 0 ? formatCurrency(row.current) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-yellow-700">
                        {row.days_1_30 > 0 ? formatCurrency(row.days_1_30) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-orange-600">
                        {row.days_31_60 > 0 ? formatCurrency(row.days_31_60) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-600">
                        {row.days_61_90 > 0 ? formatCurrency(row.days_61_90) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-700 font-medium">
                        {row.days_91_120 > 0 ? formatCurrency(row.days_91_120) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-900 font-semibold">
                        {row.over_120 > 0 ? formatCurrency(row.over_120) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold">{formatCurrency(row.total)}</TableCell>
                    </TableRow>
                  ))}

                  {/* Totals row */}
                  <TableRow className="bg-muted/40 font-bold border-t-2 border-border">
                    <TableCell>TOTAL</TableCell>
                    {BUCKETS.map((b) => (
                      <TableCell key={b.key} className={`text-right tabular-nums ${b.color}`}>
                        {formatCurrency(totals[b.key as keyof typeof totals] as number)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums text-foreground">
                      {formatCurrency(totals.grand_total)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Footer note ── */}
      <p className="text-xs text-muted-foreground text-center print:block">
        Report as of {asOfDate} — aging buckets are from invoice due date. Grand total must equal GL AP control account (2100) balance.
      </p>
    </div>
  );
}
