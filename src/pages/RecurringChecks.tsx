import { useState } from "react";
import { Plus, Trash2, Pause, Play, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import {
  useRecurringCheckTemplates, useCreateRecurringCheckTemplate, usePauseRecurringCheckTemplate,
  useDeleteRecurringCheckTemplate, useTriggerRecurringChecks,
} from "@/hooks/useRecurringChecks";
import type { VoucherLine } from "@/hooks/usePaymentVouchers";
import { useVendorsWithBalance } from "@/hooks/useSubledgerData";
import { useAccounts, useCustomers } from "@/hooks/useData";
import AccountCombobox from "@/components/shared/AccountCombobox";
import AccountSelector from "@/components/shared/AccountSelector";
import { format } from "date-fns";

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

function emptyLine(): VoucherLine {
  return { account_id: "", description: "", amount: 0 };
}

export default function RecurringChecks() {
  const { data: templates, isLoading } = useRecurringCheckTemplates();
  const { data: vendors } = useVendorsWithBalance();
  const { data: customers } = useCustomers();
  const { data: accounts } = useAccounts();
  const createTemplate = useCreateRecurringCheckTemplate();
  const pauseTemplate = usePauseRecurringCheckTemplate();
  const deleteTemplate = useDeleteRecurringCheckTemplate();
  const triggerNow = useTriggerRecurringChecks();

  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const [payeeType, setPayeeType] = useState<"vendor" | "customer">("vendor");
  const [payeeId, setPayeeId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "quarterly" | "yearly">("monthly");
  const [intervalCount, setIntervalCount] = useState("1");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState("");
  const [maxOccurrences, setMaxOccurrences] = useState("");
  const [lines, setLines] = useState<VoucherLine[]>([emptyLine()]);

  const expenseAccounts = (accounts as any[] ?? []).filter(
    (a) => a.is_active && ["Expense", "Cost of Goods Sold", "Other Expense", "Liability"].includes(a.account_type)
  );
  const payeeOptions = payeeType === "vendor" ? (vendors ?? []) : (customers ?? []);

  const resetForm = () => {
    setPayeeType("vendor"); setPayeeId(""); setPaymentAccountId("");
    setTemplateName(""); setFrequency("monthly"); setIntervalCount("1");
    setStartDate(format(new Date(), "yyyy-MM-dd")); setEndDate(""); setMaxOccurrences("");
    setLines([emptyLine()]);
  };

  const handleCreate = async () => {
    const validLines = lines.filter((l) => l.account_id && l.amount > 0);
    if (!payeeId || !paymentAccountId || !templateName.trim() || validLines.length === 0) return;
    await createTemplate.mutateAsync({
      payment_account_id: paymentAccountId,
      payee_id: payeeType === "customer" ? payeeId : undefined,
      payee_vendor_id: payeeType === "vendor" ? payeeId : undefined,
      template_name: templateName.trim(),
      frequency,
      interval_count: Math.max(1, parseInt(intervalCount) || 1),
      start_date: startDate,
      end_date: endDate || null,
      max_occurrences: maxOccurrences ? parseInt(maxOccurrences) : null,
      lines: validLines,
    });
    setShowNew(false);
    resetForm();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Recurring Checks</h1>
          <p className="text-sm text-muted-foreground">Automatically write checks on a schedule — rent, subscriptions, retainers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => triggerNow.mutate()} disabled={triggerNow.isPending}>
            <RefreshCcw className="w-4 h-4 mr-2" /> {triggerNow.isPending ? "Running…" : "Run Now"}
          </Button>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Template
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-12 text-muted-foreground">Loading…</p>
          ) : !templates || templates.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No recurring check templates yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => {
                  const payeeName = t.payee_vendor_id
                    ? (vendors ?? []).find((v: any) => v.id === t.payee_vendor_id)?.name ?? "—"
                    : (customers ?? []).find((c: any) => c.id === t.payee_id)?.name ?? "—";
                  const total = (t.recurring_check_template_lines ?? []).reduce((s, l) => s + Number(l.amount), 0);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.template_name}</TableCell>
                      <TableCell>{payeeName}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        Every {t.interval_count > 1 ? `${t.interval_count} ` : ""}{t.frequency}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(t.next_run_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(total)}</TableCell>
                      <TableCell>
                        <Badge variant={t.status === "active" ? "default" : t.status === "paused" ? "secondary" : "outline"}>
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {t.status !== "completed" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t.status === "active" ? "Pause" : "Resume"}
                              onClick={() => pauseTemplate.mutate({ id: t.id, status: t.status === "active" ? "paused" : "active" })}
                            >
                              {t.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget({ id: t.id, name: t.template_name })}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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

      {/* New template dialog */}
      <Dialog open={showNew} onOpenChange={(v) => { setShowNew(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Recurring Check Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Template Name *</Label>
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Monthly Rent" />
              </div>
              <div>
                <Label>Bank Account *</Label>
                <AccountSelector
                  value={paymentAccountId}
                  onChange={setPaymentAccountId}
                  types={["Asset"]}
                  placeholder="Search cash / bank account…"
                />
              </div>
              <div>
                <Label>Payee *</Label>
                <div className="flex gap-2">
                  <Select value={payeeType} onValueChange={(v) => { setPayeeType(v as "vendor" | "customer"); setPayeeId(""); }}>
                    <SelectTrigger className="w-[110px] shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vendor">Vendor</SelectItem>
                      <SelectItem value="customer">Customer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={payeeId} onValueChange={setPayeeId}>
                    <SelectTrigger><SelectValue placeholder="Select payee" /></SelectTrigger>
                    <SelectContent>
                      {payeeOptions.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Frequency</Label>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Every N periods</Label>
                <Input type="number" min="1" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} />
              </div>
              <div>
                <Label>Start Date *</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label>End Date (optional)</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div>
                <Label>Max Occurrences (optional)</Label>
                <Input type="number" min="1" value={maxOccurrences} onChange={(e) => setMaxOccurrences(e.target.value)} placeholder="Unlimited" />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Every generated check posts immediately to the ledger — checks have no draft state to hold them in for review.
            </p>

            <div>
              <Label className="mb-2 block">Lines</Label>
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <div className="flex-1">
                      <AccountCombobox
                        options={expenseAccounts}
                        value={line.account_id}
                        onChange={(id) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, account_id: id } : l)))}
                        placeholder="Account"
                      />
                    </div>
                    <Input
                      className="flex-1"
                      placeholder="Description"
                      value={line.description}
                      onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, description: e.target.value } : l)))}
                    />
                    <Input
                      type="number" step="0.01" min="0" className="w-32 text-right"
                      placeholder="Amount"
                      value={line.amount || ""}
                      onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, amount: parseFloat(e.target.value) || 0 } : l)))}
                    />
                    <Button
                      variant="ghost" size="icon"
                      disabled={lines.length <= 1}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus className="w-4 h-4 mr-1" /> Add line
              </Button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createTemplate.isPending}>
              {createTemplate.isPending ? "Creating…" : "Create Template"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the schedule — checks already generated from it are unaffected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) return;
                await deleteTemplate.mutateAsync(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
