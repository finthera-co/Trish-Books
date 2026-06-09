import { useMemo, useState } from "react";
import { CheckCircle2, CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { formatDistanceToNow } from "date-fns";
import { useSupplierBills } from "@/hooks/useProcurement";
import PayBillsDialog from "@/components/ap/PayBillsDialog";
import { computeBillStatus } from "@/lib/billStatus";

export default function PayBillsPage() {
  const { data: allBills, isLoading } = useSupplierBills();
  const [payDialog, setPayDialog] = useState<{ vendorId: string; vendorName: string } | null>(null);

  const vendorGroups = useMemo(() => {
    const open = (allBills ?? []).filter((b: any) => {
      const st = computeBillStatus(b);
      return st === "posted" || st === "partial" || st === "overdue";
    });

    const map = new Map<string, { vendorId: string; vendorName: string; bills: any[] }>();
    for (const b of open) {
      const vid = b.vendor_id;
      if (!map.has(vid)) {
        map.set(vid, { vendorId: vid, vendorName: b.vendor?.name ?? "Unknown", bills: [] });
      }
      map.get(vid)!.bills.push(b);
    }

    return Array.from(map.values()).map((g) => ({
      ...g,
      totalOutstanding: g.bills.reduce(
        (s, b) => s + (Number(b.total_amount) - Number(b.amount_paid ?? 0)),
        0
      ),
      oldestDue: g.bills
        .filter((b) => b.due_date)
        .map((b) => new Date(b.due_date))
        .sort((a, z) => a.getTime() - z.getTime())[0] ?? null,
      hasOverdue: g.bills.some((b) => computeBillStatus(b) === "overdue"),
    }));
  }, [allBills]);

  const totalOutstanding = vendorGroups.reduce((s, g) => s + g.totalOutstanding, 0);
  const totalOverdue = vendorGroups
    .filter((g) => g.hasOverdue)
    .reduce((s, g) => s + g.totalOutstanding, 0);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pay Bills</h1>
        <p className="text-sm text-muted-foreground">Settle outstanding supplier balances</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Outstanding</p>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-2xl font-bold text-destructive">{formatCurrency(totalOverdue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Vendors with Open Bills</p>
            <p className="text-2xl font-bold">{vendorGroups.length}</p>
          </CardContent>
        </Card>
      </div>

      {vendorGroups.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <p className="text-lg font-medium">All caught up!</p>
            <p className="text-sm">No outstanding supplier bills.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Outstanding by Vendor</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-center">Open Bills</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Oldest Due</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorGroups.map((g) => (
                  <TableRow key={g.vendorId}>
                    <TableCell className="font-medium">{g.vendorName}</TableCell>
                    <TableCell className="text-center">{g.bills.length}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(g.totalOutstanding)}
                    </TableCell>
                    <TableCell>
                      {g.oldestDue ? (
                        <span className={g.hasOverdue ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {formatDistanceToNow(g.oldestDue, { addSuffix: true })}
                          {g.hasOverdue && (
                            <Badge variant="destructive" className="ml-2 text-xs">Overdue</Badge>
                          )}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => setPayDialog({ vendorId: g.vendorId, vendorName: g.vendorName })}
                      >
                        <CreditCard className="w-3 h-3 mr-1" /> Pay
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {payDialog && (
        <PayBillsDialog
          open={!!payDialog}
          onOpenChange={(v) => { if (!v) setPayDialog(null); }}
          vendorId={payDialog.vendorId}
          vendorName={payDialog.vendorName}
        />
      )}
    </div>
  );
}
