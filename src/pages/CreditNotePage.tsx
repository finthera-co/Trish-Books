import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Receipt, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { useCustomers } from "@/hooks/useData";
import { useARAccounts, useCreateCreditNoteWithGL, useCreditNotes } from "@/hooks/useARModule";

export default function CreditNotePage() {
  const navigate = useNavigate();
  const { data: customers } = useCustomers();
  const { data: accounts } = useARAccounts();
  const { data: creditNotes, isLoading } = useCreditNotes();
  const createCreditNote = useCreateCreditNoteWithGL();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customer_id: "",
    credit_note_number: "",
    credit_date: new Date().toISOString().split("T")[0],
    amount: "",
    reason: "",
    ar_account_id: "",
    revenue_account_id: "",
  });

  const handleCreate = async () => {
    await createCreditNote.mutateAsync({
      customer_id: form.customer_id,
      credit_note_number: form.credit_note_number,
      credit_date: form.credit_date,
      amount: parseFloat(form.amount) || 0,
      reason: form.reason,
      ar_account_id: form.ar_account_id,
      revenue_account_id: form.revenue_account_id,
    });
    setOpen(false);
    setForm({
      customer_id: "",
      credit_note_number: "",
      credit_date: new Date().toISOString().split("T")[0],
      amount: "",
      reason: "",
      ar_account_id: "",
      revenue_account_id: "",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Receipt className="w-6 h-6 text-warning" /> Credit Notes
            </h1>
            <p className="text-sm text-muted-foreground">Issue credit notes to reduce customer balances</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Credit Note</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Credit Note</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Customer *</Label>
                <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {(customers || []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Credit Note # *</Label>
                  <Input value={form.credit_note_number} onChange={(e) => setForm({ ...form, credit_note_number: e.target.value })} placeholder="CN-001" />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.credit_date} onChange={(e) => setForm({ ...form, credit_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Amount *</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <Label>AR Account *</Label>
                <Select value={form.ar_account_id} onValueChange={(v) => setForm({ ...form, ar_account_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select AR account" /></SelectTrigger>
                  <SelectContent>
                    {(accounts?.arAccounts || []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.account_code} - {a.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Revenue Account *</Label>
                <Select value={form.revenue_account_id} onValueChange={(v) => setForm({ ...form, revenue_account_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select revenue account" /></SelectTrigger>
                  <SelectContent>
                    {(accounts?.revenueAccounts || []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.account_code} - {a.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reason</Label>
                <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for credit note" />
              </div>
              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={!form.customer_id || !form.credit_note_number || !form.amount || !form.ar_account_id || !form.revenue_account_id || createCreditNote.isPending}
              >
                {createCreditNote.isPending ? "Creating..." : "Create & Post Credit Note"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Credit Notes</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (creditNotes || []).length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No credit notes yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credit Note #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(creditNotes || []).map((cn: any) => (
                  <TableRow key={cn.id}>
                    <TableCell className="font-medium">{cn.credit_note_number}</TableCell>
                    <TableCell>{(cn.customers as any)?.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{cn.credit_date}</TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate">{cn.reason || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{cn.status}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-warning">{formatCurrency(Number(cn.amount))}</TableCell>
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
