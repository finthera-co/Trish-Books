import { useState } from "react";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { useCustomersWithBalance, useCreateCustomerWithOB, useUpdateCustomer, useDeleteCustomer } from "@/hooks/useSubledgerData";

export default function CustomersPage() {
  const { data: customers, isLoading } = useCustomersWithBalance();
  const createMutation = useCreateCustomerWithOB();
  const updateMutation = useUpdateCustomer();
  const deleteMutation = useDeleteCustomer();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", opening_balance: "" });

  const resetForm = () => {
    setForm({ name: "", email: "", phone: "", address: "", opening_balance: "" });
    setEditId(null);
  };

  const handleSubmit = () => {
    const payload = {
      name: form.name,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      opening_balance: parseFloat(form.opening_balance) || 0,
    };
    if (editId) {
      updateMutation.mutate({ id: editId, ...payload }, { onSuccess: () => { setOpen(false); resetForm(); } });
    } else {
      createMutation.mutate(payload, { onSuccess: () => { setOpen(false); resetForm(); } });
    }
  };

  const handleEdit = (c: any) => {
    setEditId(c.id);
    setForm({
      name: c.name,
      email: c.email || "",
      phone: c.phone || "",
      address: c.address || "",
      opening_balance: String(c.opening_balance || ""),
    });
    setOpen(true);
  };

  const totalOB = (customers || []).reduce((s: number, c: any) => s + Number(c.opening_balance || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" /> Customers
          </h1>
          <p className="text-sm text-muted-foreground">Manage customers and accounts receivable sub-ledger</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Customer</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Edit" : "New"} Customer</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Customer Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div><Label>Opening Balance</Label><Input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} placeholder="0.00" /></div>
              <Button className="w-full" onClick={handleSubmit} disabled={!form.name || createMutation.isPending || updateMutation.isPending}>
                {editId ? "Update" : "Create"} Customer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Customers</p><p className="text-2xl font-bold text-foreground">{(customers || []).length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total AR Opening Balance</p><p className="text-2xl font-bold text-primary">{formatCurrency(totalOB)}</p></CardContent></Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader><CardTitle>Customer List</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (customers || []).length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No customers yet. Click "New Customer" to add one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Opening Balance</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(customers || []).map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(c.opening_balance || 0)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(c)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(c.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
