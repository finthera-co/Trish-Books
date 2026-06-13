import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Users, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { useCustomersWithBalance, useCreateCustomerWithOB, useUpdateCustomer, useDeleteCustomer } from "@/hooks/useSubledgerData";

export default function CustomersPage() {
  const navigate = useNavigate();
  const { data: customers, isLoading } = useCustomersWithBalance();
  const createMutation = useCreateCustomerWithOB();
  const updateMutation = useUpdateCustomer();
  const deleteMutation = useDeleteCustomer();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", address: "",
    opening_balance: "", credit_limit: "", payment_terms: "net_30",
    tin: "", withholds_tax: false,
  });

  const resetForm = () => {
    setForm({ name: "", email: "", phone: "", address: "", opening_balance: "", credit_limit: "", payment_terms: "net_30", tin: "", withholds_tax: false });
    setEditId(null);
  };

  const handleSubmit = () => {
    const payload: any = {
      name: form.name,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      opening_balance: parseFloat(form.opening_balance) || 0,
      credit_limit: parseFloat(form.credit_limit) || 0,
      payment_terms: form.payment_terms,
      tin: form.tin || null,
      withholds_tax: form.withholds_tax,
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
      opening_balance: "", // Don't allow editing OB - managed by subledger
      credit_limit: String(c.credit_limit || ""),
      payment_terms: c.payment_terms || "net_30",
      tin: c.tin || "",
      withholds_tax: !!c.withholds_tax,
    });
    setOpen(true);
  };

  // Use ar_balance from subledger, not opening_balance
  const totalARBalance = (customers || []).reduce((s: number, c: any) => s + Number(c.ar_balance || 0), 0);

  const PAYMENT_TERMS = [
    { value: "due_on_receipt", label: "Due on Receipt" },
    { value: "net_15", label: "Net 15" },
    { value: "net_30", label: "Net 30" },
    { value: "net_45", label: "Net 45" },
    { value: "net_60", label: "Net 60" },
    { value: "net_90", label: "Net 90" },
  ];

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
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editId ? "Edit" : "New"} Customer</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Customer Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                {!editId && (
                  <div><Label>Opening Balance</Label><Input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} placeholder="0.00" /></div>
                )}
                <div><Label>Credit Limit</Label><Input type="number" step="0.01" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} placeholder="0.00" /></div>
              </div>
              {editId && (
                <p className="text-xs text-muted-foreground">Opening balance is managed by AR subledger transactions and cannot be edited directly.</p>
              )}
              <div>
                <Label>Payment Terms</Label>
                <Select value={form.payment_terms} onValueChange={(v) => setForm({ ...form, payment_terms: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Tax attributes */}
              <div className="border-t pt-3 space-y-3">
                <p className="text-sm font-medium">Tax</p>
                <div><Label>TIN</Label><Input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} /></div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Withholds tax on payments</Label>
                    <p className="text-xs text-muted-foreground">Customer deducts WHT when paying us</p>
                  </div>
                  <Switch checked={form.withholds_tax} onCheckedChange={(v) => setForm({ ...form, withholds_tax: v })} />
                </div>
              </div>

              <Button className="w-full" onClick={handleSubmit} disabled={!form.name || createMutation.isPending || updateMutation.isPending}>
                {editId ? "Update" : "Create"} Customer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Customers</p><p className="text-2xl font-bold text-foreground">{(customers || []).length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total AR Balance</p><p className="text-2xl font-bold text-primary">{formatCurrency(totalARBalance)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Credit Limit</p><p className="text-2xl font-bold text-foreground">{formatCurrency((customers || []).reduce((s: number, c: any) => s + Number(c.credit_limit || 0), 0))}</p></CardContent></Card>
      </div>

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
                  <TableHead>Terms</TableHead>
                  <TableHead className="text-right">Credit Limit</TableHead>
                  <TableHead className="text-right">AR Balance</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(customers || []).map((c: any) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/accounting/customers/${c.id}`)}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{(c.payment_terms || "net_30").replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(c.credit_limit || 0)}</TableCell>
                    <TableCell className={`text-right font-mono font-semibold ${Number(c.ar_balance) > 0 ? "text-destructive" : "text-primary"}`}>
                      {formatCurrency(c.ar_balance || 0)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => navigate(`/accounting/customers/${c.id}`)}><Eye className="w-4 h-4" /></Button>
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
