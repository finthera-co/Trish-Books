import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronRight, Layers, Package } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useInventoryValuation, useStockLots, type ValuationRow } from "@/hooks/useInventoryValuation";
import { format } from "date-fns";

export function InventoryValuationReport() {
  const { data, isLoading } = useInventoryValuation();
  const [drilldown, setDrilldown] = useState<ValuationRow | null>(null);

  const totalReported = (data || []).reduce((s, r) => s + Number(r.reported_value || 0), 0);
  const totalQty = (data || []).reduce((s, r) => s + Number(r.qty_on_hand || 0), 0);
  const fifoCount = (data || []).filter((r) => r.valuation_method === "fifo").length;
  const wacCount = (data || []).filter((r) => r.valuation_method === "wac").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Reported Value</p>
            <p className="text-2xl font-bold text-primary">{formatCurrency(totalReported)}</p>
            <p className="text-xs text-muted-foreground mt-1">Reconciles to GL 1300</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Items</p>
            <p className="text-2xl font-bold">{(data || []).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Qty On Hand</p>
            <p className="text-2xl font-bold">{totalQty.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Method Mix</p>
            <p className="text-sm font-medium">
              <span className="text-emerald-600">{fifoCount} FIFO</span> · <span>{wacCount} WAC</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" /> Inventory Valuation
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (data || []).length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No active inventory items.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Cost (WAC)</TableHead>
                  <TableHead className="text-right">WAC Value</TableHead>
                  <TableHead className="text-right">FIFO Value</TableHead>
                  <TableHead className="text-right">Reported</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data || []).map((r) => (
                  <TableRow key={r.item_id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.item_code || "—"}</TableCell>
                    <TableCell className="font-medium">{r.item_name}</TableCell>
                    <TableCell>
                      <Badge variant={r.valuation_method === "fifo" ? "default" : "secondary"}>
                        {r.valuation_method.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{Number(r.qty_on_hand).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(r.unit_cost)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(r.wac_value)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(r.fifo_value)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatCurrency(r.reported_value)}</TableCell>
                    <TableCell>
                      {r.valuation_method === "fifo" && (
                        <Button variant="ghost" size="icon" onClick={() => setDrilldown(r)}>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!drilldown} onOpenChange={(v) => !v && setDrilldown(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" /> FIFO Lots — {drilldown?.item_name}
            </DialogTitle>
          </DialogHeader>
          {drilldown && <LotList itemId={drilldown.item_id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LotList({ itemId }: { itemId: string }) {
  const { data: lots, isLoading } = useStockLots(itemId);
  if (isLoading) return <p className="text-muted-foreground">Loading lots…</p>;
  if (!lots || lots.length === 0) return <p className="text-muted-foreground">No lots recorded.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lot #</TableHead>
          <TableHead>Receipt Date</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Remaining</TableHead>
          <TableHead className="text-right">Unit Cost</TableHead>
          <TableHead className="text-right">Lot Value</TableHead>
          <TableHead>Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lots.map((l) => (
          <TableRow key={l.id} className={l.is_exhausted ? "opacity-50" : ""}>
            <TableCell className="font-mono text-xs">{l.lot_number}</TableCell>
            <TableCell>{format(new Date(l.receipt_date), "MMM d, yyyy")}</TableCell>
            <TableCell className="text-right font-mono">{Number(l.qty_received).toLocaleString()}</TableCell>
            <TableCell className="text-right font-mono">{Number(l.qty_remaining).toLocaleString()}</TableCell>
            <TableCell className="text-right font-mono">{formatCurrency(l.unit_cost)}</TableCell>
            <TableCell className="text-right font-mono">
              {formatCurrency(Number(l.qty_remaining) * Number(l.unit_cost))}
            </TableCell>
            <TableCell><Badge variant="outline">{l.source_type}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
