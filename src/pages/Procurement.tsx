import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Send, ShoppingCart, PackageCheck, Receipt as ReceiptIcon, FileCheck2, BarChart3, Warehouse as WarehouseIcon, ArrowRightLeft, ClipboardEdit, Truck, RotateCcw, PackageX, ClipboardList, Wrench, ClipboardCheck, Keyboard } from "lucide-react";
import { InventoryReportsHub } from "@/components/inventory/InventoryReportsHub";
import { WarehousesTab, TransfersTab } from "@/components/inventory/WarehousesAndTransfers";
import { StockAdjustmentsTab } from "@/components/inventory/StockAdjustments";
import { LandedCostsTab } from "@/components/inventory/LandedCosts";
import { DeliveryNotesTab, SalesReturnsTab, PurchaseReturnsTab } from "@/components/inventory/SalesAndReturns";
import { PhysicalCountsTab } from "@/components/inventory/PhysicalCounts";
import { AssemblyTab } from "@/components/inventory/Assembly";
import { PeriodClosingChecklist } from "@/components/inventory/PeriodClosingChecklist";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import { useVendors } from "@/hooks/useSubledger";
import { useInventoryMaster } from "@/hooks/useProcurement";
import {
  usePurchaseOrders, useCreatePurchaseOrder,
  useGRNs, useCreateGRN, usePostGRN,
  useSupplierBills, useCreateSupplierBill, usePostSupplierBill,
  useUnbilledGRNLines,
  type POLineInput, type GRNLineInput, type BillLineInput,
} from "@/hooks/useProcurement";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  received: "bg-emerald-100 text-emerald-700",
  posted: "bg-emerald-100 text-emerald-700",
  paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
  reversed: "bg-rose-100 text-rose-700",
  closed: "bg-slate-200 text-slate-700",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge className={STATUS_COLORS[status] || "bg-muted"}>{status}</Badge>;
}

export default function Procurement() {
  // Keyboard shortcut: F focuses search, ? shows shortcut hint
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); setShortcutsOpen(true); }
      if (e.key === "f" || e.key === "F") {
        const el = document.querySelector<HTMLInputElement>("[data-procurement-search]");
        if (el) { e.preventDefault(); el.focus(); }
      }
      if (e.key === "n" || e.key === "N") {
        const btn = document.querySelector<HTMLButtonElement>("[data-procurement-new]");
        if (btn) { e.preventDefault(); btn.click(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-primary" /> Procurement & Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            POs → GRN → Bills · Warehouses · Adjustments · Returns · Counts · Assembly · Reports
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => setShortcutsOpen(true)}>
                <Keyboard className="w-4 h-4 mr-1" />Shortcuts
              </Button>
            </TooltipTrigger>
            <TooltipContent>Press ? for shortcuts</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Keyboard Shortcuts</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>New record (current tab)</span><kbd className="px-2 py-0.5 rounded bg-muted">N</kbd></div>
            <div className="flex justify-between"><span>Focus search</span><kbd className="px-2 py-0.5 rounded bg-muted">F</kbd></div>
            <div className="flex justify-between"><span>Show this dialog</span><kbd className="px-2 py-0.5 rounded bg-muted">?</kbd></div>
            <div className="flex justify-between"><span>Save (in form)</span><kbd className="px-2 py-0.5 rounded bg-muted">Ctrl/Cmd + S</kbd></div>
          </div>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="po" className="w-full">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="flex-nowrap inline-flex h-auto min-w-max">
            <TabsTrigger value="po"><ShoppingCart className="w-4 h-4 mr-2" />Purchase Orders</TabsTrigger>
            <TabsTrigger value="grn"><PackageCheck className="w-4 h-4 mr-2" />Goods Receipts</TabsTrigger>
            <TabsTrigger value="bills"><ReceiptIcon className="w-4 h-4 mr-2" />Supplier Bills</TabsTrigger>
            <TabsTrigger value="warehouses"><WarehouseIcon className="w-4 h-4 mr-2" />Warehouses</TabsTrigger>
            <TabsTrigger value="transfers"><ArrowRightLeft className="w-4 h-4 mr-2" />Transfers</TabsTrigger>
            <TabsTrigger value="adjustments"><ClipboardEdit className="w-4 h-4 mr-2" />Adjustments</TabsTrigger>
            <TabsTrigger value="landed"><Truck className="w-4 h-4 mr-2" />Landed Costs</TabsTrigger>
            <TabsTrigger value="delivery"><Truck className="w-4 h-4 mr-2" />Delivery Notes</TabsTrigger>
            <TabsTrigger value="sreturns"><RotateCcw className="w-4 h-4 mr-2" />Sales Returns</TabsTrigger>
            <TabsTrigger value="preturns"><PackageX className="w-4 h-4 mr-2" />Purchase Returns</TabsTrigger>
            <TabsTrigger value="counts"><ClipboardList className="w-4 h-4 mr-2" />Physical Counts</TabsTrigger>
            <TabsTrigger value="assembly"><Wrench className="w-4 h-4 mr-2" />Assembly / BOM</TabsTrigger>
            <TabsTrigger value="closing"><ClipboardCheck className="w-4 h-4 mr-2" />Period Close</TabsTrigger>
            <TabsTrigger value="valuation"><BarChart3 className="w-4 h-4 mr-2" />Reports</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="po"><POTab /></TabsContent>
        <TabsContent value="grn"><GRNTab /></TabsContent>
        <TabsContent value="bills"><BillTab /></TabsContent>
        <TabsContent value="warehouses"><WarehousesTab /></TabsContent>
        <TabsContent value="transfers"><TransfersTab /></TabsContent>
        <TabsContent value="adjustments"><StockAdjustmentsTab /></TabsContent>
        <TabsContent value="landed"><LandedCostsTab /></TabsContent>
        <TabsContent value="delivery"><DeliveryNotesTab /></TabsContent>
        <TabsContent value="sreturns"><SalesReturnsTab /></TabsContent>
        <TabsContent value="preturns"><PurchaseReturnsTab /></TabsContent>
        <TabsContent value="counts"><PhysicalCountsTab /></TabsContent>
        <TabsContent value="assembly"><AssemblyTab /></TabsContent>
        <TabsContent value="closing"><PeriodClosingChecklist /></TabsContent>
        <TabsContent value="valuation"><InventoryReportsHub /></TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Purchase Orders
// ────────────────────────────────────────────────────────────────────────────

function POTab() {
  const { data: pos, isLoading } = usePurchaseOrders();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Purchase Orders</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-procurement-new><Plus className="w-4 h-4 mr-2" />New PO</Button></DialogTrigger>
          <POCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (pos || []).length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No purchase orders yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead><TableHead>Date</TableHead><TableHead>Vendor</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pos || []).map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.po_number}</TableCell>
                  <TableCell>{format(new Date(p.order_date), "MMM d, yyyy")}</TableCell>
                  <TableCell>{p.vendor?.name}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(p.total_amount)}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function POCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: vendors } = useVendors();
  const { data: items } = useInventoryMaster();
  const create = useCreatePurchaseOrder();
  const [vendorId, setVendorId] = useState("");
  const [orderDate, setOrderDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<POLineInput[]>([]);

  const addLine = () => setLines([...lines, { item_id: "", qty_ordered: 1, unit_cost: 0 }]);
  const updateLine = (i: number, patch: Partial<POLineInput>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + (l.qty_ordered || 0) * (l.unit_cost || 0), 0);

  const submit = async () => {
    if (!vendorId) return;
    const valid = lines.filter((l) => l.item_id && l.qty_ordered > 0);
    if (valid.length === 0) return;
    await create.mutateAsync({ vendor_id: vendorId, order_date: orderDate, expected_date: expectedDate || undefined, notes, lines: valid });
    onClose();
  };

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Vendor *</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>{(vendors || []).map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Order Date *</Label><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
          <div><Label>Expected Date</Label><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
        </div>

        <div className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label>Line Items</Label>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
          </div>
          {lines.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No lines added.</p> : (
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
                        const it = (items || []).find((x) => x.id === v);
                        updateLine(i, { item_id: v, unit_cost: it?.last_purchase_price ?? it?.standard_cost ?? 0 });
                      }}>
                        <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                        <SelectContent>{(items || []).filter((x) => x.is_active).map((x) => (
                          <SelectItem key={x.id} value={x.id}>{x.item_code} — {x.item_name}</SelectItem>
                        ))}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" step="0.0001" value={l.qty_ordered} onChange={(e) => updateLine(i, { qty_ordered: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: Number(e.target.value) })} /></TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(l.qty_ordered * l.unit_cost)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex justify-end font-semibold">Total: {formatCurrency(total)}</div>
        </div>

        <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!vendorId || lines.length === 0 || create.isPending}>Create PO</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Goods Receipt Notes
// ────────────────────────────────────────────────────────────────────────────

function GRNTab() {
  const { data: grns, isLoading } = useGRNs();
  const post = usePostGRN();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Goods Receipt Notes</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New GRN</Button></DialogTrigger>
          <GRNCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (grns || []).length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No GRNs yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GRN #</TableHead><TableHead>Date</TableHead><TableHead>Vendor</TableHead>
                <TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead className="w-32">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(grns || []).map((g: any) => (
                <TableRow key={g.id}>
                  <TableCell className="font-mono">{g.grn_number}</TableCell>
                  <TableCell>{format(new Date(g.receipt_date), "MMM d, yyyy")}</TableCell>
                  <TableCell>{g.vendor?.name}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(g.total_value)}</TableCell>
                  <TableCell><StatusBadge status={g.status} /></TableCell>
                  <TableCell>
                    {g.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => post.mutate(g.id)} disabled={post.isPending}>
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

function GRNCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: vendors } = useVendors();
  const { data: items } = useInventoryMaster();
  const create = useCreateGRN();
  const [vendorId, setVendorId] = useState("");
  const [receiptDate, setReceiptDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<GRNLineInput[]>([]);

  const addLine = () => setLines([...lines, { item_id: "", qty_received: 1, unit_cost: 0 }]);
  const updateLine = (i: number, patch: Partial<GRNLineInput>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + (l.qty_received || 0) * (l.unit_cost || 0), 0);

  const submit = async () => {
    if (!vendorId) return;
    const valid = lines.filter((l) => l.item_id && l.qty_received > 0);
    if (valid.length === 0) return;
    await create.mutateAsync({ vendor_id: vendorId, receipt_date: receiptDate, notes, lines: valid });
    onClose();
  };

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>New Goods Receipt</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Vendor *</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
              <SelectContent>{(vendors || []).map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Receipt Date *</Label><Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></div>
        </div>

        <div className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label>Items Received</Label>
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
                        const it = (items || []).find((x) => x.id === v);
                        updateLine(i, { item_id: v, unit_cost: it?.last_purchase_price ?? it?.standard_cost ?? 0 });
                      }}>
                        <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                        <SelectContent>{(items || []).filter((x) => x.is_active).map((x) => (
                          <SelectItem key={x.id} value={x.id}>{x.item_code} — {x.item_name}</SelectItem>
                        ))}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" step="0.0001" value={l.qty_received} onChange={(e) => updateLine(i, { qty_received: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: Number(e.target.value) })} /></TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(l.qty_received * l.unit_cost)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex justify-end font-semibold">Total: {formatCurrency(total)}</div>
        </div>

        <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">
          On posting, this will Debit Inventory and Credit GRNI (Goods Received Not Invoiced).
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!vendorId || lines.length === 0 || create.isPending}>Create GRN</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Supplier Bills
// ────────────────────────────────────────────────────────────────────────────

function BillTab() {
  const { data: bills, isLoading } = useSupplierBills();
  const post = usePostSupplierBill();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Supplier Bills</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Bill</Button></DialogTrigger>
          <BillCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (bills || []).length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No bills yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill #</TableHead><TableHead>Vendor Ref</TableHead><TableHead>Date</TableHead>
                <TableHead>Vendor</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead><TableHead className="w-32">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(bills || []).map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono">{b.bill_number}</TableCell>
                  <TableCell className="text-muted-foreground">{b.vendor_ref || "—"}</TableCell>
                  <TableCell>{format(new Date(b.bill_date), "MMM d, yyyy")}</TableCell>
                  <TableCell>{b.vendor?.name}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(b.total_amount)}</TableCell>
                  <TableCell><StatusBadge status={b.status} /></TableCell>
                  <TableCell>
                    {b.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => post.mutate(b.id)} disabled={post.isPending}>
                        <FileCheck2 className="w-3 h-3 mr-1" />Post
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

function BillCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: vendors } = useVendors();
  const create = useCreateSupplierBill();
  const [vendorId, setVendorId] = useState("");
  const [billDate, setBillDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dueDate, setDueDate] = useState("");
  const [vendorRef, setVendorRef] = useState("");
  const [taxAmount, setTaxAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<BillLineInput[]>([]);
  const { data: unbilled } = useUnbilledGRNLines(vendorId || undefined);

  const addLine = () => setLines([...lines, { qty: 1, unit_cost: 0 }]);
  const updateLine = (i: number, patch: Partial<BillLineInput>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const subtotal = lines.reduce((s, l) => s + (l.qty || 0) * (l.unit_cost || 0), 0);
  const total = subtotal + (taxAmount || 0);

  const pickGRN = (i: number, grnLineId: string) => {
    const g = (unbilled || []).find((u) => u.id === grnLineId);
    if (!g) return;
    const remaining = Number(g.qty_received) - Number(g.qty_billed);
    updateLine(i, { grn_line_id: g.id, item_id: g.item_id, qty: remaining, unit_cost: Number(g.unit_cost) });
  };

  const submit = async () => {
    if (!vendorId) return;
    const valid = lines.filter((l) => l.qty > 0 && (l.grn_line_id || l.account_id));
    if (valid.length === 0) return;
    await create.mutateAsync({
      vendor_id: vendorId, bill_date: billDate, due_date: dueDate || undefined,
      vendor_ref: vendorRef, tax_amount: taxAmount, notes, lines: valid,
    });
    onClose();
  };

  return (
    <DialogContent className="max-w-4xl">
      <DialogHeader><DialogTitle>New Supplier Bill</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <div><Label>Vendor *</Label>
            <Select value={vendorId} onValueChange={(v) => { setVendorId(v); setLines([]); }}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{(vendors || []).map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Vendor Ref</Label><Input value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} /></div>
          <div><Label>Bill Date *</Label><Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
          <div><Label>Due Date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>

        <div className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label>Bill Lines (link to GRN for 3-way match)</Label>
            <Button size="sm" variant="outline" onClick={addLine} disabled={!vendorId}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
          </div>
          {lines.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Select a vendor, then add lines linked to received goods.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>GRN Line</TableHead><TableHead className="w-24">Qty</TableHead>
                <TableHead className="w-32">Unit Cost</TableHead><TableHead className="text-right w-32">Total</TableHead><TableHead className="w-10" />
              </TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={l.grn_line_id || ""} onValueChange={(v) => pickGRN(i, v)}>
                        <SelectTrigger><SelectValue placeholder="Pick a received item" /></SelectTrigger>
                        <SelectContent>
                          {(unbilled || []).map((u: any) => {
                            const remaining = Number(u.qty_received) - Number(u.qty_billed);
                            return (
                              <SelectItem key={u.id} value={u.id}>
                                {u.grn?.grn_number} · {u.item?.item_name} · {remaining} unbilled @ {formatCurrency(Number(u.unit_cost))}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" step="0.0001" value={l.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(i, { unit_cost: Number(e.target.value) })} /></TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(l.qty * l.unit_cost)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex justify-end gap-6 text-sm">
            <div>Subtotal: <span className="font-mono">{formatCurrency(subtotal)}</span></div>
            <div className="flex items-center gap-2">Tax: <Input type="number" step="0.01" className="w-28" value={taxAmount} onChange={(e) => setTaxAmount(Number(e.target.value))} /></div>
            <div className="font-semibold">Total: {formatCurrency(total)}</div>
          </div>
        </div>

        <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">
          On posting: Dr GRNI (at received cost) + Dr/Cr PPV for any price variance + Dr Tax (if mapped) → Cr Accounts Payable. Three-way match validated automatically.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!vendorId || lines.length === 0 || create.isPending}>Create Bill</Button>
      </DialogFooter>
    </DialogContent>
  );
}
