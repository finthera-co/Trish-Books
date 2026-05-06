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
import { Plus, Trash2, Send, Truck, RotateCcw, PackageX } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import { useInventoryMaster } from "@/hooks/useProcurement";
import { useWarehouses } from "@/hooks/useWarehouses";
import { useCustomers } from "@/hooks/useData";
import { useVendors } from "@/hooks/useSubledger";
import {
  useDeliveryNotes, useCreateDeliveryNote, usePostDeliveryNote,
  useSalesReturns, useCreateSalesReturn, usePostSalesReturn,
  usePurchaseReturns, useCreatePurchaseReturn, usePostPurchaseReturn,
} from "@/hooks/useSalesInventory";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  posted: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-700",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge className={STATUS_COLORS[status] || "bg-muted"}>{status}</Badge>;
}

// ────────────────────────────────────────────────────────────
// DELIVERY NOTES
// ────────────────────────────────────────────────────────────
export function DeliveryNotesTab() {
  const { data: list = [], isLoading } = useDeliveryNotes();
  const post = usePostDeliveryNote();
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Truck className="w-5 h-5 text-primary" /> Delivery Notes</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New DN</Button></DialogTrigger>
          <DNCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : list.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No delivery notes yet. Issue stock to customers and post COGS automatically.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>DN #</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">COGS</TableHead><TableHead>Status</TableHead><TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono">{d.dn_number}</TableCell>
                  <TableCell>{format(new Date(d.dispatch_date), "PP")}</TableCell>
                  <TableCell>{d.customers?.name || "—"}</TableCell>
                  <TableCell>{d.warehouses?.name || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(d.total_cogs)}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell>
                    {d.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => post.mutate(d.id)} disabled={post.isPending}>
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

function DNCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: items = [] } = useInventoryMaster();
  const { data: customers = [] } = useCustomers();
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreateDeliveryNote();
  const [customerId, setCustomerId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ item_id: string; qty: number }[]>([{ item_id: "", qty: 1 }]);

  const addLine = () => setLines([...lines, { item_id: "", qty: 1 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, x) => x !== i));
  const updateLine = (i: number, patch: Partial<{ item_id: string; qty: number }>) =>
    setLines(lines.map((l, x) => (x === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    const valid = lines.filter((l) => l.item_id && l.qty > 0);
    if (valid.length === 0) return;
    await create.mutateAsync({
      customer_id: customerId || undefined,
      warehouse_id: warehouseId || undefined,
      dispatch_date: date,
      notes,
      lines: valid,
    });
    onClose();
  };

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>New Delivery Note</DialogTitle>
        <DialogDescription>Issues stock from inventory and posts COGS on save.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-3">
        <div><Label>Customer</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
            <SelectContent>{customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
            <SelectContent>{warehouses.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Dispatch Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2"><Label>Items</Label>
          <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-3 h-3 mr-1" />Add</Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-32">Qty</TableHead><TableHead className="w-32">On Hand</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>
            {lines.map((l, i) => {
              const item = items.find((it: any) => it.id === l.item_id);
              return (
                <TableRow key={i}>
                  <TableCell>
                    <Select value={l.item_id} onValueChange={(v) => updateLine(i, { item_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>{items.map((it: any) => <SelectItem key={it.id} value={it.id}>{it.item_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.qty} onChange={(e) => updateLine(i, { qty: parseFloat(e.target.value) || 0 })} /></TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{item?.quantity_on_hand ?? "—"}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={create.isPending}>Create Delivery Note</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ────────────────────────────────────────────────────────────
// SALES RETURNS
// ────────────────────────────────────────────────────────────
export function SalesReturnsTab() {
  const { data: list = [], isLoading } = useSalesReturns();
  const post = usePostSalesReturn();
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><RotateCcw className="w-5 h-5 text-primary" /> Sales Returns</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Sales Return</Button></DialogTrigger>
          <SRCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : list.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No sales returns yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SR #</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
                <TableHead className="text-right">Refund</TableHead><TableHead className="text-right">COGS Reversed</TableHead>
                <TableHead>Status</TableHead><TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono">{s.sr_number}</TableCell>
                  <TableCell>{format(new Date(s.return_date), "PP")}</TableCell>
                  <TableCell>{s.customers?.name || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(s.total_amount)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(s.total_cogs)}</TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell>
                    {s.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => post.mutate(s.id)} disabled={post.isPending}>
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

function SRCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: items = [] } = useInventoryMaster();
  const { data: customers = [] } = useCustomers();
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreateSalesReturn();
  const [customerId, setCustomerId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<{ item_id: string; qty: number; unit_price: number; unit_cost: number }[]>(
    [{ item_id: "", qty: 1, unit_price: 0, unit_cost: 0 }]
  );

  const addLine = () => setLines([...lines, { item_id: "", qty: 1, unit_price: 0, unit_cost: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, x) => x !== i));
  const updateLine = (i: number, patch: Partial<typeof lines[0]>) =>
    setLines(lines.map((l, x) => {
      if (x !== i) return l;
      const merged = { ...l, ...patch };
      if (patch.item_id) {
        const it = items.find((x: any) => x.id === patch.item_id);
        if (it) {
          merged.unit_price = Number(it.selling_price || 0);
          merged.unit_cost = Number(it.unit_cost || 0);
        }
      }
      return merged;
    }));

  const submit = async () => {
    const valid = lines.filter((l) => l.item_id && l.qty > 0);
    if (valid.length === 0) return;
    await create.mutateAsync({
      customer_id: customerId || undefined,
      warehouse_id: warehouseId || undefined,
      return_date: date,
      reason,
      lines: valid,
    });
    onClose();
  };

  const totalRefund = lines.reduce((s, l) => s + (l.qty * l.unit_price || 0), 0);

  return (
    <DialogContent className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>New Sales Return</DialogTitle>
        <DialogDescription>Restocks inventory at original cost and reverses revenue & COGS.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-3">
        <div><Label>Customer</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
            <SelectContent>{customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Warehouse (Restock)</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
            <SelectContent>{warehouses.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Return Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2"><Label>Items</Label>
          <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-3 h-3 mr-1" />Add</Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Item</TableHead><TableHead className="w-24">Qty</TableHead>
            <TableHead className="w-32">Unit Price</TableHead><TableHead className="w-32">Unit Cost</TableHead>
            <TableHead className="w-12" />
          </TableRow></TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Select value={l.item_id} onValueChange={(v) => updateLine(i, { item_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                    <SelectContent>{items.map((it: any) => <SelectItem key={it.id} value={it.id}>{it.item_name}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Input type="number" step="0.01" value={l.qty} onChange={(e) => updateLine(i, { qty: parseFloat(e.target.value) || 0 })} /></TableCell>
                <TableCell><Input type="number" step="0.01" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: parseFloat(e.target.value) || 0 })} /></TableCell>
                <TableCell><Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: parseFloat(e.target.value) || 0 })} /></TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="text-right text-sm mt-2 font-mono">Refund Total: <strong>{formatCurrency(totalRefund)}</strong></div>
      </div>

      <div><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={create.isPending}>Create Sales Return</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ────────────────────────────────────────────────────────────
// PURCHASE RETURNS
// ────────────────────────────────────────────────────────────
export function PurchaseReturnsTab() {
  const { data: list = [], isLoading } = usePurchaseReturns();
  const post = usePostPurchaseReturn();
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><PackageX className="w-5 h-5 text-primary" /> Purchase Returns</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Purchase Return</Button></DialogTrigger>
          <PRCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : list.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No purchase returns yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PR #</TableHead><TableHead>Date</TableHead><TableHead>Vendor</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.pr_number}</TableCell>
                  <TableCell>{format(new Date(p.return_date), "PP")}</TableCell>
                  <TableCell>{p.vendors?.name || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(p.total_amount)}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell>
                    {p.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => post.mutate(p.id)} disabled={post.isPending}>
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

function PRCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: items = [] } = useInventoryMaster();
  const { data: vendors = [] } = useVendors();
  const { data: warehouses = [] } = useWarehouses();
  const create = useCreatePurchaseReturn();
  const [vendorId, setVendorId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<{ item_id: string; qty: number; unit_cost: number }[]>(
    [{ item_id: "", qty: 1, unit_cost: 0 }]
  );

  const addLine = () => setLines([...lines, { item_id: "", qty: 1, unit_cost: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, x) => x !== i));
  const updateLine = (i: number, patch: Partial<typeof lines[0]>) =>
    setLines(lines.map((l, x) => {
      if (x !== i) return l;
      const merged = { ...l, ...patch };
      if (patch.item_id) {
        const it = items.find((x: any) => x.id === patch.item_id);
        if (it) merged.unit_cost = Number(it.unit_cost || 0);
      }
      return merged;
    }));

  const submit = async () => {
    const valid = lines.filter((l) => l.item_id && l.qty > 0);
    if (valid.length === 0) return;
    await create.mutateAsync({
      vendor_id: vendorId || undefined,
      warehouse_id: warehouseId || undefined,
      return_date: date,
      reason,
      lines: valid,
    });
    onClose();
  };

  const total = lines.reduce((s, l) => s + (l.qty * l.unit_cost || 0), 0);

  return (
    <DialogContent className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>New Purchase Return</DialogTitle>
        <DialogDescription>Returns goods to vendor: reduces inventory and credits AP / GRNI.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-3">
        <div><Label>Vendor</Label>
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
            <SelectContent>{vendors.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
            <SelectContent>{warehouses.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Return Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2"><Label>Items</Label>
          <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-3 h-3 mr-1" />Add</Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Item</TableHead><TableHead className="w-24">Qty</TableHead>
            <TableHead className="w-32">Unit Cost</TableHead><TableHead className="w-32">On Hand</TableHead>
            <TableHead className="w-12" />
          </TableRow></TableHeader>
          <TableBody>
            {lines.map((l, i) => {
              const item = items.find((it: any) => it.id === l.item_id);
              return (
                <TableRow key={i}>
                  <TableCell>
                    <Select value={l.item_id} onValueChange={(v) => updateLine(i, { item_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>{items.map((it: any) => <SelectItem key={it.id} value={it.id}>{it.item_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.qty} onChange={(e) => updateLine(i, { qty: parseFloat(e.target.value) || 0 })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: parseFloat(e.target.value) || 0 })} /></TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{item?.quantity_on_hand ?? "—"}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="text-right text-sm mt-2 font-mono">Total: <strong>{formatCurrency(total)}</strong></div>
      </div>

      <div><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={create.isPending}>Create Purchase Return</Button>
      </DialogFooter>
    </DialogContent>
  );
}
