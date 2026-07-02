import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Repeat, Trash2 } from "lucide-react";
import {
  useRecurringComponents, useCreateRecurringComponent, useToggleRecurringComponent,
  useDeleteRecurringComponent, type RecurringType,
} from "@/hooks/useRecurringComponents";
import { useEmployees } from "@/hooks/useData";

const fmt = (n: number) => `LKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const TYPE_LABEL: Record<RecurringType, string> = {
  earning_epf: "Allowance (EPF-able)",
  earning_non_epf: "Allowance (non-EPF)",
  deduction: "Deduction",
};

export default function RecurringPay() {
  const { data: items, isLoading } = useRecurringComponents();
  const { data: employees } = useEmployees();
  const create = useCreateRecurringComponent();
  const toggle = useToggleRecurringComponent();
  const remove = useDeleteRecurringComponent();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", label: "", component_type: "earning_epf" as RecurringType, amount: "" });

  const submit = () => {
    if (!form.employee_id || !form.label || !Number(form.amount)) return;
    create.mutate(
      { employee_id: form.employee_id, label: form.label, component_type: form.component_type, amount: Number(form.amount) },
      { onSuccess: () => { setOpen(false); setForm({ employee_id: "", label: "", component_type: "earning_epf", amount: "" }); } },
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Recurring Pay Items</h1>
          <p className="page-description">Standing allowances & deductions that auto-fill every payroll run.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />Add item</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Repeat className="w-4 h-4" />Standing items</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <table className="data-table text-sm">
              <thead>
                <tr><th>Employee</th><th>Label</th><th>Type</th><th className="text-right">Amount</th><th>Active</th><th className="w-12"></th></tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</td></tr>
                ) : !items?.length ? (
                  <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No recurring items yet.</td></tr>
                ) : items.map((it) => {
                  const e = it.employees;
                  return (
                    <tr key={it.id}>
                      <td className="font-medium text-foreground">{e ? `${e.first_name} ${e.last_name}` : "—"}</td>
                      <td className="text-muted-foreground">{it.label}</td>
                      <td>
                        <Badge variant="outline" className={it.component_type === "deduction" ? "text-rose-600 border-rose-500/40" : "text-emerald-600 border-emerald-500/40"}>
                          {TYPE_LABEL[it.component_type]}
                        </Badge>
                      </td>
                      <td className="text-right tabular-nums">{fmt(it.amount)}</td>
                      <td><Switch checked={it.is_active} onCheckedChange={(v) => toggle.mutate({ id: it.id, is_active: !!v })} /></td>
                      <td><Button variant="ghost" size="icon" onClick={() => remove.mutate(it.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            EPF-able allowances feed the EPF base; non-EPF allowances are taxable only; deductions reduce net pay. Amounts can still be overridden per run.
          </p>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add recurring item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Employee</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger>
                <SelectContent>
                  {employees?.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>{(e.employee_number ? `${e.employee_number} — ` : "")}{e.first_name} {e.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Label</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Transport allowance" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select value={form.component_type} onValueChange={(v) => setForm({ ...form, component_type: v as RecurringType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="earning_epf">Allowance (EPF-able)</SelectItem>
                    <SelectItem value="earning_non_epf">Allowance (non-EPF)</SelectItem>
                    <SelectItem value="deduction">Deduction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Amount (LKR)</Label><Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <Button className="w-full" onClick={submit} disabled={create.isPending || !form.employee_id || !form.label || !Number(form.amount)}>
              {create.isPending ? "Saving…" : "Add item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
