import { useState, useMemo, useEffect } from "react";
import { Plus, Trash2, Save, AlertTriangle, Edit2, Ban, Calendar, Shield, FileCheck, Lock, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveAccounts } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/currency";
import { useOBEBalance } from "@/hooks/useOpeningBalanceEquity";
import {
  useSystemSetting,
  useSaveSystemSetting,
  useOpeningBalanceStatus,
  useFinalizeOpeningBalances,
  useRevertToDraft,
} from "@/hooks/useOpeningBalanceSettings";
import {
  useFiscalPeriods,
} from "@/hooks/useFiscalPeriodBalances";
import {
  useOpeningBalanceEntries,
  useSaveQuickBooksOB,
  useDeleteOBEntry,
  useVoidOBEntry,
} from "@/hooks/useQuickBooksOBE";
import FiscalPeriodSelector from "@/components/FiscalPeriodSelector";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  getNormalBalance,
  isOpeningBalanceEligible,
  requiresSubledger,
  isControlSubtype,
  isOpeningBalanceEquityAccount,
} from "@/lib/accountTypes";
import CreateLedgerModal from "@/components/opening-balances/CreateLedgerModal";
import OBSubledgerBreakdown from "@/components/opening-balances/OBSubledgerBreakdown";

export default function OpeningBalances() {
  const { appUser } = useAuth();
  const { data: accounts } = useActiveAccounts();
  const { data: obeBalance } = useOBEBalance();
  const { data: obeClosed } = useSystemSetting("obe_closed");
  const { data: obStatus } = useOpeningBalanceStatus();
  const { data: obDate } = useSystemSetting("opening_balance_date");
  const saveSettingMutation = useSaveSystemSetting();
  const finalizeMutation = useFinalizeOpeningBalances();
  const revertMutation = useRevertToDraft();

  const { data: periods } = useFiscalPeriods();
  const [selectedPeriodId, setSelectedPeriodId] = useState("");

  useEffect(() => {
    if (periods?.length && !selectedPeriodId) {
      const openPeriod = periods.find((p: any) => p.status === "open");
      if (openPeriod) setSelectedPeriodId(openPeriod.id);
      else setSelectedPeriodId(periods[0].id);
    }
  }, [periods, selectedPeriodId]);

  const selectedPeriod = periods?.find((p: any) => p.id === selectedPeriodId) as any;
  const isPeriodClosed = selectedPeriod?.status === "closed";
  const isClosed = obeClosed === "true";
  const isFinalized = obStatus === "finalized";
  const isDraft = !obStatus || obStatus === "draft";
  const isEditable = isDraft && !isClosed && !isPeriodClosed;

  // Existing OB entries
  const { data: obEntries, isLoading: loadingEntries } = useOpeningBalanceEntries();
  const saveMutation = useSaveQuickBooksOB();
  const deleteMutation = useDeleteOBEntry();
  const voidMutation = useVoidOBEntry();

  // New entry form
  const [formAccountId, setFormAccountId] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formDate, setFormDate] = useState(() => obDate || new Date().toISOString().slice(0, 10));
  const [formDescription, setFormDescription] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [showCreateLedger, setShowCreateLedger] = useState(false);
  const [subledgerValid, setSubledgerValid] = useState(true);

  // Update date from system setting
  useEffect(() => {
    if (obDate && formDate !== obDate) setFormDate(obDate);
  }, [obDate]);

  // Filter accounts for dropdown
  const selectableAccounts = useMemo(() => {
    if (!accounts) return [];
    const existingAccountIds = new Set(
      (obEntries || [])
        .filter((e: any) => e.status === "posted")
        .map((e: any) => e.account_id)
    );
    return (accounts as any[]).filter((a) => {
      if (a.is_system && isOpeningBalanceEquityAccount(a)) return false;
      if (!isOpeningBalanceEligible(a.account_type)) return false;
      if (isControlSubtype(a.account_subtype)) return false;
      // If editing, allow the current account
      if (editingEntryId) {
        const editEntry = (obEntries || []).find((e: any) => e.id === editingEntryId);
        if (editEntry && editEntry.account_id === a.id) return true;
      }
      if (existingAccountIds.has(a.id)) return false;
      return true;
    });
  }, [accounts, obEntries, editingEntryId]);

  // Summary calculations
  const postedEntries = useMemo(() => {
    return (obEntries || []).filter((e: any) => e.status === "posted");
  }, [obEntries]);

  const totalDebits = useMemo(() => {
    return postedEntries.reduce((s: number, e: any) => {
      const acct = (accounts || []).find((a: any) => a.id === e.account_id) as any;
      if (!acct) return s;
      const normal = getNormalBalance(acct.account_type);
      const amt = Math.abs(Number(e.amount_signed));
      const isPositive = Number(e.amount_signed) >= 0;
      if ((normal === "Debit" && isPositive) || (normal === "Credit" && !isPositive)) return s + amt;
      return s;
    }, 0);
  }, [postedEntries, accounts]);

  const totalCredits = useMemo(() => {
    return postedEntries.reduce((s: number, e: any) => {
      const acct = (accounts || []).find((a: any) => a.id === e.account_id) as any;
      if (!acct) return s;
      const normal = getNormalBalance(acct.account_type);
      const amt = Math.abs(Number(e.amount_signed));
      const isPositive = Number(e.amount_signed) >= 0;
      if ((normal === "Credit" && isPositive) || (normal === "Debit" && !isPositive)) return s + amt;
      return s;
    }, 0);
  }, [postedEntries, accounts]);

  const resetForm = () => {
    setFormAccountId("");
    setFormAmount("");
    setFormDescription("");
    setEditingEntryId(null);
  };

  const handleSave = () => {
    if (!formAccountId) { toast.error("Select an account"); return; }
    const amt = parseFloat(formAmount);
    if (isNaN(amt) || amt === 0) { toast.error("Enter a non-zero amount"); return; }

    saveMutation.mutate(
      {
        accountId: formAccountId,
        amountSigned: amt,
        asOfDate: formDate,
        description: formDescription || undefined,
        editEntryId: editingEntryId || undefined,
      },
      { onSuccess: () => resetForm() }
    );
  };

  const handleEdit = (entry: any) => {
    setFormAccountId(entry.account_id);
    setFormAmount(String(entry.amount_signed));
    setFormDate(entry.as_of_date || formDate);
    setFormDescription(entry.description || "");
    setEditingEntryId(entry.id);
  };

  const handleSaveDate = () => {
    if (!formDate) { toast.error("Select a date"); return; }
    saveSettingMutation.mutate(
      { key: "opening_balance_date", value: formDate },
      { onSuccess: () => toast.success("Opening balance date saved") }
    );
  };

  const handleLedgerCreated = (accountId: string, openingBalance?: number) => {
    setFormAccountId(accountId);
    if (openingBalance && openingBalance > 0) {
      setFormAmount(String(openingBalance));
    }
  };

  // Read-only view for closed/finalized
  if (isClosed || (isFinalized && !isPeriodClosed)) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Opening Balances</h1>
            <p className="page-description">QuickBooks-style opening balance entries</p>
          </div>
          <div className="flex gap-2 items-center">
            <FiscalPeriodSelector value={selectedPeriodId} onChange={setSelectedPeriodId} />
            {isFinalized && !isClosed && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={revertMutation.isPending}>Revert to Draft</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revert to Draft?</AlertDialogTitle>
                    <AlertDialogDescription>This will unlock opening balance editing.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => revertMutation.mutate()}>Revert</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            {isClosed ? (
              <>
                <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
                <h2 className="text-lg font-semibold text-foreground">Opening Balance Equity closed</h2>
                <p className="text-sm text-muted-foreground">Opening balance editing is locked.</p>
              </>
            ) : (
              <>
                <Shield className="w-10 h-10 text-primary mx-auto" />
                <h2 className="text-lg font-semibold text-foreground">Opening Balances Finalized</h2>
                <p className="text-sm text-muted-foreground">Revert to draft to make changes.</p>
              </>
            )}
          </CardContent>
        </Card>
        <OBTable entries={postedEntries} accounts={accounts} isEditable={false} />
        <OBSummary totalDebits={totalDebits} totalCredits={totalCredits} obeBalance={obeBalance} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Opening Balances</h1>
          <p className="page-description">
            Enter opening balances per account. The system automatically posts using normal balance rules.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <FiscalPeriodSelector value={selectedPeriodId} onChange={setSelectedPeriodId} />
          <Badge variant="outline" className="text-xs">
            {isPeriodClosed ? "🔒 Closed" : isDraft ? "Draft" : "Finalized"}
          </Badge>
          {!isPeriodClosed && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <FileCheck className="w-4 h-4 mr-1" /> Finalize
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Finalize Opening Balances?</AlertDialogTitle>
                  <AlertDialogDescription>This will lock opening balance entries.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => finalizeMutation.mutate()}>Finalize</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {isPeriodClosed && (
        <div className="bg-warning/10 text-warning border border-warning/20 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <Lock className="w-4 h-4" />
          This period is closed. Opening balances are read-only.
        </div>
      )}

      {/* OBE Balance */}
      {obeBalance && obeBalance.type !== "zero" && (
        <div className="flex items-center gap-3 bg-info/10 text-info border border-info/20 rounded-lg px-4 py-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-semibold">Opening Balance Equity: {formatCurrency(obeBalance.balance)}</span>
            <span className="text-info/80 ml-1">({obeBalance.type === "debit" ? "Debit" : "Credit"})</span>
            <span className="text-info/60 ml-2">— This balance will resolve when all accounts are properly classified.</span>
          </div>
        </div>
      )}

      {/* Entry Form */}
      {isEditable && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              {editingEntryId ? "Edit Opening Balance" : "Add Opening Balance"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              {/* Account */}
              <div className="md:col-span-4 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Account</label>
                <div className="flex gap-1">
                  <select
                    value={formAccountId}
                    onChange={(e) => {
                      if (e.target.value === "__create__") {
                        setShowCreateLedger(true);
                      } else {
                        setFormAccountId(e.target.value);
                      }
                    }}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Select account…</option>
                    <option value="__create__" className="font-medium">＋ Create New Ledger</option>
                    {selectableAccounts.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.account_code} — {a.account_name} ({a.account_type})
                      </option>
                    ))}
                  </select>
                </div>
                {formAccountId && (() => {
                  const acct = (accounts || []).find((a: any) => a.id === formAccountId) as any;
                  if (!acct) return null;
                  const normal = getNormalBalance(acct.account_type);
                  return (
                    <p className="text-[10px] text-muted-foreground">
                      Normal balance: <strong>{normal}</strong> • 
                      Positive amount → {normal === "Debit" ? "DR" : "CR"} this account
                    </p>
                  );
                })()}
              </div>

              {/* Amount */}
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Opening Balance</label>
                <input
                  type="number"
                  step="0.01"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-right"
                  placeholder="0.00"
                />
                <p className="text-[10px] text-muted-foreground">Negative values reverse the entry</p>
              </div>

              {/* Date */}
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> As Of Date
                </label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>

              {/* Description */}
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Optional"
                />
              </div>

              {/* Actions */}
              <div className="md:col-span-2 flex gap-2">
                <Button onClick={handleSave} disabled={saveMutation.isPending} className="flex-1">
                  <Save className="w-4 h-4 mr-1" />
                  {saveMutation.isPending ? "Saving…" : editingEntryId ? "Update" : "Save"}
                </Button>
                {editingEntryId && (
                  <Button variant="ghost" size="icon" onClick={resetForm}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Auto-posting preview */}
            {formAccountId && formAmount && parseFloat(formAmount) !== 0 && (
              <div className="mt-4 bg-muted/30 rounded-lg px-4 py-3 text-xs space-y-1">
                <p className="font-medium text-muted-foreground mb-1">Journal Preview:</p>
                {(() => {
                  const acct = (accounts || []).find((a: any) => a.id === formAccountId) as any;
                  if (!acct) return null;
                  const normal = getNormalBalance(acct.account_type);
                  const amt = Math.abs(parseFloat(formAmount));
                  const isPositive = parseFloat(formAmount) >= 0;
                  const accountDR = (normal === "Debit" && isPositive) || (normal === "Credit" && !isPositive);
                  return (
                    <>
                      <div className="flex justify-between">
                        <span>{accountDR ? "DR" : "CR"} {acct.account_code} — {acct.account_name}</span>
                        <span className="font-medium">{formatCurrency(amt)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{accountDR ? "CR" : "DR"} 3900 — Opening Balance Equity</span>
                        <span>{formatCurrency(amt)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {(!obDate || obDate !== formDate) && (
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={handleSaveDate} disabled={saveSettingMutation.isPending}>
                  Set as Global Opening Balance Date
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing Opening Balances Table */}
      <OBTable
        entries={postedEntries}
        accounts={accounts}
        isEditable={isEditable}
        onEdit={handleEdit}
        onDelete={(id) => deleteMutation.mutate(id)}
        onVoid={(id) => voidMutation.mutate(id)}
        editingId={editingEntryId}
      />

      {/* Summary Panel */}
      <OBSummary totalDebits={totalDebits} totalCredits={totalCredits} obeBalance={obeBalance} />

      <CreateLedgerModal
        open={showCreateLedger}
        onOpenChange={setShowCreateLedger}
        onCreated={handleLedgerCreated}
      />
    </div>
  );
}

// --- Sub-components ---

function OBTable({
  entries,
  accounts,
  isEditable,
  onEdit,
  onDelete,
  onVoid,
  editingId,
}: {
  entries: any[];
  accounts: any;
  isEditable: boolean;
  onEdit?: (entry: any) => void;
  onDelete?: (id: string) => void;
  onVoid?: (id: string) => void;
  editingId?: string | null;
}) {
  if (!entries || entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">No opening balances entered yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Account</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Opening Balance</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Posting</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Date</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                {isEditable && <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: any) => {
                const acct = (accounts || []).find((a: any) => a.id === entry.account_id) as any;
                const normal = acct ? getNormalBalance(acct.account_type) : "Debit";
                const amt = Math.abs(Number(entry.amount_signed));
                const isPositive = Number(entry.amount_signed) >= 0;
                const accountDR = (normal === "Debit" && isPositive) || (normal === "Credit" && !isPositive);
                const isBeingEdited = editingId === entry.id;

                return (
                  <tr key={entry.id} className={`border-b hover:bg-muted/10 transition-colors ${isBeingEdited ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-2.5">
                      <span className="text-foreground font-medium">
                        {acct ? `${acct.account_code} — ${acct.account_name}` : "Unknown"}
                      </span>
                      {acct && <span className="text-xs text-muted-foreground ml-2">{acct.account_type}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {Number(entry.amount_signed) < 0 && <span className="text-destructive">-</span>}
                      {formatCurrency(amt)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-xs">
                        <span className={accountDR ? "text-info font-medium" : "text-muted-foreground"}>DR</span>
                        {" / "}
                        <span className={!accountDR ? "text-warning font-medium" : "text-muted-foreground"}>CR</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                      {entry.as_of_date || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge variant={entry.status === "posted" ? "default" : entry.status === "voided" ? "destructive" : "secondary"} className="text-[10px]">
                        {entry.status}
                      </Badge>
                    </td>
                    {isEditable && (
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onEdit?.(entry)}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button className="p-1.5 rounded hover:bg-warning/10 text-muted-foreground hover:text-warning transition-colors" title="Void">
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Void Opening Balance?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will create a reversing journal entry and mark this entry as voided. The audit trail is preserved.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onVoid?.(entry.id)}>Void</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Opening Balance?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will reverse the journal entry and permanently remove this opening balance record.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onDelete?.(entry.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function OBSummary({ totalDebits, totalCredits, obeBalance }: { totalDebits: number; totalCredits: number; obeBalance: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-xs text-muted-foreground mb-1">Total Debits</p>
          <p className="text-lg font-bold text-info">{formatCurrency(totalDebits)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-xs text-muted-foreground mb-1">Total Credits</p>
          <p className="text-lg font-bold text-warning">{formatCurrency(totalCredits)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-xs text-muted-foreground mb-1">Opening Balance Equity</p>
          <p className={`text-lg font-bold ${obeBalance?.type === "zero" ? "text-success" : "text-foreground"}`}>
            {obeBalance ? formatCurrency(obeBalance.balance) : formatCurrency(0)}
          </p>
          {obeBalance?.type !== "zero" && obeBalance?.type && (
            <p className="text-[10px] text-muted-foreground capitalize">{obeBalance.type}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
