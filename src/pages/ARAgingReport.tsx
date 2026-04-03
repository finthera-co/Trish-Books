import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { useARAging } from "@/hooks/useARModule";

export default function ARAgingReport() {
  const navigate = useNavigate();
  const { data: aging, isLoading } = useARAging();

  const totals = (aging || []).reduce(
    (acc, row) => ({
      current: acc.current + row.current,
      days_1_30: acc.days_1_30 + row.days_1_30,
      days_31_60: acc.days_31_60 + row.days_31_60,
      days_61_90: acc.days_61_90 + row.days_61_90,
      over_90: acc.over_90 + row.over_90,
      total: acc.total + row.total,
    }),
    { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0, total: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Clock className="w-6 h-6 text-destructive" /> AR Aging Report
            </h1>
            <p className="text-sm text-muted-foreground">Accounts receivable aging from AR subledger</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-3">
        <Card><CardContent className="pt-3 pb-3"><p className="text-xs text-muted-foreground">Current</p><p className="text-lg font-bold text-primary tabular-nums">{formatCurrency(totals.current)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-3"><p className="text-xs text-muted-foreground">1-30 Days</p><p className="text-lg font-bold text-warning tabular-nums">{formatCurrency(totals.days_1_30)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-3"><p className="text-xs text-muted-foreground">31-60 Days</p><p className="text-lg font-bold text-warning tabular-nums">{formatCurrency(totals.days_31_60)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-3"><p className="text-xs text-muted-foreground">61-90 Days</p><p className="text-lg font-bold text-destructive tabular-nums">{formatCurrency(totals.days_61_90)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-3"><p className="text-xs text-muted-foreground">Over 90</p><p className="text-lg font-bold text-destructive tabular-nums">{formatCurrency(totals.over_90)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-3"><p className="text-xs text-muted-foreground">Total AR</p><p className="text-lg font-bold text-foreground tabular-nums">{formatCurrency(totals.total)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Aging by Customer</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (aging || []).length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No outstanding receivables</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">1-30 Days</TableHead>
                  <TableHead className="text-right">31-60 Days</TableHead>
                  <TableHead className="text-right">61-90 Days</TableHead>
                  <TableHead className="text-right">Over 90</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(aging || []).map((row) => (
                  <TableRow
                    key={row.customer_id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/accounting/customers/${row.customer_id}`)}
                  >
                    <TableCell className="font-medium">{row.customer_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.current > 0 ? formatCurrency(row.current) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.days_1_30 > 0 ? formatCurrency(row.days_1_30) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.days_31_60 > 0 ? formatCurrency(row.days_31_60) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">{row.days_61_90 > 0 ? formatCurrency(row.days_61_90) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive font-semibold">{row.over_90 > 0 ? formatCurrency(row.over_90) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums font-bold">{formatCurrency(row.total)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-bold border-t-2 border-border">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(totals.current)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(totals.days_1_30)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(totals.days_31_60)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(totals.days_61_90)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(totals.over_90)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(totals.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
