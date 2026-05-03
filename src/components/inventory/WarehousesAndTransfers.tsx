import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Send, Warehouse as WarehouseIcon, ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import { useWarehouses, useCreateWarehouse, useStockTransfers, useCreateStockTransfer, usePostStockTransfer } from "@/hooks/useWarehouses";
import { useInventoryMaster } from "@/hooks/useProcurement";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  in_transit: "bg-amber-100 text-amber-700",
  posted: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

export function WarehousesTab() {
  const { data: list, isLoading } = useWarehouses();
  const create = useCreateWarehouse();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", address: "", is_default: false });

  const submit = async () => {
    if (!form.code || !form.name) return;
    await create.mutateAsync(form);
    setForm({ code: "", name: "", address: "", is_default: false });
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><WarehouseIcon className="w-5 h-5" />Warehouses</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Warehouse</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Warehouse</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></div>
                <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                Set as default warehouse
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={!form.code || !form.name || create.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (list || []).length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No warehouses yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Address</TableHead><TableHead>Default</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(list || []).map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono">{w.code}</TableCell>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell className="text-muted-foreground">{w.address || "—"}</TableCell>
                  <TableCell>{w.is_default ? <Badge>Default</Badge> : "—"}</TableCell>
                  <TableCell><Badge variant={w.is_active ? "default" : "secondary"}>{w.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface TransferLine { item_id: string; quantity: number; unit_cost: number }

export function TransfersTab() {
  const { data: transfers, isLoading } = useStockTransfers();
  const { data: warehouses } = useWarehouses();
  const post = usePostStockTransfer();
  const [open, setOpen] = useState(false);

  const whName = (id: string) => (warehouses || []).find((w) => w.id === id)?.name || id;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5" />Stock Transfers</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Transfer</Button></DialogTrigger>
          <TransferCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (transfers || []).length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No transfers yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer #</TableHead><TableHead>Date</TableHead><TableHead>From</TableHead><TableHead>To</TableHead>
                <TableHead>Status</TableHead><TableHead className="w-32">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(transfers || []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono">{t.transfer_number}</TableCell>
                  <TableCell>{format(new Date(t.transfer_date), "MMM d, yyyy")}</TableCell>
                  <TableCell>{whName(t.from_warehouse_id)}</TableCell>
                  <TableCell>{whName(t.to_warehouse_id)}</TableCell>
                  <TableCell><Badge className={STATUS_COLORS[t.status] || "bg-muted"}>{t.status}</Badge></TableCell>
                  <TableCell>
                    {t.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => post.mutate(t.id)} disabled={post.isPending}>
                        <Send className="w-3 h-3 mr-1" />Post
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
  );
}

function TransferCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: warehouses } = useWarehouses();
  const { data: items } = useInventoryMaster();
  const create = useCreateStockTransfer();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<TransferLine[]>([]);

  const addLine = () => setLines([...lines, { item_id: "", quantity: 1, unit_cost: 0 }]);
  const updateLine = (i: number, patch: Partial<TransferLine>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

  const submit = async () => {
    if (!from || !to || from === to) return;
    const valid = lines.filter((l) => l.item_id && l.quantity > 0);
    if (valid.length === 0) return;
    await create.mutateAsync({
      from_warehouse_id: from,
      to_warehouse_id: to,
      transfer_date: date,
      notes,
      lines: valid,
    });
    onClose();
  };

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>New Stock Transfer</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>From Warehouse *</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>{(warehouses || []).map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>To Warehouse *</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
              <SelectContent>{(warehouses || []).filter((w) => w.id !== from).map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Transfer Date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        <div className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label>Items</Label>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
          </div>
          {lines.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No lines.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Item</TableHead><TableHead className="w-24">Qty</TableHead>
                <TableHead className="w-32">Unit Cost</TableHead><TableHead className="text-right w-32">Total</TableHead><TableHead className="w-10" />
              </TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={l.item_id} onValueChange={(v) => {
                        const it = (items || []).find((x: any) => x.id === v);
                        updateLine(i, { item_id: v, unit_cost: it?.unit_cost ?? it?.standard_cost ?? 0 });
                      }}>
                        <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                        <SelectContent>{(items || []).filter((x: any) => x.is_active).map((x: any) => (
                          <SelectItem key={x.id} value={x.id}>{x.item_code} — {x.item_name}</SelectItem>
                        ))}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" step="0.0001" value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: Number(e.target.value) })} /></TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(l.quantity * l.unit_cost)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex justify-end font-semibold">Indicative Value: {formatCurrency(total)}</div>
        </div>

        <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">
          On posting: <strong>Out</strong> Dr 1310 In-Transit / Cr Inventory (source); <strong>In</strong> Dr Inventory (destination) / Cr 1310 In-Transit. FIFO items consume oldest lots at source.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!from || !to || from === to || lines.length === 0 || create.isPending}>Create Transfer</Button>
      </DialogFooter>
    </DialogContent>
  );
}
