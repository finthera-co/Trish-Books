import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  usePayrollLiabilities,
  usePayrollRemittanceHistory,
  usePayrollLiabilityByRun,
  useRecordRemittance,
  type RemittanceType,
} from "@/hooks/usePayrollLiabilities";
import { useAccounts } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";

const REMITTANCE_TYPES: { value: RemittanceType; label: string }[] = [
  { value: "EPF_EMPLOYEE", label: "EPF Employee (8%)" },
  { value: "EPF_EMPLOYER", label: "EPF Employer (12%)" },
  { value: "ETF_EMPLOYER", label: "ETF Employer (3%)" },
];

function RecordRemittanceDialog({ open, onOpenChange, defaultType }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultType?: RemittanceType;
}) {
  const { data: accounts = [] } = useAccounts();
  const record = useRecordRemittance();

  const [form, setForm] = useState({
    remittance_type: defaultType || "EPF_EMPLOYEE" as RemittanceType,
    period: format(new Date(), "yyyy-MM"),
    amount: "",
    payment_date: format(new Date(), "yyyy-MM-dd"),
    bank_account_id: "",
    liability_account_id: "",
    reference: "",
    notes: "",
  });

  const bankAccounts = (accounts as any[]).filter(
    (a) => a.is_active && ["Cash", "Bank"].some((t) => a.account_subtype?.toLowerCase().includes(t.toLowerCase()) || a.account_name?.toLowerCase().includes(t.toLowerCase()))
  );
  const liabilityAccounts = (accounts as any[]).filter(
    (a) => a.is_active && a.account_type === "Liability"
  );

  const handleSave = () => {
    if (!form.amount || !form.bank_account_id || !form.liability_account_id) return;
    record.mutate(
      {
        ...form,
        amount: parseFloat(form.amount),
        reference: form.reference || undefined,
        notes: form.notes || undefined,
      },
      {
        onSuccess: () => onOpenChange(false),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Record Remittance Payment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Remittance Type</Label>
            <Select value={form.remittance_type} onValueChange={(v) => setForm({ ...form, remittance_type: v as RemittanceType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REMITTANCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Period (YYYY-MM)</Label>
              <Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026-06" />
            </div>
            <div>
              <Label>Payment Date</Label>
              <Input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Amount</Label>
            <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
          </div>
          <div>
            <Label>Liability Account (Dr)</Label>
            <Select value={form.liability_account_id} onValueChange={(v) => setForm({ ...form, liability_account_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select liability account…" /></SelectTrigger>
              <SelectContent>
                {liabilityAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Bank Account (Cr)</Label>
            <Select value={form.bank_account_id} onValueChange={(v) => setForm({ ...form, bank_account_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select bank account…" /></SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Reference</Label>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={!form.amount || !form.bank_account_id || !form.liability_account_id || record.isPending}
          >
            {record.isPending ? "Recording…" : "Record & Post to GL"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PayrollLiabilities() {
  const navigate = useNavigate();
  const { data: liabilities = [], isLoading } = usePayrollLiabilities();
  const { data: history = [] } = usePayrollRemittanceHistory();
  const { data: byRun = [] } = usePayrollLiabilityByRun();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<RemittanceType | undefined>(undefined);

  const openRecordFor = (type?: RemittanceType) => {
    setDefaultType(type);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-warning" /> Payroll Liability Tracking
          </h1>
          <p className="text-sm text-muted-foreground">Track EPF and ETF obligations and record remittance payments</p>
        </div>
        <Button onClick={() => openRecordFor(undefined)}>Record Remittance</Button>
      </div>

      {/* KPI cards */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {liabilities.map((l) => (
            <Card key={l.type} className={l.outstanding > 0 ? "border-warning/40" : "border-green-200 dark:border-green-900/30"}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                  {l.label}
                  {l.outstanding > 0 ? (
                    <AlertTriangle className="w-4 h-4 text-warning" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Accrued</span>
                  <span className="font-mono">{formatCurrency(l.accrued)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Remitted</span>
                  <span className="font-mono text-green-600">{formatCurrency(l.remitted)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold border-t pt-2">
                  <span>Outstanding</span>
                  <span className={`font-mono ${l.outstanding > 0 ? "text-warning" : "text-green-600"}`}>
                    {formatCurrency(l.outstanding)}
                  </span>
                </div>
                {l.outstanding > 0 && (
                  <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => openRecordFor(l.type)}>
                    Record Payment
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Liability by run */}
      <Card>
        <CardHeader>
          <CardTitle>Liability by Payroll Run</CardTitle>
        </CardHeader>
        <CardContent>
          {byRun.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No processed payroll runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">EPF Employee</TableHead>
                  <TableHead className="text-right">EPF Employer</TableHead>
                  <TableHead className="text-right">ETF Employer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byRun.map((r) => {
                  const total = r.epf_employee + r.epf_employer + r.etf_employer;
                  return (
                    <TableRow key={r.run_id}>
                      <TableCell className="font-mono text-sm">{r.run_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.period}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(r.epf_employee)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(r.epf_employer)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(r.etf_employer)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{formatCurrency(total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Remittance history */}
      <Card>
        <CardHeader><CardTitle>Remittance History</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No remittances recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Journal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((rem) => (
                  <TableRow key={rem.id}>
                    <TableCell className="text-sm">{rem.payment_date}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {REMITTANCE_TYPES.find((t) => t.value === rem.remittance_type)?.label || rem.remittance_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{rem.period}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{rem.reference || "—"}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{formatCurrency(rem.amount)}</TableCell>
                    <TableCell>
                      {rem.journal_entry_id ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 text-primary"
                          onClick={() => navigate(`/accounting/journals/${rem.journal_entry_id}`)}
                        >
                          <ExternalLink className="w-3 h-3 mr-1" /> View
                        </Button>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RecordRemittanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultType={defaultType}
      />
    </div>
  );
}
