import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, ClipboardList, Play, Send, XCircle } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import { useWarehouses } from "@/hooks/useWarehouses";
import {
  useStockCounts, useCreateStockCount, useStartCount, usePostCount, useCancelCount,
  useStockCountLines, useUpdateCountedQty, type StockCount, type CountStatus,
} from "@/hooks/usePhysicalCounts";

const STATUS_COLORS: Record<CountStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-100 text-amber-700",
  counted: "bg-blue-100 text-blue-700",
  posted: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

export function PhysicalCountsTab() {
  const { data: counts = [], isLoading } = useStockCounts();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" /> Physical Stock Counts
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Snapshot system quantities, enter counted qty, post variances to GL via stock adjustments.
          </p>
        </div>
        <NewCountDialog />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : counts.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            No counts yet. Start one to begin a physical inventory.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Variance Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counts.map((c) => (
                <CountRow key={c.id} count={c} onOpen={() => setOpenId(c.id)} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CountSheetDialog countId={openId} onClose={() => setOpenId(null)} />
    </Card>
  );
}

function CountRow({ count: c, onOpen }: { count: StockCount; onOpen: () => void }) {
  const cancel = useCancelCount();
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{c.count_number}</TableCell>
      <TableCell>{format(new Date(c.count_date), "yyyy-MM-dd")}</TableCell>
      <TableCell>{c.warehouse?.name || "All"}</TableCell>
      <TableCell className="max-w-[220px] truncate">{c.reason || "—"}</TableCell>
      <TableCell className="text-right">{formatCurrency(Number(c.total_variance_value || 0))}</TableCell>
      <TableCell><Badge className={STATUS_COLORS[c.status]}>{c.status.replace("_"," ")}</Badge></TableCell>
      <TableCell className="text-right space-x-2">
        <Button size="sm" variant="outline" onClick={onOpen}>Open</Button>
        {(c.status === "draft" || c.status === "in_progress" || c.status === "counted") && (
          <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ p_count_id: c.id })}>
            <XCircle className="w-3 h-3 mr-1" /> Cancel
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function NewCountDialog() {
  const [open, setOpen] = useState(false);
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreateStockCount();

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [whId, setWhId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    await create.mutateAsync({
      count_date: date,
      warehouse_id: whId || null,
      reason,
      notes,
    });
    setReason(""); setNotes(""); setWhId("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" /> New Count</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Physical Count</DialogTitle>
          <DialogDescription>
            Create a count sheet, then snapshot system quantities and capture counted qty per item.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Warehouse (optional)</Label>
            <Select value={whId} onValueChange={setWhId}>
              <SelectTrigger><SelectValue placeholder="All warehouses" /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Reason</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Year-end count" />
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CountSheetDialog({ countId, onClose }: { countId: string | null; onClose: () => void }) {
  const open = !!countId;
  const { data: lines = [], isLoading } = useStockCountLines(countId || undefined);
  const { data: counts = [] } = useStockCounts();
  const header = counts.find((c) => c.id === countId);
  const start = useStartCount();
  const post = usePostCount();
  const update = useUpdateCountedQty();

  const totalVariance = lines.reduce((s, l) => {
    const cq = l.counted_qty;
    if (cq === null || cq === undefined) return s;
    return s + Math.abs(cq - Number(l.system_qty)) * Number(l.unit_cost || 0);
  }, 0);

  const filledCount = lines.filter((l) => l.counted_qty !== null && l.counted_qty !== undefined).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            Count Sheet {header?.count_number}
            {header && <Badge className={`ml-2 ${STATUS_COLORS[header.status]}`}>{header.status.replace("_"," ")}</Badge>}
          </DialogTitle>
          <DialogDescription>
            System qty was snapshotted at start. Enter the counted qty per item; variances post on submit.
          </DialogDescription>
        </DialogHeader>

        {header?.status === "draft" && (
          <div className="flex justify-between items-center bg-muted/40 p-3 rounded">
            <div className="text-sm">No snapshot yet. Generate one to begin counting.</div>
            <Button onClick={() => start.mutate({ p_count_id: header.id })} disabled={start.isPending}>
              <Play className="w-4 h-4 mr-1" /> Snapshot system qty
            </Button>
          </div>
        )}

        {(header?.status === "in_progress" || header?.status === "counted" || header?.status === "posted") && (
          <>
            <div className="text-xs text-muted-foreground">
              {filledCount} of {lines.length} items counted • Estimated variance value: <strong>{formatCurrency(totalVariance)}</strong>
            </div>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="max-h-[55vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">System Qty</TableHead>
                      <TableHead className="text-right w-[140px]">Counted Qty</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">Variance Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => {
                      const cq = l.counted_qty;
                      const variance = cq !== null && cq !== undefined ? Number(cq) - Number(l.system_qty) : null;
                      const value = variance !== null ? Math.abs(variance) * Number(l.unit_cost || 0) : 0;
                      return (
                        <TableRow key={l.id}>
                          <TableCell>
                            {l.item?.item_code ? `${l.item.item_code} — ` : ""}{l.item?.item_name}
                          </TableCell>
                          <TableCell className="text-right">{Number(l.system_qty)}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.01"
                              className="text-right"
                              defaultValue={cq ?? ""}
                              disabled={header?.status === "posted"}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                update.mutate({ id: l.id, counted_qty: v === "" ? null : Number(v) });
                              }}
                            />
                          </TableCell>
                          <TableCell className={`text-right ${variance && variance < 0 ? "text-rose-600" : variance && variance > 0 ? "text-emerald-600" : ""}`}>
                            {variance === null ? "—" : variance.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(l.unit_cost || 0))}</TableCell>
                          <TableCell className="text-right">{formatCurrency(value)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {header && (header.status === "in_progress" || header.status === "counted") && (
            <Button
              onClick={async () => {
                await post.mutateAsync({ p_count_id: header.id });
                onClose();
              }}
              disabled={post.isPending}
            >
              <Send className="w-4 h-4 mr-1" /> Post variances
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
