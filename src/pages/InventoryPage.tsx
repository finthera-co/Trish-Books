import { useState } from "react";
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { useInventoryItemsEnhanced, useCreateInventoryItemEnhanced, useUpdateInventoryItem, useDeleteInventoryItem } from "@/hooks/useSubledgerData";
import { useInventoryRealtime } from "@/hooks/useInventoryRealtime";

export default function InventoryPage() {
  useInventoryRealtime();
  const { data: items, isLoading } = useInventoryItemsEnhanced();
  const createMutation = useCreateInventoryItemEnhanced();
  const updateMutation = useUpdateInventoryItem();
  const deleteMutation = useDeleteInventoryItem();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ item_name: "", sku: "", description: "", unit_cost: "", quantity_on_hand: "", valuation_method: "wac" as "wac" | "fifo" });

  const resetForm = () => {
    setForm({ item_name: "", sku: "", description: "", unit_cost: "", quantity_on_hand: "", valuation_method: "wac" });
    setEditId(null);
  };

  const handleSubmit = () => {
    const payload = {
      item_name: form.item_name,
      sku: form.sku || undefined,
      description: form.description || undefined,
      unit_cost: parseFloat(form.unit_cost) || 0,
      quantity_on_hand: parseFloat(form.quantity_on_hand) || 0,
      valuation_method: form.valuation_method,
    };
    if (editId) {
      updateMutation.mutate({ id: editId, ...payload }, { onSuccess: () => { setOpen(false); resetForm(); } });
    } else {
      createMutation.mutate(payload, { onSuccess: () => { setOpen(false); resetForm(); } });
    }
  };

  const handleEdit = (item: any) => {
    setEditId(item.id);
    setForm({
      item_name: item.item_name,
      sku: item.sku || "",
      description: item.description || "",
      unit_cost: String(item.unit_cost || ""),
      quantity_on_hand: String(item.quantity_on_hand || ""),
      valuation_method: (item.valuation_method as "wac" | "fifo") || "wac",
    });
    setOpen(true);
  };

  const totalValue = (items || []).reduce((s: number, i: any) => s + Number(i.quantity_on_hand || 0) * Number(i.unit_cost || 0), 0);
  const totalItems = (items || []).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" /> Inventory
          </h1>
          <p className="text-sm text-muted-foreground">Manage inventory items and sub-ledger</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Edit" : "New"} Inventory Item</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Item Name *</Label><Input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
                <div><Label>Unit Cost</Label><Input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Qty On Hand</Label><Input type="number" value={form.quantity_on_hand} onChange={(e) => setForm({ ...form, quantity_on_hand: e.target.value })} /></div>
                <div>
                  <Label>Valuation Method</Label>
                  <Select value={form.valuation_method} onValueChange={(v) => setForm({ ...form, valuation_method: v as "wac" | "fifo" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wac">Weighted Average (WAC)</SelectItem>
                      <SelectItem value="fifo">FIFO (First-In, First-Out)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <Button className="w-full" onClick={handleSubmit} disabled={!form.item_name || createMutation.isPending || updateMutation.isPending}>
                {editId ? "Update" : "Create"} Item
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Items</p><p className="text-2xl font-bold text-foreground">{totalItems}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Qty On Hand</p><p className="text-2xl font-bold text-foreground">{(items || []).reduce((s: number, i: any) => s + Number(i.quantity_on_hand || 0), 0)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Inventory Value</p><p className="text-2xl font-bold text-primary">{formatCurrency(totalValue)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Inventory Items</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (items || []).length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No inventory items yet. Click "New Item" to add one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty On Hand</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Inventory Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items || []).map((item: any) => {
                  const value = Number(item.quantity_on_hand || 0) * Number(item.unit_cost || 0);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.item_name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.sku || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{item.quantity_on_hand}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(item.unit_cost)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(value)}</TableCell>
                      <TableCell>
                        <Badge variant={Number(item.quantity_on_hand) > 0 ? "default" : "destructive"}>
                          {Number(item.quantity_on_hand) > 0 ? "In Stock" : "Out of Stock"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}><Pencil className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(item.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
