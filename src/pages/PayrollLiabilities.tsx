import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { differenceInDays, format, parseISO } from "date-fns";
import {
  AlertTriangle, CheckCircle, CheckCircle2, ExternalLink, Download, XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  usePayrollLiabilities,
  usePayrollLiabilityByPeriod,
  usePayrollLiabilityByRun,
  usePayrollRemittanceHistory,
  useRecordRemittance,
  useVoidRemittance,
  LIABILITY_LABELS,
  type RemittanceType,
  type LiabilitySummary,
  type PeriodLiabilityRow,
  type PayrollRemittance,
} from "@/hooks/usePayrollLiabilities";
import { useAccounts } from "@/hooks/useData";
import { usePayrollGLMappings } from "@/hooks/usePayrollGLMapping";
import { formatCurrency } from "@/lib/currency";
import { exportToCsv } from "@/lib/csvExport";

const REMITTANCE_TYPES: { value: RemittanceType; label: string }[] = [
  { value: "EPF_EMPLOYEE", label: "EPF Employee (8%)" },
  { value: "EPF_EMPLOYER", label: "EPF Employer (12%)" },
  { value: "ETF_EMPLOYER", label: "ETF Employer (3%)" },
];

const REMITTANCE_LABELS: Record<string, string> = {
  EPF_EMPLOYEE: "EPF Employee (8%)",
  EPF_EMPLOYER: "EPF Employer (12%)",
  ETF_EMPLOYER: "ETF Employer (3%)",
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, dueDate }: {
  status: "FULLY_REMITTED" | "OVERDUE" | "DUE_SOON" | "PENDING";
  dueDate?: string;
}) {
  if (status === "FULLY_REMITTED") {
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">Remitted</Badge>;
  }
  if (status === "OVERDUE") {
    const days = dueDate ? differenceInDays(new Date(), parseISO(dueDate)) : null;
    return (
      <Badge className="bg-destructive/10 text-destructive border-0">
        Overdue{days !== null ? ` (${days}d)` : ""}
      </Badge>
    );
  }
  if (status === "DUE_SOON") {
    return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-0">Due Soon</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
}

function RunStatusBadge({ status }: { status: "settled" | "partial" | "pending" }) {
  if (status === "settled") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">Settled</Badge>;
  if (status === "partial") return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-0">Partial</Badge>;
  return <Badge className="bg-destructive/10 text-destructive border-0">Pending</Badge>;
}

// ─── Void confirm dialog ──────────────────────────────────────────────────────

function VoidConfirmDialog({ rem, open, onOpenChange }: {
  rem: PayrollRemittance | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const voidMutation = useVoidRemittance();
  const [reason, setReason] = useState("");

  const handleVoid = () => {
    if (!rem || reason.length < 10) return;
    voidMutation.mutate(
      { remittance_id: rem.id, void_reason: reason },
      { onSuccess: () => { onOpenChange(false); setReason(""); } }
    );
  };

  if (!rem) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setReason(""); }}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><XCircle className="w-5 h-5" /> Void Remittance</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border p-4 bg-muted/30 space-y-1 text-sm">
            <p><span className="text-muted-foreground">Type:</span> <span className="font-medium">{LIABILITY_LABELS[rem.remittance_type as RemittanceType] ?? rem.remittance_type}</span></p>
            <p><span className="text-muted-foreground">Period:</span> <span className="font-mono">{rem.period}</span></p>
            <p><span className="text-muted-foreground">Amount:</span> <span className="font-semibold">{formatCurrency(rem.amount)}</span></p>
            <p><span className="text-muted-foreground">Payment date:</span> {rem.payment_date}</p>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              This will create a reversal journal entry (Dr Bank / Cr Liability) and cannot be undone.
            </AlertDescription>
          </Alert>

          <div>
            <Label>Void Reason <span className="text-muted-foreground text-xs">(min 10 characters)</span></Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Recorded against wrong period"
            />
            {reason.length > 0 && reason.length < 10 && (
              <p className="text-xs text-destructive mt-1">{10 - reason.length} more characters required</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={reason.length < 10 || voidMutation.isPending}
            >
              {voidMutation.isPending ? "Voiding…" : "Confirm Void"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Record remittance dialog ─────────────────────────────────────────────────

function RecordRemittanceDialog({ open, onOpenChange, defaultType }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultType?: RemittanceType;
}) {
  const { data: accounts = [] } = useAccounts();
  const { data: periodData = [] } = usePayrollLiabilityByPeriod();
  const { data: history = [] } = usePayrollRemittanceHistory();
  const { data: runRows = [] } = usePayrollLiabilityByRun();
  const record = useRecordRemittance();
  const { data: glMappings = [] } = usePayrollGLMappings();

  const [form, setForm] = useState({
    remittance_type: (defaultType ?? "EPF_EMPLOYEE") as RemittanceType,
    period: format(new Date(), "yyyy-MM"),
    amount: "",
    payment_date: format(new Date(), "yyyy-MM-dd"),
    bank_account_id: "",
    liability_account_id: "",
    reference: "",
    notes: "",
    payroll_run_id: "",
  });

  const allAccounts = accounts as any[];

  // Instantly resolve the credit-side liability account from already-cached GL mappings — no network round trip
  const resolvedMapping = useMemo(
    () => glMappings.find(
      (m) => m.component_code === form.remittance_type && m.posting_side === "credit" && m.is_active
    ) ?? null,
    [glMappings, form.remittance_type]
  );

  const resolvedAccount = useMemo(
    () => resolvedMapping ? (allAccounts.find((a: any) => a.id === resolvedMapping.account_id) ?? null) : null,
    [resolvedMapping, allAccounts]
  );

  useEffect(() => {
    setForm((prev) => ({ ...prev, liability_account_id: resolvedMapping?.account_id ?? "" }));
  }, [resolvedMapping]);

  const bankAccounts = allAccounts.filter(
    (a) => a.is_active && (
      a.account_subtype?.toLowerCase().includes("cash") ||
      a.account_subtype?.toLowerCase().includes("bank") ||
      a.account_subtype?.toLowerCase().includes("checking") ||
      a.account_subtype?.toLowerCase().includes("savings") ||
      a.account_name?.toLowerCase().includes("bank") ||
      a.account_name?.toLowerCase().includes("cash")
    )
  );
  const liabilityAccounts = useMemo(() => {
    const all = allAccounts.filter((a: any) => a.is_active && a.account_type === "Liability");
    // Float the resolved account to the top so it's immediately visible
    if (resolvedMapping?.account_id) {
      return [
        ...all.filter((a: any) => a.id === resolvedMapping.account_id),
        ...all.filter((a: any) => a.id !== resolvedMapping.account_id),
      ];
    }
    return all;
  }, [allAccounts, resolvedMapping]);

  // Outstanding for selected type + period
  const periodOutstanding = useMemo(() => {
    const row = periodData.find(
      (r) => r.remittance_type === form.remittance_type && r.period === form.period
    );
    return row && row.outstanding_amount > 0 ? row.outstanding_amount : null;
  }, [periodData, form.remittance_type, form.period]);

  // Duplicate warning: active remittance already exists for this type + period
  const activeDuplicate = useMemo(
    () => history.find(
      (r) => r.remittance_type === form.remittance_type &&
             r.period === form.period &&
             r.status === "posted"
    ) ?? null,
    [history, form.remittance_type, form.period]
  );

  const canSubmit = !!(
    form.payroll_run_id &&
    form.amount &&
    parseFloat(form.amount) > 0 &&
    form.bank_account_id &&
    form.liability_account_id &&
    !record.isPending
  );

  const handleSave = () => {
    if (!canSubmit) return;
    record.mutate(
      {
        remittance_type: form.remittance_type,
        period: form.period,
        amount: parseFloat(form.amount),
        payment_date: form.payment_date,
        bank_account_id: form.bank_account_id,
        liability_account_id: form.liability_account_id,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
        payroll_run_id: form.payroll_run_id,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Record Remittance Payment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {/* Payroll Run — required, drives period auto-fill */}
          <div>
            <Label>Payroll Run <span className="text-destructive">*</span></Label>
            <Select
              value={form.payroll_run_id}
              onValueChange={(v) => {
                const run = runRows.find((r) => r.run_id === v);
                setForm((f) => ({
                  ...f,
                  payroll_run_id: v,
                  period: run ? run.period_key : f.period,
                }));
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select payroll run…" /></SelectTrigger>
              <SelectContent>
                {runRows.map((r) => (
                  <SelectItem key={r.run_id} value={r.run_id}>
                    {r.run_number} — {r.period_label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Remittance Type</Label>
              <Select
                value={form.remittance_type}
                onValueChange={(v) => setForm({ ...form, remittance_type: v as RemittanceType, liability_account_id: "" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMITTANCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Period <span className="text-muted-foreground text-xs">(YYYY-MM)</span></Label>
              <Input
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
                placeholder="2026-06"
              />
            </div>
            <div>
              <Label>Payment Date</Label>
              <Input
                type="date"
                value={form.payment_date}
                onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
              />
            </div>
          </div>

          {/* Duplicate warning */}
          {activeDuplicate && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                Warning: a remittance for {LIABILITY_LABELS[form.remittance_type]} in {form.period} has already been
                recorded ({formatCurrency(activeDuplicate.amount)}). Submitting will fail unless you void it first.
              </AlertDescription>
            </Alert>
          )}

          {/* Outstanding for this period */}
          {periodOutstanding !== null && (
            <div className="rounded-md border px-4 py-3 bg-muted/30 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Outstanding for {form.period}</p>
                <p className="font-semibold text-sm">{formatCurrency(periodOutstanding)}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, amount: String(periodOutstanding) }))}
              >
                Use Amount
              </Button>
            </div>
          )}

          <div>
            <Label>Amount</Label>
            <Input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
            />
          </div>

          {/* Liability account — auto-resolved from payroll_component_accounts */}
          <div>
            <Label>Liability Account (Dr)</Label>

            {resolvedMapping && resolvedAccount ? (
              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mb-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  Auto-resolved from GL Mapping:{" "}
                  <strong>{(resolvedAccount as any).account_code} — {(resolvedAccount as any).account_name}</strong>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  No GL mapping found for this type — select manually below or{" "}
                  <a
                    href="/settings/payroll-gl-mapping"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:no-underline"
                  >
                    configure in Settings → Payroll GL Mapping
                  </a>
                </span>
              </div>
            )}

            <Select
              value={form.liability_account_id}
              onValueChange={(v) => setForm({ ...form, liability_account_id: v })}
            >
              <SelectTrigger className={!form.liability_account_id ? "border-destructive/40" : ""}>
                <SelectValue placeholder="Select liability account…" />
              </SelectTrigger>
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
              <Label>Reference <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div>
              <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          <Button className="w-full" onClick={handleSave} disabled={!canSubmit}>
            {record.isPending ? "Recording…" : "Record & Post to GL"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function LiabilityCard({ l, onRecord }: { l: LiabilitySummary; onRecord: () => void }) {
  const isHealthy = l.outstanding <= 0;
  return (
    <Card className={isHealthy
      ? "border-green-200 dark:border-green-900/30"
      : l.periodsOverdue > 0
        ? "border-destructive/40"
        : "border-yellow-200 dark:border-yellow-900/30"
    }>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          {l.label}
          {isHealthy
            ? <CheckCircle className="w-4 h-4 text-green-600" />
            : l.periodsOverdue > 0
              ? <AlertTriangle className="w-4 h-4 text-destructive" />
              : <AlertTriangle className="w-4 h-4 text-yellow-500" />
          }
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
          <span className={`font-mono ${isHealthy ? "text-green-600" : "text-destructive"}`}>
            {formatCurrency(l.outstanding)}
          </span>
        </div>

        {l.periodsOverdue > 0 && (
          <p className="text-xs text-destructive font-medium">
            {l.periodsOverdue} period{l.periodsOverdue > 1 ? "s" : ""} overdue
            {l.oldestOverduePeriod && ` (oldest: ${l.oldestOverduePeriod})`}
          </p>
        )}
        {l.periodsDueSoon > 0 && l.periodsOverdue === 0 && (
          <p className="text-xs text-yellow-600 font-medium">
            {l.periodsDueSoon} period{l.periodsDueSoon > 1 ? "s" : ""} due within 7 days
          </p>
        )}

        {l.outstanding > 0 && (
          <Button size="sm" variant="outline" className="w-full mt-1" onClick={onRecord}>
            Record Payment
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PayrollLiabilities() {
  const navigate = useNavigate();
  const { data: liabilities = [], isLoading: liabLoad } = usePayrollLiabilities();
  const { data: periodRows = [] } = usePayrollLiabilityByPeriod();
  const { data: runRows = [] } = usePayrollLiabilityByRun();
  const { data: history = [] } = usePayrollRemittanceHistory();

  // Check which remittance types have a credit-side GL mapping configured — client-side from cached data
  const { data: pageGlMappings = [] } = usePayrollGLMappings();
  const missingMappings = useMemo(
    () => (["EPF_EMPLOYEE", "EPF_EMPLOYER", "ETF_EMPLOYER"] as const).filter(
      (code) => !pageGlMappings.some(m => m.component_code === code && m.posting_side === "credit" && m.is_active)
    ),
    [pageGlMappings]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<RemittanceType | undefined>(undefined);
  const [voidTarget, setVoidTarget] = useState<PayrollRemittance | null>(null);

  // By Period filters
  const [periodTypeFilter, setPeriodTypeFilter] = useState<string>("ALL");
  const [periodStatusFilter, setPeriodStatusFilter] = useState<string>("ALL");

  // History filters
  const [historyTypeFilter, setHistoryTypeFilter] = useState<string>("ALL");
  const [historyPeriodFilter, setHistoryPeriodFilter] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");

  const openRecordFor = (type?: RemittanceType) => {
    setDefaultType(type);
    setDialogOpen(true);
  };

  // Filtered period rows
  const filteredPeriodRows = useMemo(() => {
    let rows = periodRows as PeriodLiabilityRow[];
    if (periodTypeFilter !== "ALL") rows = rows.filter((r) => r.remittance_type === periodTypeFilter);
    if (periodStatusFilter !== "ALL") {
      rows = rows.filter((r) => {
        if (periodStatusFilter === "PENDING") return r.remittance_status === "PENDING" || r.remittance_status === "DUE_SOON";
        if (periodStatusFilter === "OVERDUE") return r.remittance_status === "OVERDUE";
        if (periodStatusFilter === "REMITTED") return r.remittance_status === "FULLY_REMITTED";
        return true;
      });
    }
    return rows;
  }, [periodRows, periodTypeFilter, periodStatusFilter]);

  // Filtered history rows
  const filteredHistory = useMemo(() => {
    let rows = history as PayrollRemittance[];
    if (historyTypeFilter !== "ALL") rows = rows.filter((r) => r.remittance_type === historyTypeFilter);
    if (historyPeriodFilter) rows = rows.filter((r) => r.period.includes(historyPeriodFilter));
    if (historyDateFrom) rows = rows.filter((r) => r.payment_date >= historyDateFrom);
    if (historyDateTo) rows = rows.filter((r) => r.payment_date <= historyDateTo);
    return rows;
  }, [history, historyTypeFilter, historyPeriodFilter, historyDateFrom, historyDateTo]);

  const handleExportHistory = () => {
    const headers = ["Date", "Type", "Period", "Amount", "Reference", "Notes", "Journal Entry ID", "Status"];
    const rows = filteredHistory.map((r) => [
      r.payment_date,
      LIABILITY_LABELS[r.remittance_type as RemittanceType] ?? r.remittance_type,
      r.period,
      r.amount,
      r.reference ?? "",
      r.notes ?? "",
      r.journal_entry_id ?? "",
      r.status,
    ]);
    exportToCsv(`payroll-remittances-${format(new Date(), "yyyyMMdd")}.csv`, headers, rows);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-yellow-500" />
            Payroll Liability Tracking
          </h1>
          <p className="text-sm text-muted-foreground">Track EPF and ETF obligations; record and reconcile remittance payments</p>
        </div>
        <Button onClick={() => openRecordFor(undefined)}>Record Remittance</Button>
      </div>

      {missingMappings.length > 0 && (
        <Alert className="border-yellow-400/40 bg-yellow-50/50 dark:bg-yellow-900/10">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
          <AlertDescription className="text-sm">
            <strong>GL Mapping incomplete.</strong>{" "}
            The following types have no liability account mapped and will require manual selection:{" "}
            {missingMappings.map((c) => REMITTANCE_LABELS[c]).join(", ")}.{" "}
            <a
              href="/settings/payroll-gl-mapping"
              className="underline font-medium hover:no-underline"
            >
              Fix in Settings → Payroll GL Mapping →
            </a>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="by-period">By Period</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ── Summary tab ──────────────────────────────────────── */}
        <TabsContent value="summary" className="space-y-6 pt-4">
          {liabLoad ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {liabilities.map((l) => (
                <LiabilityCard key={l.type} l={l} onRecord={() => openRecordFor(l.type)} />
              ))}
            </div>
          )}

          {/* Run breakdown */}
          <Card>
            <CardHeader><CardTitle>Liability by Payroll Run</CardTitle></CardHeader>
            <CardContent>
              {runRows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No processed payroll runs yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">EPF Employee</TableHead>
                      <TableHead className="text-right">EPF Total</TableHead>
                      <TableHead className="text-right">ETF Total</TableHead>
                      <TableHead>Remittance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runRows.map((r) => (
                      <TableRow key={r.run_id}>
                        <TableCell className="font-mono text-sm">{r.run_number}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.period_label}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{r.run_status}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(r.epf_employee)}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(r.epf_total)}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(r.etf_total)}</TableCell>
                        <TableCell><RunStatusBadge status={r.remittance_status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── By Period tab ─────────────────────────────────────── */}
        <TabsContent value="by-period" className="space-y-4 pt-4">
          {/* Filter bar */}
          <div className="flex gap-3 flex-wrap">
            <Select value={periodTypeFilter} onValueChange={setPeriodTypeFilter}>
              <SelectTrigger className="w-52"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {REMITTANCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={periodStatusFilter} onValueChange={setPeriodStatusFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="OVERDUE">Overdue</SelectItem>
                <SelectItem value="REMITTED">Remitted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="pt-4">
              {filteredPeriodRows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No data for the selected filters.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Accrued</TableHead>
                      <TableHead className="text-right">Remitted</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPeriodRows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm">{r.period}</TableCell>
                        <TableCell className="text-sm">
                          {LIABILITY_LABELS[r.remittance_type] ?? r.remittance_type}
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(r.accrued_amount)}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{formatCurrency(r.remitted_amount)}</TableCell>
                        <TableCell className={`text-right font-mono font-semibold ${r.outstanding_amount > 0 ? "text-destructive" : "text-green-600"}`}>
                          {formatCurrency(r.outstanding_amount)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.due_date}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.remittance_status} dueDate={r.due_date} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History tab ───────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4 pt-4">
          {/* Filter bar */}
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
              <Select value={historyTypeFilter} onValueChange={setHistoryTypeFilter}>
                <SelectTrigger className="w-52"><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  {REMITTANCE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Period (YYYY-MM)</Label>
              <Input
                value={historyPeriodFilter}
                onChange={(e) => setHistoryPeriodFilter(e.target.value)}
                placeholder="e.g. 2026-05"
                className="w-36"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Date from</Label>
              <Input
                type="date"
                value={historyDateFrom}
                onChange={(e) => setHistoryDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Date to</Label>
              <Input
                type="date"
                value={historyDateTo}
                onChange={(e) => setHistoryDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportHistory}
              disabled={filteredHistory.length === 0}
              className="mb-0.5"
            >
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          </div>

          <Card>
            <CardContent className="pt-4">
              {filteredHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No remittances match the selected filters.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Journal</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHistory.map((rem) => (
                      <TableRow key={rem.id} className={rem.status === "voided" ? "opacity-50" : ""}>
                        <TableCell className="text-sm">{rem.payment_date}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs whitespace-nowrap">
                            {LIABILITY_LABELS[rem.remittance_type as RemittanceType] ?? rem.remittance_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{rem.period}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{rem.reference ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatCurrency(rem.amount)}
                        </TableCell>
                        <TableCell>
                          {rem.status === "voided"
                            ? <Badge className="bg-muted text-muted-foreground border-0">Voided</Badge>
                            : <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">Posted</Badge>
                          }
                        </TableCell>
                        <TableCell>
                          {rem.journal_entry_id ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-0 text-primary text-xs"
                              onClick={() => navigate(`/accounting/journals/${rem.journal_entry_id}`)}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              View
                            </Button>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {rem.status === "posted" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-1 text-destructive hover:text-destructive"
                              onClick={() => setVoidTarget(rem)}
                              title="Void remittance"
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RecordRemittanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultType={defaultType}
      />

      <VoidConfirmDialog
        rem={voidTarget}
        open={!!voidTarget}
        onOpenChange={(v) => { if (!v) setVoidTarget(null); }}
      />
    </div>
  );
}
