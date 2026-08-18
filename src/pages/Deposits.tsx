import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Wallet, Plus, ArrowRightCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { useCustomers, useInvoices, useAccounts } from "@/hooks/useData";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { useDeposits, useRecordDeposit, useApplyDeposit, type DepositRow } from "@/hooks/useDeposits";
import AccountCombobox from "@/components/shared/AccountCombobox";
import { formatDate } from "@/lib/format";

const statusColor = (s: string) =>
  s === "applied" ? "bg-primary/10 text-primary"
  : s === "partially_applied" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
  : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
const today = () => new Date().toISOString().split("T")[0];

export default function Deposits() {
  const navigate = useNavigate();
  const { data: customers } = useCustomers();
  const { data: invoices } = useInvoices();
  const { data: accounts } = useAccounts();
  const { data: settings } = useAccountSettings();
  const { data: deposits, isLoading } = useDeposits();
  const record = useRecordDeposit();
  const apply = useApplyDeposit();

  const bankAccounts = useMemo(() => (accounts ?? []).filter((a: any) => a.is_active &&
    (a.account_subtype === "Bank" || a.account_subtype === "Cash" || /bank|cash/i.test(a.account_name || ""))), [accounts]);
  const liabilityAccounts = useMemo(() => (accounts ?? []).filter((a: any) => a.is_active &&
    /liab/i.test(a.account_type || "")), [accounts]);

  const [recordOpen, setRecordOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", amount: "", deposit_date: today(), bank_account_id: "", advance_account_id: "", payment_method: "bank_transfer", reference: "" });

  const [applyDep, setApplyDep] = useState<DepositRow | null>(null);
  const [applyForm, setApplyForm] = useState({ invoice_id: "", amount: "", applied_date: today() });

  const openInvoices = useMemo(
    () => (invoices ?? []).filter((i: any) => applyDep && i.customer_id === applyDep.customer_id && i.status !== "draft" && i.status !== "voided" && Number(i.balance_due) > 0),
    [invoices, applyDep],
  );

  const openRecord = () => {
    setForm({ customer_id: "", amount: "", deposit_date: today(), bank_account_id: bankAccounts[0]?.id || "",
      advance_account_id: settings?.customer_advance_account_id || liabilityAccounts[0]?.id || "", payment_method: "bank_transfer", reference: "" });
    setRecordOpen(true);
  };

  const submitRecord = async () => {
    await record.mutateAsync({
      customer_id: form.customer_id, amount: Number(form.amount), deposit_date: form.deposit_date,
      bank_account_id: form.bank_account_id, advance_account_id: form.advance_account_id,
      payment_method: form.payment_method, reference: form.reference,
    });
    setRecordOpen(false);
  };

  const openApply = (d: DepositRow) => {
    const unapplied = Number(d.amount) - Number(d.applied_amount);
    setApplyDep(d);
    setApplyForm({ invoice_id: "", amount: String(unapplied), applied_date: today() });
  };
  const submitApply = async () => {
    const inv = (invoices ?? []).find((i: any) => i.id === applyForm.invoice_id);
    if (!applyDep || !inv) return;
    if (!settings?.ar_account_id) return;
    await apply.mutateAsync({
      deposit: applyDep, invoice_id: inv.id, invoice_number: inv.invoice_number,
      amount: Number(applyForm.amount), ar_account_id: settings.ar_account_id, applied_date: applyForm.applied_date,
    });
    setApplyDep(null);
  };

  const totalUnapplied = (deposits ?? []).reduce((s, d) => s + (Number(d.amount) - Number(d.applied_amount)), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Wallet className="w-6 h-6 text-primary" /> Customer Deposits</h1>
            <p className="text-sm text-muted-foreground">Advance receipts held as a liability until applied to invoices</p>
          </div>
        </div>
        <Button onClick={openRecord}><Plus className="w-4 h-4 mr-1.5" /> Record Advance</Button>
      </div>

      <div className="stat-card w-64">
        <p className="text-sm text-muted-foreground">Unapplied deposits</p>
        <p className="text-xl font-semibold text-foreground mt-1">{formatCurrency(totalUnapplied)}</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Deposits</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <p className="text-center py-8 text-muted-foreground">Loading…</p>
          : (deposits ?? []).length === 0 ? <p className="text-center py-8 text-muted-foreground">No deposits yet</p>
          : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Unapplied</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(deposits ?? []).map((d) => {
                  const unapplied = Number(d.amount) - Number(d.applied_amount);
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="text-muted-foreground">{formatDate(d.deposit_date)}</TableCell>
                      <TableCell className="font-medium">{(d.customers as any)?.name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{d.reference || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(Number(d.amount))}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(unapplied)}</TableCell>
                      <TableCell><Badge className={statusColor(d.status)}>{d.status.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="text-right">
                        {unapplied > 0.005 && (
                          <Button size="sm" variant="ghost" onClick={() => openApply(d)}>
                            <ArrowRightCircle className="w-4 h-4 mr-1" /> Apply
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Record advance */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Advance / Deposit</DialogTitle>
            <DialogDescription>Posts Dr Bank / Cr Customer Advances. Apply it to an invoice later.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Customer *</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>{(customers ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount *</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="font-mono" /></div>
              <div><Label>Date</Label><Input type="date" value={form.deposit_date} onChange={(e) => setForm({ ...form, deposit_date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Deposit to (Bank) *</Label>
                <AccountCombobox
                  options={bankAccounts}
                  value={form.bank_account_id}
                  onChange={(v) => setForm({ ...form, bank_account_id: v })}
                  placeholder="Bank account"
                />
              </div>
              <div>
                <Label>Advances account *</Label>
                <AccountCombobox
                  options={liabilityAccounts}
                  value={form.advance_account_id}
                  onChange={(v) => setForm({ ...form, advance_account_id: v })}
                  placeholder="Liability account"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Method</Label>
                <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem><SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem><SelectItem value="online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Reference</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Txn / cheque #" /></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRecordOpen(false)}>Cancel</Button>
              <Button onClick={submitRecord} disabled={!form.customer_id || !(Number(form.amount) > 0) || !form.bank_account_id || !form.advance_account_id || record.isPending}>
                {record.isPending ? "Saving…" : "Record"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Apply deposit */}
      <Dialog open={!!applyDep} onOpenChange={(v) => { if (!v) setApplyDep(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply Deposit</DialogTitle>
            <DialogDescription>{(applyDep?.customers as any)?.name} · unapplied {applyDep ? formatCurrency(Number(applyDep.amount) - Number(applyDep.applied_amount)) : ""}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Apply to invoice *</Label>
              <Select value={applyForm.invoice_id} onValueChange={(v) => {
                const inv = openInvoices.find((i: any) => i.id === v);
                const unapplied = applyDep ? Number(applyDep.amount) - Number(applyDep.applied_amount) : 0;
                setApplyForm({ ...applyForm, invoice_id: v, amount: String(Math.min(unapplied, Number(inv?.balance_due) || 0)) });
              }}>
                <SelectTrigger><SelectValue placeholder={openInvoices.length ? "Select invoice" : "No open invoices"} /></SelectTrigger>
                <SelectContent>
                  {openInvoices.map((i: any) => <SelectItem key={i.id} value={i.id}>{i.invoice_number} — bal {formatCurrency(Number(i.balance_due))}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Amount *</Label><Input type="number" value={applyForm.amount} onChange={(e) => setApplyForm({ ...applyForm, amount: e.target.value })} className="font-mono" /></div>
              <div><Label>Date</Label><Input type="date" value={applyForm.applied_date} onChange={(e) => setApplyForm({ ...applyForm, applied_date: e.target.value })} /></div>
            </div>
            {!settings?.ar_account_id && <p className="text-xs text-destructive">Configure the AR account in Settings → Account Mapping first.</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApplyDep(null)}>Cancel</Button>
              <Button onClick={submitApply} disabled={!applyForm.invoice_id || !(Number(applyForm.amount) > 0) || !settings?.ar_account_id || apply.isPending}>
                {apply.isPending ? "Applying…" : "Apply"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
