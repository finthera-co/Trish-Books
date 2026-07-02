import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Receipt, Plus, MoreHorizontal, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/currency";
import { useCustomers, useInvoices } from "@/hooks/useData";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useARAccounts, useCreateCreditNoteWithGL, useCreditNotes, useVoidCreditNote } from "@/hooks/useARModule";

const NO_INVOICE = "__none__";

const cnStatusColor = (status: string) =>
  status === "voided"
    ? "bg-destructive/10 text-destructive line-through"
    : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";

export default function CreditNotePage() {
  const navigate = useNavigate();
  const { data: customers } = useCustomers();
  const { data: accounts } = useARAccounts();
  const { data: settings } = useAccountSettings();
  const { data: invoices } = useInvoices();
  const { data: creditNotes, isLoading } = useCreditNotes();
  const createCreditNote = useCreateCreditNoteWithGL();
  const voidCreditNote = useVoidCreditNote();

  const [open, setOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [form, setForm] = useState({
    customer_id: "",
    invoice_id: NO_INVOICE,
    credit_date: new Date().toISOString().split("T")[0],
    amount: "",
    reason: "",
    ar_account_id: "",
    revenue_account_id: "",
  });

  // Accounts are resolved from tenant settings; manual pickers only surface when
  // a default is missing (so the common path is a single click).
  const resolvedAr = form.ar_account_id || settings?.ar_account_id || "";
  const resolvedRev = form.revenue_account_id || settings?.sales_account_id || "";
  const needsArPicker = !settings?.ar_account_id;
  const needsRevPicker = !settings?.sales_account_id;

  // Open invoices for the chosen customer — lets a credit note be applied to a
  // specific document and caps the amount to that invoice's outstanding balance.
  const customerInvoices = useMemo(
    () =>
      (invoices ?? []).filter(
        (i: any) =>
          i.customer_id === form.customer_id &&
          i.status !== "draft" &&
          i.status !== "voided" &&
          Number(i.balance_due) > 0,
      ),
    [invoices, form.customer_id],
  );
  const selectedInvoice = customerInvoices.find((i: any) => i.id === form.invoice_id);
  const amountCap = selectedInvoice ? Number(selectedInvoice.balance_due) : null;

  const resetForm = () =>
    setForm({
      customer_id: "",
      invoice_id: NO_INVOICE,
      credit_date: new Date().toISOString().split("T")[0],
      amount: "",
      reason: "",
      ar_account_id: "",
      revenue_account_id: "",
    });

  const amountNum = parseFloat(form.amount) || 0;
  const overCap = amountCap !== null && amountNum > amountCap + 0.005;
  const canSubmit =
    !!form.customer_id && amountNum > 0 && !overCap && !!resolvedAr && !!resolvedRev && !createCreditNote.isPending;

  const handleCreate = async () => {
    await createCreditNote.mutateAsync({
      customer_id: form.customer_id,
      // number omitted → hook generates an atomic CN-YYYY-NNNN serial
      credit_date: form.credit_date,
      amount: amountNum,
      reason: form.reason,
      ar_account_id: resolvedAr,
      revenue_account_id: resolvedRev,
      invoice_id: form.invoice_id === NO_INVOICE ? undefined : form.invoice_id,
    });
    setOpen(false);
    resetForm();
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    await voidCreditNote.mutateAsync({ credit_note_id: voidTarget.id, reason: voidReason || undefined });
    setVoidTarget(null);
    setVoidReason("");
  };

  // Summary across non-voided notes.
  const active = (creditNotes ?? []).filter((c: any) => c.status !== "voided");
  const thisMonth = new Date().toISOString().slice(0, 7);
  const stats = {
    total: active.reduce((s: number, c: any) => s + Number(c.amount), 0),
    month: active.filter((c: any) => (c.credit_date || "").startsWith(thisMonth)).reduce((s: number, c: any) => s + Number(c.amount), 0),
    count: active.length,
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
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Credit Note</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Credit Note</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Customer *</Label>
                <Select
                  value={form.customer_id}
                  onValueChange={(v) => setForm({ ...form, customer_id: v, invoice_id: NO_INVOICE, amount: "" })}
                >
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {(customers || []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Optional: apply against a specific open invoice. */}
              {form.customer_id && (
                <div>
                  <Label>Apply to invoice (optional)</Label>
                  <Select
                    value={form.invoice_id}
                    onValueChange={(v) => {
                      const inv = customerInvoices.find((i: any) => i.id === v);
                      setForm((f) => ({ ...f, invoice_id: v, amount: inv ? String(inv.balance_due) : f.amount }));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Unapplied (reduces overall balance)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_INVOICE}>— Unapplied —</SelectItem>
                      {customerInvoices.map((i: any) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.invoice_number} · bal {formatCurrency(Number(i.balance_due))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {customerInvoices.length === 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">No open invoices for this customer.</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Amount *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    max={amountCap ?? undefined}
                  />
                  {overCap && (
                    <p className="text-[11px] text-destructive mt-1">Exceeds invoice balance ({formatCurrency(amountCap!)})</p>
                  )}
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.credit_date} onChange={(e) => setForm({ ...form, credit_date: e.target.value })} />
                </div>
              </div>

              {/* Account mapping — only shown when a tenant default is missing. */}
              {(needsArPicker || needsRevPicker) ? (
                <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Set defaults in Settings → Account Mapping to skip this step.
                  </p>
                  {needsArPicker && (
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
                  )}
                  {needsRevPicker && (
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
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Posts Dr Sales Revenue / Cr Accounts Receivable using your configured default accounts. Number is generated automatically.
                </p>
              )}

              <div>
                <Label>Reason</Label>
                <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for credit note" />
              </div>
              <Button className="w-full" onClick={handleCreate} disabled={!canSubmit}>
                {createCreditNote.isPending ? "Creating..." : "Create & Post Credit Note"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Credited</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.total)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">This Month</p><p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(stats.month)}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Active Notes</p><p className="text-xl font-semibold text-foreground mt-1">{stats.count}</p></div>
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
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(creditNotes || []).map((cn: any) => (
                  <TableRow key={cn.id} className={cn.status === "voided" ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{cn.credit_note_number}</TableCell>
                    <TableCell>{(cn.customers as any)?.name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{cn.credit_date}</TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate">{cn.reason || "—"}</TableCell>
                    <TableCell><Badge className={cnStatusColor(cn.status)}>{cn.status}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-warning">{formatCurrency(Number(cn.amount))}</TableCell>
                    <TableCell>
                      {cn.status !== "voided" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 rounded hover:bg-accent"><MoreHorizontal className="w-4 h-4 text-muted-foreground" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem className="text-destructive" onClick={() => { setVoidTarget(cn); setVoidReason(""); }}>
                              <Ban className="w-4 h-4 mr-2" /> Void Credit Note
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Void confirmation */}
      <AlertDialog open={!!voidTarget} onOpenChange={(v) => { if (!v) { setVoidTarget(null); setVoidReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void credit note {voidTarget?.credit_note_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts a reversing journal entry (Dr Accounts Receivable / Cr Sales Revenue) and restores the customer balance. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Issued in error" className="mt-1" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleVoid}
              disabled={voidCreditNote.isPending}
            >
              {voidCreditNote.isPending ? "Voiding…" : "Void Credit Note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
