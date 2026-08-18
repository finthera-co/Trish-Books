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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Send, Trash } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import { useInventoryMaster } from "@/hooks/useProcurement";
import { useWarehouses } from "@/hooks/useWarehouses";
import { formatDate } from "@/lib/format";
import {
  useBoms, useCreateBom, useDeleteBom,
  useAssemblyOrders, useCreateAssemblyOrder, usePostAssemblyOrder,
  useAssemblyOrderLines,
  type BomComponentInput,
} from "@/hooks/useAssembly";

const STATUS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  posted: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

export function AssemblyTab() {
  return (
    <Tabs defaultValue="boms" className="w-full">
      <TabsList>
        <TabsTrigger value="boms">Bills of Materials</TabsTrigger>
        <TabsTrigger value="orders">Assembly Orders</TabsTrigger>
      </TabsList>
      <TabsContent value="boms"><BomList /></TabsContent>
      <TabsContent value="orders"><AOList /></TabsContent>
    </Tabs>
  );
}

function BomList() {
  const { data: boms, isLoading } = useBoms();
  const del = useDeleteBom();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Bills of Materials</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New BOM</Button></DialogTrigger>
          <BomCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (boms || []).length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No BOMs yet.</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Code</TableHead><TableHead>Finished Good</TableHead><TableHead className="text-right">Output Qty</TableHead>
              <TableHead className="text-right">Labor/Unit</TableHead><TableHead className="text-right">OH/Unit</TableHead><TableHead className="w-16" />
            </TableRow></TableHeader>
            <TableBody>
              {(boms || []).map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono">{b.bom_code} v{b.version}</TableCell>
                  <TableCell>{b.fg?.item_code} — {b.fg?.item_name}</TableCell>
                  <TableCell className="text-right font-mono">{b.output_qty}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(b.labor_cost_per_unit)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(b.overhead_cost_per_unit)}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(b.id)}>
                      <Trash className="w-4 h-4 text-destructive" />
                    </Button>
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

function BomCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: items } = useInventoryMaster();
  const create = useCreateBom();
  const [code, setCode] = useState("");
  const [fgId, setFgId] = useState("");
  const [outputQty, setOutputQty] = useState(1);
  const [labor, setLabor] = useState(0);
  const [overhead, setOverhead] = useState(0);
  const [notes, setNotes] = useState("");
  const [comps, setComps] = useState<BomComponentInput[]>([]);

  const addLine = () => setComps([...comps, { component_item_id: "", qty_per_output: 1, scrap_pct: 0 }]);
  const updLine = (i: number, p: Partial<BomComponentInput>) =>
    setComps(comps.map((c, idx) => idx === i ? { ...c, ...p } : c));
  const rmLine = (i: number) => setComps(comps.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!code || !fgId || comps.length === 0) return;
    const valid = comps.filter((c) => c.component_item_id && c.qty_per_output > 0);
    if (valid.length === 0) return;
    await create.mutateAsync({
      bom_code: code, fg_item_id: fgId, output_qty: outputQty,
      labor_cost_per_unit: labor, overhead_cost_per_unit: overhead,
      notes, components: valid,
    });
    onClose();
  };

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>New Bill of Materials</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div><Label>BOM Code *</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div className="col-span-2"><Label>Finished Good *</Label>
            <Select value={fgId} onValueChange={setFgId}>
              <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
              <SelectContent>{(items || []).filter((x) => x.is_active).map((x) => (
                <SelectItem key={x.id} value={x.id}>{x.item_code} — {x.item_name}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div><Label>Output Qty</Label><Input type="number" step="0.01" value={outputQty} onChange={(e) => setOutputQty(Number(e.target.value))} /></div>
          <div><Label>Labor / Unit</Label><Input type="number" step="0.01" value={labor} onChange={(e) => setLabor(Number(e.target.value))} /></div>
          <div><Label>Overhead / Unit</Label><Input type="number" step="0.01" value={overhead} onChange={(e) => setOverhead(Number(e.target.value))} /></div>
        </div>

        <div className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label>Components</Label>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-3 h-3 mr-1" />Add</Button>
          </div>
          {comps.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No components.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Component</TableHead><TableHead className="w-32">Qty / Output</TableHead><TableHead className="w-24">Scrap %</TableHead><TableHead className="w-10" />
              </TableRow></TableHeader>
              <TableBody>
                {comps.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={c.component_item_id} onValueChange={(v) => updLine(i, { component_item_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{(items || []).filter((x) => x.is_active && x.id !== fgId).map((x) => (
                          <SelectItem key={x.id} value={x.id}>{x.item_code} — {x.item_name}</SelectItem>
                        ))}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" step="0.0001" value={c.qty_per_output} onChange={(e) => updLine(i, { qty_per_output: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={(c.scrap_pct || 0) * 100} onChange={(e) => updLine(i, { scrap_pct: Number(e.target.value) / 100 })} /></TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => rmLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!code || !fgId || comps.length === 0 || create.isPending}>Create</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AOList() {
  const { data: aos, isLoading } = useAssemblyOrders();
  const post = usePostAssemblyOrder();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Assembly Orders</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />New Order</Button></DialogTrigger>
          <AOCreateDialog onClose={() => setOpen(false)} />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (aos || []).length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No assembly orders.</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>AO #</TableHead><TableHead>Date</TableHead><TableHead>Finished Good</TableHead>
              <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Total Cost</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead><TableHead>Status</TableHead><TableHead className="w-32" />
            </TableRow></TableHeader>
            <TableBody>
              {(aos || []).map((a: any) => (
                <>
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                    <TableCell className="font-mono">{a.ao_number}</TableCell>
                    <TableCell>{formatDate(a.ao_date)}</TableCell>
                    <TableCell>{a.fg?.item_name}</TableCell>
                    <TableCell className="text-right font-mono">{a.output_qty}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(a.total_cost)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(a.unit_cost)}</TableCell>
                    <TableCell><Badge className={STATUS[a.status]}>{a.status}</Badge></TableCell>
                    <TableCell>
                      {a.status === "draft" && (
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); post.mutate(a.id); }} disabled={post.isPending}>
                          <Send className="w-3 h-3 mr-1" />Post
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded === a.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/30">
                        <AOLines aoId={a.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AOLines({ aoId }: { aoId: string }) {
  const { data: lines } = useAssemblyOrderLines(aoId);
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>Component</TableHead><TableHead className="text-right">Qty Required</TableHead>
        <TableHead className="text-right">On Hand</TableHead><TableHead className="text-right">Unit Cost</TableHead>
        <TableHead className="text-right">Total</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {(lines || []).map((l: any) => (
          <TableRow key={l.id}>
            <TableCell>{l.component?.item_code} — {l.component?.item_name}</TableCell>
            <TableCell className="text-right font-mono">{Number(l.qty_required).toFixed(4)}</TableCell>
            <TableCell className={`text-right font-mono ${Number(l.component?.quantity_on_hand) < Number(l.qty_required) ? "text-destructive" : ""}`}>
              {l.component?.quantity_on_hand}
            </TableCell>
            <TableCell className="text-right font-mono">{formatCurrency(l.unit_cost)}</TableCell>
            <TableCell className="text-right font-mono">{formatCurrency(l.total_cost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AOCreateDialog({ onClose }: { onClose: () => void }) {
  const { data: boms } = useBoms();
  const { data: warehouses } = useWarehouses();
  const create = useCreateAssemblyOrder();
  const [bomId, setBomId] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [qty, setQty] = useState(1);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [labor, setLabor] = useState<string>("");
  const [overhead, setOverhead] = useState<string>("");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    if (!bomId || qty <= 0) return;
    await create.mutateAsync({
      bom_id: bomId, ao_date: date, output_qty: qty,
      warehouse_id: warehouseId || null,
      labor_cost: labor === "" ? undefined : Number(labor),
      overhead_cost: overhead === "" ? undefined : Number(overhead),
      notes,
    });
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New Assembly Order</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>BOM *</Label>
          <Select value={bomId} onValueChange={setBomId}>
            <SelectTrigger><SelectValue placeholder="Select BOM" /></SelectTrigger>
            <SelectContent>{(boms || []).map((b: any) => (
              <SelectItem key={b.id} value={b.id}>{b.bom_code} → {b.fg?.item_name}</SelectItem>
            ))}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>Output Qty</Label><Input type="number" step="0.01" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
        </div>
        <div><Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger><SelectValue placeholder="(default)" /></SelectTrigger>
            <SelectContent>{(warehouses || []).map((w: any) => (
              <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>
            ))}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Labor Cost (override)</Label><Input type="number" step="0.01" value={labor} placeholder="from BOM" onChange={(e) => setLabor(e.target.value)} /></div>
          <div><Label>Overhead Cost (override)</Label><Input type="number" step="0.01" value={overhead} placeholder="from BOM" onChange={(e) => setOverhead(e.target.value)} /></div>
        </div>
        <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!bomId || create.isPending}>Create</Button>
      </DialogFooter>
    </DialogContent>
  );
}
