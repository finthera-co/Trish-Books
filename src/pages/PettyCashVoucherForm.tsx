import { useState, useRef, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Save, Upload, X, AlertTriangle, AlertCircle } from "lucide-react";
import BudgetWarningBanner from "@/components/budgets/BudgetWarningBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import {
  usePettyCashAccounts,
  usePettyCashLineAccounts,
  useTenantUsers,
  useGenerateVoucherNumber,
  useCreatePCVoucher,
  useUploadReceipt,
} from "@/hooks/usePettyCash";
import { useFiscalPeriods } from "@/hooks/useFiscalPeriodBalances";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";

interface VoucherLine {
  date: string;
  description: string;
  account_id: string;
  amount: number;
}

type LineErrors = {
  account?: string;
  amount?: string;
};
type LineWarnings = {
  inactive?: string;
  duplicate?: string;
};

export default function PettyCashVoucherForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedAccount = searchParams.get("account") || "";

  const { data: pcAccounts } = usePettyCashAccounts();
  const { data: lineAccounts } = usePettyCashLineAccounts();
  const { data: users } = useTenantUsers();
  const { data: voucherNumber } = useGenerateVoucherNumber();
  const { data: periods } = useFiscalPeriods();
  const createVoucher = useCreatePCVoucher();
  const uploadReceipt = useUploadReceipt();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().split("T")[0];

  const [date, setDate] = useState(today);
  const [paidTo, setPaidTo] = useState("");
  const [pcAccountId, setPcAccountId] = useState(preselectedAccount);
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [receiptPaths, setReceiptPaths] = useState<string[]>([]);
  const [lines, setLines] = useState<VoucherLine[]>([
    { date: today, description: "", account_id: "", amount: 0 },
  ]);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (preselectedAccount) setPcAccountId(preselectedAccount);
  }, [preselectedAccount]);

  const total = lines.reduce((s, l) => s + l.amount, 0);

  // Linked GL account behind the selected petty cash fund
  const pettyCashGlAccountId = useMemo(() => {
    const row: any = pcAccounts?.find((a) => a.id === pcAccountId);
    return row?.account_id as string | undefined;
  }, [pcAccounts, pcAccountId]);

  // Active vs inactive grouped buckets for the dropdown
  const groupedAccounts = useMemo(() => {
    const list = (lineAccounts ?? []).filter((a: any) => a.id !== pettyCashGlAccountId);
    const groups: Record<string, any[]> = {
      Expense: [],
      "Other Expense": [],
      "Cost of Goods Sold": [],
      Asset: [],
      Inactive: [],
    };
    for (const a of list) {
      if (!a.is_active) groups["Inactive"].push(a);
      else groups[a.account_type]?.push(a);
    }
    return groups;
  }, [lineAccounts, pettyCashGlAccountId]);

  const accountById = useMemo(() => {
    const map = new Map<string, any>();
    for (const a of lineAccounts ?? []) map.set(a.id, a);
    return map;
  }, [lineAccounts]);

  // Period lock check
  const periodLockError = useMemo(() => {
    const locked = (periods ?? []).find(
      (p: any) => p.status === "closed" && date >= p.period_start && date <= p.period_end,
    );
    return locked
      ? `The voucher date falls within a closed period (${locked.name}). Unlock the period or change the date.`
      : null;
  }, [periods, date]);

  // Per-line errors & warnings
  const { lineErrors, lineWarnings, hasHardErrors } = useMemo(() => {
    const errs: LineErrors[] = [];
    const warns: LineWarnings[] = [];
    const counts = new Map<string, number>();
    for (const l of lines) {
      if (l.account_id) counts.set(l.account_id, (counts.get(l.account_id) || 0) + 1);
    }
    let hard = false;
    lines.forEach((l) => {
      const e: LineErrors = {};
      const w: LineWarnings = {};
      if (!l.account_id) {
        e.account = "Expense account is required";
      } else {
        const acc = accountById.get(l.account_id);
        if (pettyCashGlAccountId && l.account_id === pettyCashGlAccountId) {
          e.account =
            "Selected account cannot be the same as the petty cash fund account. This would result in an invalid journal entry.";
        } else if (acc && !["Asset", "Expense", "Other Expense", "Cost of Goods Sold"].includes(acc.account_type)) {
          e.account = "Only expense or asset accounts can be used in petty cash disbursements.";
        }
        if (acc && acc.is_active === false) {
          w.inactive = "This account is inactive. Confirm before proceeding.";
        }
        if ((counts.get(l.account_id) || 0) > 1) {
          w.duplicate = "This account is already used on another line. Consider consolidating.";
        }
      }
      if (!(l.amount > 0)) e.amount = "Amount must be greater than zero";
      if (e.account || e.amount) hard = true;
      errs.push(e);
      warns.push(w);
    });
    return { lineErrors: errs, lineWarnings: warns, hasHardErrors: hard };
  }, [lines, accountById, pettyCashGlAccountId]);

  const headerError = !pcAccountId ? "Petty cash account is required" : null;
  const blockSave = hasHardErrors || !!headerError || !!periodLockError || total <= 0;

  const addLine = () => setLines([...lines, { date: today, description: "", account_id: "", amount: 0 }]);
  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };
  const updateLine = (idx: number, field: keyof VoucherLine, value: any) => {
    const updated = [...lines];
    (updated[idx] as any)[field] = field === "amount" ? Number(value) : value;
    setLines(updated);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const path = await uploadReceipt.mutateAsync({ file });
        setReceiptPaths((prev) => [...prev, path]);
        toast.success(`Uploaded ${file.name}`);
      } catch { /* error already toasted */ }
    }
    e.target.value = "";
  };

  const removeReceipt = (idx: number) => {
    setReceiptPaths((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    setSubmitAttempted(true);
    if (!voucherNumber) return toast.error("Voucher number not generated");
    if (headerError) return toast.error(headerError);
    if (periodLockError) return toast.error(periodLockError);
    if (hasHardErrors) {
      // Surface the most critical message
      const same = lineErrors.find((e) => e.account?.includes("same as the petty cash"));
      if (same) {
        toast.error("Double-entry error: Debit and credit cannot target the same account.");
      } else {
        toast.error("Please resolve the errors highlighted on the voucher lines.");
      }
      return;
    }
    if (total <= 0) return toast.error("Total must be greater than 0");

    createVoucher.mutate(
      {
        voucher_number: voucherNumber,
        date,
        paid_to: paidTo,
        petty_cash_account_id: pcAccountId,
        authorized_by: authorizedBy || undefined,
        receipt_urls: receiptPaths,
        lines,
      },
      { onSuccess: () => navigate("/banking/petty-cash") },
    );
  };

  const showSummary = submitAttempted && (hasHardErrors || !!periodLockError);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">New Petty Cash Voucher</h1>
          <p className="page-description">Record petty cash expenses</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-mono">{voucherNumber || "Generating..."}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Header fields */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={!!periodLockError}
              />
              {periodLockError && (
                <p className="text-xs text-destructive mt-1">{periodLockError}</p>
              )}
            </div>
            <div>
              <Label>Paid To</Label>
              <Input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="Recipient name" />
            </div>
            <div>
              <Label>Petty Cash Account</Label>
              <Select value={pcAccountId} onValueChange={setPcAccountId}>
                <SelectTrigger aria-invalid={submitAttempted && !!headerError}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {pcAccounts?.filter((a) => a.is_active).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {submitAttempted && headerError && (
                <p className="text-xs text-destructive mt-1">{headerError}</p>
              )}
            </div>
            <div>
              <Label>Authorized By</Label>
              <Select value={authorizedBy} onValueChange={setAuthorizedBy}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {users?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.first_name} {u.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Validation summary banner */}
          {showSummary && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Please resolve the following before saving:</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5 mt-1 space-y-0.5 text-sm">
                  {periodLockError && <li>{periodLockError}</li>}
                  {lineErrors.map((e, i) =>
                    e.account || e.amount ? (
                      <li key={i}>
                        Line {i + 1}: {e.account || e.amount}
                      </li>
                    ) : null,
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Lines table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Voucher Lines</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="w-3 h-3 mr-1" /> Add Line
              </Button>
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left w-12">S.No</th>
                    <th className="px-3 py-2 text-left w-32">Date</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-left w-64">Account</th>
                    <th className="px-3 py-2 text-right w-32">Amount</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const e = lineErrors[idx] || {};
                    const w = lineWarnings[idx] || {};
                    const showErr = submitAttempted && (e.account || e.amount);
                    const showWarn = w.inactive || w.duplicate;
                    const errId = `line-${idx}-account-err`;
                    return (
                      <tr key={idx} className="border-t align-top">
                        <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-1">
                          <Input type="date" value={line.date} onChange={(ev) => updateLine(idx, "date", ev.target.value)} className="h-8 text-xs" />
                        </td>
                        <td className="px-3 py-1">
                          <Input value={line.description} onChange={(ev) => updateLine(idx, "description", ev.target.value)} placeholder="Description" className="h-8 text-xs" />
                        </td>
                        <td className="px-3 py-1">
                          <Select value={line.account_id} onValueChange={(v) => updateLine(idx, "account_id", v)}>
                            <SelectTrigger
                              className={`h-8 text-xs ${
                                showErr && e.account
                                  ? "border-destructive ring-1 ring-destructive"
                                  : showWarn
                                  ? "border-yellow-500"
                                  : ""
                              }`}
                              aria-invalid={!!(showErr && e.account)}
                              aria-describedby={showErr && e.account ? errId : undefined}
                            >
                              <SelectValue placeholder="Select account" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(groupedAccounts).map(([groupName, items]) =>
                                items.length === 0 ? null : (
                                  <SelectGroup key={groupName}>
                                    <SelectLabel
                                      className={
                                        groupName === "Inactive" ? "text-muted-foreground opacity-70" : ""
                                      }
                                    >
                                      {groupName === "Inactive" ? "⚠ Inactive Accounts" : `${groupName} Accounts`}
                                    </SelectLabel>
                                    {items.map((a: any) => (
                                      <SelectItem
                                        key={a.id}
                                        value={a.id}
                                        className={!a.is_active ? "opacity-70" : ""}
                                      >
                                        {a.account_code} – {a.account_name}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                          {showErr && e.account && (
                            <p id={errId} className="text-[11px] text-destructive mt-1 leading-tight">
                              {e.account}
                            </p>
                          )}
                          {!e.account && (w.inactive || w.duplicate) && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {w.inactive && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-yellow-500 text-yellow-700 dark:text-yellow-400 gap-1"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  Inactive
                                </Badge>
                              )}
                              {w.duplicate && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-yellow-500 text-yellow-700 dark:text-yellow-400 gap-1"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  Duplicate account
                                </Badge>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1">
                          <Input
                            type="number"
                            value={line.amount || ""}
                            onChange={(ev) => updateLine(idx, "amount", ev.target.value)}
                            className={`h-8 text-xs text-right ${
                              showErr && e.amount ? "border-destructive ring-1 ring-destructive" : ""
                            }`}
                            min={0}
                            step="0.01"
                            aria-invalid={!!(showErr && e.amount)}
                          />
                          {showErr && e.amount && (
                            <p className="text-[11px] text-destructive mt-1 leading-tight">{e.amount}</p>
                          )}
                        </td>
                        <td className="px-3 py-1 text-center">
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50">
                    <td colSpan={4} className="px-3 py-2 text-right font-semibold">Total</td>
                    <td className="px-3 py-2 text-right font-bold">{formatCurrency(total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Budget Warnings */}
          {lines.filter(l => l.account_id && l.amount > 0).map((line, idx) => (
            <BudgetWarningBanner
              key={`budget-${idx}-${line.account_id}`}
              accountId={line.account_id}
              amount={line.amount}
              transactionDate={date}
            />
          ))}

          {/* Receipt attachments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Receipt Attachments</Label>
              <div>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple className="hidden" onChange={handleFileUpload} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadReceipt.isPending}>
                  <Upload className="w-3 h-3 mr-1" /> {uploadReceipt.isPending ? "Uploading..." : "Upload"}
                </Button>
              </div>
            </div>
            {receiptPaths.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {receiptPaths.map((path, idx) => (
                  <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs">
                    <span>Receipt {idx + 1}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-4 w-4" onClick={() => removeReceipt(idx)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Prepared by: <span className="font-medium text-foreground">Current User</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate("/banking/petty-cash")}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={createVoucher.isPending || (submitAttempted && blockSave)}
              >
                <Save className="w-4 h-4 mr-1" /> {createVoucher.isPending ? "Saving..." : "Save Voucher"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
