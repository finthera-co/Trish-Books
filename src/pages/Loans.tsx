import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KpiCard } from "@/components/ui/KpiCard";
import { Plus, Banknote, Trash2 } from "lucide-react";
import { useEmployeeLoans, useCreateLoan, useCancelLoan } from "@/hooks/useLoans";
import { useEmployees, useAccounts } from "@/hooks/useData";
import AccountCombobox from "@/components/shared/AccountCombobox";

const fmt = (n: number) => `LKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function Loans() {
  const { data: loans, isLoading } = useEmployeeLoans();
  const { data: employees } = useEmployees();
  const { data: accounts } = useAccounts();
  const create = useCreateLoan();
  const cancel = useCancelLoan();

  const bankAccounts = useMemo(
    () => (accounts || []).filter((a: any) => a.is_active && (a.account_subtype === "Bank" || a.account_subtype === "Cash" || /bank|cash/i.test(a.account_name))),
    [accounts],
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", description: "", principal: "", monthly_installment: "", bank_account_id: "" });

  const totals = useMemo(() => {
    const active = (loans ?? []).filter((l) => l.status === "active");
    return {
      outstanding: active.reduce((s, l) => s + Number(l.balance || 0), 0),
      activeCount: active.length,
      monthly: active.reduce((s, l) => s + Math.min(Number(l.monthly_installment || 0), Number(l.balance || 0)), 0),
    };
  }, [loans]);

  const submit = () => {
    if (!form.employee_id || !Number(form.principal) || !Number(form.monthly_installment)) return;
    create.mutate({
      employee_id: form.employee_id,
      description: form.description,
      principal: Number(form.principal),
      monthly_installment: Number(form.monthly_installment),
      bank_account_id: form.bank_account_id || undefined,
    }, { onSuccess: () => { setOpen(false); setForm({ employee_id: "", description: "", principal: "", monthly_installment: "", bank_account_id: "" }); } });
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Salary Advances & Loans</h1>
          <p className="page-description">Track employee loans — installments are deducted automatically each payroll run.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />New loan</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Outstanding" value={fmt(totals.outstanding)} sublabel="across active loans" icon={Banknote} tone="violet" />
        <KpiCard label="Active loans" value={totals.activeCount} sublabel="being repaid" icon={Banknote} tone="info" />
        <KpiCard label="Next run deduction" value={fmt(totals.monthly)} sublabel="total installments" icon={Banknote} tone="success" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Loans</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th>Employee</th><th>Description</th><th>Started</th>
                  <th className="text-right">Principal</th><th className="text-right">Installment</th>
                  <th className="text-right">Balance</th><th>Status</th><th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">Loading…</td></tr>
                ) : !loans?.length ? (
                  <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">No loans recorded.</td></tr>
                ) : loans.map((l) => {
                  const e = l.employees;
                  return (
                    <tr key={l.id}>
                      <td className="font-medium text-foreground">{e ? `${e.first_name} ${e.last_name}` : "—"}</td>
                      <td className="text-muted-foreground">{l.description || "—"}</td>
                      <td className="text-muted-foreground">{l.start_date}</td>
                      <td className="text-right tabular-nums">{fmt(l.principal)}</td>
                      <td className="text-right tabular-nums">{fmt(l.monthly_installment)}</td>
                      <td className="text-right tabular-nums font-medium">{fmt(l.balance)}</td>
                      <td>
                        {l.status === "active" ? <Badge variant="outline" className="text-amber-600 border-amber-500/50">Active</Badge>
                          : l.status === "settled" ? <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Settled</Badge>
                          : <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>}
                      </td>
                      <td>
                        {l.status === "active" && (
                          <Button variant="ghost" size="icon" onClick={() => cancel.mutate(l.id)} title="Cancel loan">
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Each payroll run deducts the installment (capped at the balance) and reduces the balance; a loan auto-settles when cleared.
          </p>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New loan / advance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger>
                <SelectContent>
                  {employees?.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>
                      {(e.employee_number ? `${e.employee_number} — ` : "")}{e.first_name} {e.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Festival advance" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Principal (LKR)</Label><Input type="number" min="0" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></div>
              <div><Label>Monthly installment</Label><Input type="number" min="0" value={form.monthly_installment} onChange={(e) => setForm({ ...form, monthly_installment: e.target.value })} /></div>
            </div>
            <div>
              <Label>Pay advance from (optional)</Label>
              <AccountCombobox
                options={bankAccounts}
                value={form.bank_account_id}
                onChange={(v) => setForm({ ...form, bank_account_id: v })}
                placeholder="Don't post to GL"
                clearLabel="Don't post to GL"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Posts Dr Staff Loans Receivable / Cr this account.</p>
            </div>
            <Button className="w-full" onClick={submit} disabled={create.isPending || !form.employee_id || !Number(form.principal) || !Number(form.monthly_installment)}>
              {create.isPending ? "Saving…" : "Record loan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
