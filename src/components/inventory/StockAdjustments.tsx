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
import { Plus, Trash2, Send, CheckCircle2, XCircle, ClipboardEdit } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import { useInventoryMaster } from "@/hooks/useProcurement";
import { useWarehouses } from "@/hooks/useWarehouses";
import {
  useStockAdjustments, useCreateStockAdjustment,
  useSubmitAdjustment, useApproveAdjustment, useRejectAdjustment,
  type AdjustmentLineInput, type AdjustmentType,
} from "@/hooks/useStockAdjustments";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-amber-100 text-amber-700",
  posted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-700",
};

const TYPE_LABELS: Record<AdjustmentType, string> = {
  count: "Stock Count",
  writeoff: "Write-off",
  writeup: "Write-up",
  damage: "Damage",
  loss: "Loss / Theft",
  found: "Found",
};

export function StockAdjustmentsTab() {
  const { data: list = [], isLoading } = useStockAdjustments();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardEdit className="w-5 h-5 text-primary" /> Stock Adjustments
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Count, write-off, damage and write-up adjustments. Posts to GL: Dr/Cr Inventory ↔ Inventory Adjustments (5200).
          </p>
        </div>
        <NewAdjustmentDialog />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            No adjustments yet. Create one to begin.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((a: any) => (
                <AdjRow key={a.id} adj={a} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AdjRow({ adj }: { adj: any }) {
  const submit = useSubmitAdjustment();
  const approve = useApproveAdjustment();
  const reject = useRejectAdjustment();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{adj.adjustment_number}</TableCell>
      <TableCell>{format(new Date(adj.adjustment_date), "yyyy-MM-dd")}</TableCell>
      <TableCell>{TYPE_LABELS[adj.adjustment_type as AdjustmentType] || adj.adjustment_type}</TableCell>
      <TableCell>{adj.warehouse?.name || "—"}</TableCell>
      <TableCell className="max-w-[220px] truncate">{adj.reason || "—"}</TableCell>
      <TableCell className="text-right">{formatCurrency(Number(adj.total_value || 0))}</TableCell>
      <TableCell>
        <Badge className={STATUS_COLORS[adj.status]}>{adj.status.replace("_", " ")}</Badge>
      </TableCell>
      <TableCell className="text-right space-x-2">
        {adj.status === "draft" && (
          <Button size="sm" onClick={() => submit.mutate({ p_adjustment_id: adj.id })} disabled={submit.isPending}>
            <Send className="w-3 h-3 mr-1" /> Submit
          </Button>
        )}
        {adj.status === "pending_approval" && (
          <>
            <Button size="sm" variant="default" onClick={() => approve.mutate({ p_adjustment_id: adj.id })} disabled={approve.isPending}>
              <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
            </Button>
            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <XCircle className="w-3 h-3 mr-1" /> Reject
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reject adjustment {adj.adjustment_number}</DialogTitle>
                </DialogHeader>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason…" />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => {
                      reject.mutate({ id: adj.id, reason });
                      setRejectOpen(false);
                    }}
                    disabled={!reason.trim()}
                  >
                    Confirm reject
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

function NewAdjustmentDialog() {
  const [open, setOpen] = useState(false);
  const { data: items = [] } = useInventoryMaster();
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreateStockAdjustment();

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [type, setType] = useState<AdjustmentType>("count");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<AdjustmentLineInput[]>([
    { item_id: "", qty_delta: 0, unit_cost: 0 },
  ]);

  const addLine = () => setLines([...lines, { item_id: "", qty_delta: 0, unit_cost: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<AdjustmentLineInput>) => {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const total = lines.reduce((s, l) => s + Math.abs(l.qty_delta) * l.unit_cost, 0);
  const valid = lines.length > 0 && lines.every((l) => l.item_id && l.qty_delta !== 0 && l.unit_cost >= 0);

  const reset = () => {
    setDate(format(new Date(), "yyyy-MM-dd"));
    setType("count");
    setWarehouseId("");
    setReason("");
    setNotes("");
    setLines([{ item_id: "", qty_delta: 0, unit_cost: 0 }]);
  };

  const submit = async () => {
    await create.mutateAsync({
      adjustment_date: date,
      warehouse_id: warehouseId || null,
      adjustment_type: type,
      reason,
      notes,
      lines,
    });
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" /> New Adjustment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Stock Adjustment</DialogTitle>
          <DialogDescription>
            Use negative qty for decreases (write-off, damage, loss). Use positive qty for write-ups / found stock.
            Adjustments above the tenant threshold require approval.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AdjustmentType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as AdjustmentType[]).map((k) => (
                  <SelectItem key={k} value={k}>{TYPE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
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
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for adjustment" />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label>Lines</Label>
            <Button size="sm" variant="outline" onClick={addLine}>
              <Plus className="w-3 h-3 mr-1" /> Add line
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-[120px] text-right">Qty Δ (signed)</TableHead>
                <TableHead className="w-[120px] text-right">Unit Cost</TableHead>
                <TableHead className="w-[120px] text-right">Value</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => {
                const item = items.find((it: any) => it.id === l.item_id);
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <Select
                        value={l.item_id}
                        onValueChange={(v) => {
                          const it: any = items.find((x: any) => x.id === v);
                          updateLine(i, { item_id: v, unit_cost: l.unit_cost || Number(it?.unit_cost || 0) });
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                        <SelectContent>
                          {items.map((it: any) => (
                            <SelectItem key={it.id} value={it.id}>
                              {it.item_code ? `${it.item_code} — ` : ""}{it.item_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {item && (
                        <div className="text-xs text-muted-foreground mt-1">
                          On hand: {Number(item.quantity_on_hand || 0)} • Avg cost: {formatCurrency(Number(item.unit_cost || 0))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        className="text-right"
                        value={l.qty_delta}
                        onChange={(e) => updateLine(i, { qty_delta: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right"
                        value={l.unit_cost}
                        onChange={(e) => updateLine(i, { unit_cost: Number(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Math.abs(l.qty_delta) * l.unit_cost)}
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => removeLine(i)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex justify-end font-medium">
            Total: {formatCurrency(total)}
          </div>
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
