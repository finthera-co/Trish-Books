import { Plus, Search, RotateCcw, Ban, Undo2, Trash2, ChevronDown, ChevronRight, Filter, AlertTriangle, CheckCircle2, XCircle, Info, FileText, Copy } from "lucide-react";
import BudgetWarningBanner from "@/components/budgets/BudgetWarningBanner";
import AccountSelector from "@/components/shared/AccountSelector";
import AccountForm, { type Account as LedgerAccount } from "@/components/chart-of-accounts/AccountForm";
import { Button } from "@/components/ui/button";
import { useState, Fragment, useMemo, useCallback, useEffect, useRef } from "react";
import {
  useJournalEntriesPage, useJournalEntriesCount, useJournalEntryStats,
  useNextJvReference, useAccounts, useCreateAccount, useCustomers, journalCursorOf, type JournalCursor,
} from "@/hooks/useData";
import { useAccountCategories, useCreateAccountCategory } from "@/hooks/useAccountCategories";
import { useVendors } from "@/hooks/useSubledger";
import SubledgerTagPicker from "@/components/journal/SubledgerTagPicker";
import { useSearchParams } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction, EdgeFunctionError } from "@/lib/edgeFunction";
import { useAuth } from "@/contexts/AuthContext";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  validateJournalEntry,
  getManualEntryAccounts,
  isSubledgerAccount,
  requiresSubledgerBreakdown,
  controlEntityFor,
  isControlLineTagged,
  deriveEntryDescription,
  normalizeLineMemo,
  resolveLineMemo,
  isMemoInherited,
  LINE_MEMO_MAX,
  CHEQUE_NUMBER_MAX,
  type AccountInfo,
  type ValidationError,
  type ValidationResult,
  EPSILON,
} from "@/lib/journalValidation";
import { typeColors, getTypeLabel } from "@/lib/accountTypes";

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type StatusFilter = "all" | "posted" | "voided";
type SourceFilter = "all" | "manual" | "invoice" | "payment_received" | "credit_note" | "depreciation" | "opening_balance" | "other";

const PAGE_SIZE = 50;

export default function JournalEntries() {
  const { appUser } = useAuth();
  const { canEdit: canEditJournals, canDelete: canDeleteJournals } = useMyPermissions();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  // Keyset navigation: where we are is a cursor plus a direction, not an offset.
  // pageIndex is display-only (the "Page N of M" label).
  const [nav, setNav] = useState<{ cursor: JournalCursor | null; backward: boolean }>({
    cursor: null, backward: false,
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(highlightId);
  const highlightRef = useRef<HTMLTableRowElement>(null);

  // Void dialog
  const [voidDialogId, setVoidDialogId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // Reverse dialog
  const [reverseDialogId, setReverseDialogId] = useState<string | null>(null);

  // Delete dialog
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);

  // Restore (un-void) dialog
  const [restoreDialogId, setRestoreDialogId] = useState<string | null>(null);

  // Inline "create new ledger" — same AccountForm the Chart of Accounts page uses.
  // Remembers which line asked for it so the new account can be selected there.
  const [newAccountFor, setNewAccountFor] = useState<{ lineIndex: number; name: string } | null>(null);

  // Form. There is no entry-level description field: narration is typed per line
  // and the header description is derived from it on submit.
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [reference, setReference] = useState("");
  // Cheque / payment instrument number. Optional, and shown in the Account
  // Register's "Cheque No" column — the same column a bank import fills in.
  const [chequeNumber, setChequeNumber] = useState("");
  const [lines, setLines] = useState([
    { account_id: "", debit: 0, credit: 0, memo: "", customer_id: null as string | null, vendor_id: null as string | null },
    { account_id: "", debit: 0, credit: 0, memo: "", customer_id: null as string | null, vendor_id: null as string | null },
  ]);

  // Keystrokes shouldn't each fire a query against a 35k-row table.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // A filter change invalidates the cursor — it points into the old result set.
  useEffect(() => {
    setNav({ cursor: null, backward: false });
    setPageIndex(0);
  }, [debouncedSearch, statusFilter, sourceFilter]);

  const { data: rows, isLoading, isFetching } = useJournalEntriesPage({
    cursor: nav.cursor,
    backward: nav.backward,
    pageSize: PAGE_SIZE,
    search: debouncedSearch,
    status: statusFilter,
    source: sourceFilter,
  });
  const { data: total = 0 } = useJournalEntriesCount(debouncedSearch, statusFilter, sourceFilter);
  const { data: stats } = useJournalEntryStats();
  const { data: accounts } = useAccounts();
  const { data: customers } = useCustomers();
  const { data: vendors } = useVendors();
  const { data: accountCategories } = useAccountCategories();
  const createAccount = useCreateAccount();
  const createAccountCategory = useCreateAccountCategory();

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = rows ?? [];

  // Each move re-anchors on a row of the page currently on screen: forward from the
  // last row, backward from the first. No offsets, so cost is independent of depth.
  const goFirst = () => { setNav({ cursor: null, backward: false }); setPageIndex(0); };
  const goLast  = () => { setNav({ cursor: null, backward: true }); setPageIndex(pageCount - 1); };
  const goNext  = () => {
    const c = journalCursorOf(pageRows[pageRows.length - 1]);
    if (!c) return;
    setNav({ cursor: c, backward: false });
    setPageIndex(i => Math.min(pageCount - 1, i + 1));
  };
  const goPrev  = () => {
    const c = journalCursorOf(pageRows[0]);
    if (!c) return;
    setNav({ cursor: c, backward: true });
    setPageIndex(i => Math.max(0, i - 1));
  };

  // Next JV reference (JV-001, JV-002, …), computed server-side over JV refs only
  const { data: nextJvReference } = useNextJvReference();

  // Auto-fill reference when opening the New Entry dialog
  useEffect(() => {
    if (open && !reference && nextJvReference) {
      setReference(nextJvReference);
    }
  }, [open, nextJvReference]);

  // An entry linked from elsewhere (?highlight=…) is usually not on page 1 and may
  // not match the active filters, so fetch it directly and pin it above the page.
  const { data: highlightedEntry } = useQuery({
    queryKey: ["journal_entries", "highlighted", highlightId],
    enabled: !!highlightId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("*, journal_lines(*, accounts(account_name, account_code))")
        .eq("id", highlightId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const entries = useMemo(() => {
    if (!highlightedEntry) return pageRows as any[];
    return [highlightedEntry, ...pageRows.filter((e: any) => e.id !== (highlightedEntry as any).id)] as any[];
  }, [pageRows, highlightedEntry]);

  // Auto-scroll to highlighted entry from source navigation
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }, [highlightId, entries]);

  const clearHighlight = () => {
    setSearchParams((prev) => { prev.delete("highlight"); return prev; }, { replace: true });
  };

  // Closed fiscal periods for date validation
  const { data: closedPeriods } = useQuery({
    queryKey: ["closed_fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("period_start, period_end")
        .eq("status", "closed");
      if (error) throw error;
      return data;
    },
  });

  // Build accounts map for validation
  const accountsMap = useMemo(() => {
    const map = new Map<string, AccountInfo>();
    accounts?.forEach((a) => {
      map.set(a.id, {
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
        account_subtype: a.account_subtype,
        is_active: a.is_active,
      });
    });
    return map;
  }, [accounts]);

  // Codes already taken — drives the duplicate check in the create-ledger form
  const existingAccountCodes = useMemo(
    () => new Set((accounts || []).map((a) => a.account_code)),
    [accounts]
  );

  // Accounts filtered for manual entry (no control accounts)
  const manualEntryAccounts = useMemo(() => {
    if (!accounts) return [];
    const infos: AccountInfo[] = accounts.map((a) => ({
      id: a.id,
      account_code: a.account_code,
      account_name: a.account_name,
      account_type: a.account_type,
      account_subtype: a.account_subtype,
      is_active: a.is_active,
    }));
    return getManualEntryAccounts(infos);
  }, [accounts]);

  // Group accounts by type for the dropdown
  const groupedAccounts = useMemo(() => {
    const groups: Record<string, AccountInfo[]> = {};
    manualEntryAccounts.forEach((a) => {
      if (!groups[a.account_type]) groups[a.account_type] = [];
      groups[a.account_type].push(a);
    });
    return groups;
  }, [manualEntryAccounts]);

  // The entry-level description the header row will carry, taken from the lines.
  const derivedDescription = useMemo(() => deriveEntryDescription(lines), [lines]);

  // Real-time validation
  const validation: ValidationResult = useMemo(() => {
    return validateJournalEntry({
      description: derivedDescription,
      entryDate,
      lines,
      accountsMap,
      closedPeriods: closedPeriods || undefined,
    });
  }, [derivedDescription, entryDate, lines, accountsMap, closedPeriods]);

  // Line-level errors render on the line itself, so they are keyed by index and
  // excluded from the summary panel below rather than reported twice.
  const lineMemoErrors = useMemo(() => {
    const map = new Map<number, string>();
    validation.errors.forEach((e) => {
      const m = /^lines\[(\d+)\]\.memo$/.exec(e.field);
      if (m) map.set(Number(m[1]), e.message);
    });
    return map;
  }, [validation.errors]);

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < EPSILON && totalDebit > 0;

  // Search, status and source filtering all happen server-side now — `entries` is
  // already the filtered page.
  const filtered = entries;

  // Stats (counted server-side, so they cover the whole table — not just this page)
  const totalPosted = stats?.posted ?? 0;
  const totalVoided = stats?.voided ?? 0;

  const addLine = () => setLines([...lines, { account_id: "", debit: 0, credit: 0, memo: "", customer_id: null as string | null, vendor_id: null as string | null }]);
  const removeLine = (index: number) => {
    if (lines.length > 2) setLines(lines.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...lines];
    // Swapping the account can invalidate the tag: a customer tagged on a Trade
    // Debtors line must not survive a switch to Bank, where journal_lines
    // .customer_id would be a lie no report could explain.
    if (field === "account_id") {
      const nextEntity = controlEntityFor(accountsMap.get(value));
      if (nextEntity !== "customer") newLines[index].customer_id = null;
      if (nextEntity !== "vendor") newLines[index].vendor_id = null;
    }
    if (field === "debit" && Number(value) > 0) {
      (newLines[index] as any)["credit"] = 0;
    } else if (field === "credit" && Number(value) > 0) {
      (newLines[index] as any)["debit"] = 0;
    }
    (newLines[index] as any)[field] = value;
    setLines(newLines);
  };

  // Inline notice for a line. Only an inactive account is an actual problem;
  // control accounts post fine, so their notice is informational and disappears
  // once the line carries a sub-ledger tag.
  const getLineNotice = useCallback(
    (line: { account_id: string; customer_id?: string | null; vendor_id?: string | null }):
      { text: string; blocking: boolean } | null => {
      if (!line.account_id) return null;
      const acc = accountsMap.get(line.account_id);
      if (!acc) return null;
      if (!acc.is_active) return { text: "This account is inactive", blocking: true };
      if (isControlLineTagged(line, acc)) return null;
      const subledgerType = requiresSubledgerBreakdown(acc);
      if (subledgerType === "customer") return { text: "AR control account — posts fine; tag a customer to keep the aging tied", blocking: false };
      if (subledgerType === "vendor") return { text: "AP control account — posts fine; tag a vendor to keep the aging tied", blocking: false };
      if (subledgerType === "inventory") return { text: "Inventory control account — posts fine; quantities stay untouched", blocking: false };
      if (subledgerType === "fixed_asset") return { text: "Fixed asset control account — posts fine; the asset register stays untouched", blocking: false };
      return null;
    },
    [accountsMap]
  );

  // Server-side validated create via edge function
  const createEntry = useMutation({
    mutationFn: async () => {
      const activeLines = lines
        .filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => ({
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          memo: normalizeLineMemo(l.memo),
          customer_id: l.customer_id || null,
          vendor_id: l.vendor_id || null,
        }));

      let data: { valid?: boolean; errors?: { message: string }[] } | null = null;
      try {
        data = await invokeEdgeFunction<{
          valid?: boolean;
          errors?: { message: string }[];
        }>("validate-journal-entry", {
          description: derivedDescription,
          entry_date: entryDate,
          reference: reference.trim() || undefined,
          cheque_number: chequeNumber.trim() || undefined,
          lines: activeLines,
        });
      } catch (e) {
        // Validation failures come back as 422 with a structured `errors` array;
        // surface those messages rather than the generic status text.
        const rows = (e as EdgeFunctionError)?.payload as
          | { errors?: { message: string }[] }
          | undefined;
        if (rows?.errors?.length) {
          throw new Error(rows.errors.map((x) => x.message).join("; "));
        }
        throw e;
      }

      if (data && !data.valid && data.errors) {
        const msgs = data.errors.map((e: any) => e.message).join("; ");
        throw new Error(msgs);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success("Journal entry posted successfully");
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => {
    setReference("");
    setChequeNumber("");
    setEntryDate(new Date().toISOString().split("T")[0]);
    setLines([
      { account_id: "", debit: 0, credit: 0, memo: "", customer_id: null as string | null, vendor_id: null as string | null },
      { account_id: "", debit: 0, credit: 0, memo: "", customer_id: null as string | null, vendor_id: null as string | null },
    ]);
  };

  const handleCreate = async () => {
    // Client-side pre-check
    if (!validation.valid) {
      toast.error(validation.errors[0]?.message || "Please fix validation errors");
      return;
    }
    createEntry.mutate();
  };

  // Void mutation
  const voidEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from("journal_entries")
        .update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: appUser?.id,
          void_reason: voidReason,
        })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success("Journal entry voided");
      setVoidDialogId(null);
      setVoidReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Reverse mutation
  const reverseEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const entry = entries?.find(e => e.id === entryId);
      if (!entry) throw new Error("Entry not found");
      const originalLines = (entry.journal_lines as any[]) || [];

      const { data: newEntry, error } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser?.tenant_id,
          description: `Reversal of: ${entry.description}`,
          entry_date: new Date().toISOString().split("T")[0],
          reference: `REV-${entry.reference || entry.id.slice(0, 8)}`,
          created_by: appUser?.id,
          status: "posted",
          reversal_of: entryId,
        })
        .select()
        .single();
      if (error) throw error;

      // Carry each line's own narration onto its mirror. Without this the
      // reversal lands in the ledger with no description on any line, which is
      // exactly the row an auditor asks about.
      const reversedLines = originalLines.map(line => ({
        journal_entry_id: newEntry.id,
        account_id: line.account_id,
        debit: Number(line.credit),
        credit: Number(line.debit),
        memo: line.memo ? `Reversal of: ${line.memo}` : null,
      }));

      const { error: linesErr } = await supabase.from("journal_lines").insert(reversedLines);
      if (linesErr) throw linesErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success("Reversal entry created and posted");
      setReverseDialogId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Restore (un-void) mutation. The void path is spread across triggers that only
  // run one way, so the RPC rebuilds the transactions feed and budget consumption
  // rather than the client just flipping the status column back.
  const restoreEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const { data, error } = await supabase.rpc("unvoid_journal_entry", { p_entry_id: entryId });
      if (error) throw error;
      return data as { reference: string | null };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success("Journal entry restored to posted");
      setRestoreDialogId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Delete mutation — removes the header and, by cascade, both sides of the
  // double entry. The RPC owns the guards (source-linked, reversed, closed
  // period, reconciled) so they cannot be bypassed from the client.
  const deleteEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const { data, error } = await supabase.rpc("delete_journal_entry", { p_entry_id: entryId });
      if (error) throw error;
      return data as { lines_deleted: number };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success(`Journal entry deleted (${result?.lines_deleted ?? 0} lines removed)`);
      setDeleteDialogId(null);
      setExpandedId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const getAccountName = (accountId: string) => {
    const acc = accounts?.find(a => a.id === accountId);
    return acc ? `${acc.account_code} – ${acc.account_name}` : accountId;
  };

  // Check if form has been touched (for showing validation)
  const formTouched = lines.some(
    l => l.account_id || Number(l.debit) > 0 || Number(l.credit) > 0 || (l.memo ?? "").trim().length > 0
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal Entries</h1>
          <p className="page-description">Record and manage double-entry transactions</p>
        </div>
        {canEditJournals("journals") && <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" /> New Entry</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Journal Entry</DialogTitle>
              <DialogDescription>
                Double-entry validated. Describe each line — control accounts (AR/AP) are excluded, use Invoices or Bills for those.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              {/* Header fields. No entry-level description: each line carries its own. */}
              <div className="grid grid-cols-3 gap-4 max-w-2xl">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                  />
                  {formTouched && validation.errors.find((e) => e.field === "entry_date") && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <XCircle className="w-3 h-3" />
                      {validation.errors.find((e) => e.field === "entry_date")!.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Reference</label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                    placeholder="JV-00001"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Cheque No</label>
                  <input
                    type="text"
                    value={chequeNumber}
                    maxLength={CHEQUE_NUMBER_MAX}
                    onChange={(e) => setChequeNumber(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                    placeholder="e.g. 004512"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Shows in the Account Register</p>
                </div>
              </div>

              {/* Journal Lines */}
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">Journal Lines</label>
                <div className="border border-border rounded-lg overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-[minmax(0,1.2fr)_6.75rem_6.75rem_minmax(0,1fr)_2rem] gap-2 bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                    <span>Account</span>
                    <span className="text-right">Debit (LKR)</span>
                    <span className="text-right">Credit (LKR)</span>
                    <span>Description</span>
                    <span />
                  </div>
                  {/* Lines */}
                  <div className="divide-y divide-border/50">
                    {lines.map((line, i) => {
                      const lineNotice = getLineNotice(line);
                      const acc = line.account_id ? accountsMap.get(line.account_id) : null;
                      const tagEntity = controlEntityFor(acc);
                      const memoError = formTouched ? lineMemoErrors.get(i) : undefined;
                      return (
                        <div key={i} className="px-3 py-2 space-y-1">
                          <div className="grid grid-cols-[minmax(0,1.2fr)_6.75rem_6.75rem_minmax(0,1fr)_2rem] gap-2 items-center">
                            <AccountSelector
                              value={line.account_id}
                              onChange={(v) => updateLine(i, "account_id", v)}
                              placeholder="Search account…"
                              className={lineNotice?.blocking ? "border-warning" : ""}
                              onCreateNew={(q) => setNewAccountFor({ lineIndex: i, name: q })}
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.debit || ""}
                              onChange={(e) => updateLine(i, "debit", Number(e.target.value))}
                              className="text-sm border border-input rounded-md px-2.5 py-1.5 bg-background text-foreground text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                              placeholder="0.00"
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.credit || ""}
                              onChange={(e) => updateLine(i, "credit", Number(e.target.value))}
                              className="text-sm border border-input rounded-md px-2.5 py-1.5 bg-background text-foreground text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                              placeholder="0.00"
                            />
                            <input
                              type="text"
                              value={line.memo}
                              maxLength={LINE_MEMO_MAX}
                              onChange={(e) => updateLine(i, "memo", e.target.value)}
                              className={`text-sm border rounded-md px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors ${
                                memoError ? "border-destructive" : "border-input"
                              }`}
                              placeholder="What this line is for"
                              aria-label={`Line ${i + 1} description`}
                            />
                            <button
                              onClick={() => removeLine(i)}
                              disabled={lines.length <= 2}
                              className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed text-sm px-1 h-8 flex items-center justify-center rounded-md transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                          {/* Inline account type badge + warning */}
                          {acc && (
                            <div className="flex items-center gap-2 pl-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeColors[acc.account_type] || "bg-muted text-muted-foreground"}`}>
                                {getTypeLabel(acc.account_type)}
                              </span>
                              {acc.account_subtype && (
                                <span className="text-[10px] text-muted-foreground">{acc.account_subtype}</span>
                              )}
                            </div>
                          )}
                          {memoError && (
                            <div className="flex items-center gap-1.5 text-xs text-destructive pl-1">
                              <XCircle className="w-3 h-3 shrink-0" />
                              {memoError}
                            </div>
                          )}
                          {tagEntity && (
                            <SubledgerTagPicker
                              entity={tagEntity}
                              value={tagEntity === "customer" ? line.customer_id : line.vendor_id}
                              onChange={(id) =>
                                updateLine(i, tagEntity === "customer" ? "customer_id" : "vendor_id", id)
                              }
                              options={
                                tagEntity === "customer"
                                  ? (customers || []).map((c) => ({ id: c.id, name: c.name }))
                                  : (vendors || []).map((v) => ({ id: v.id, name: v.name }))
                              }
                            />
                          )}
                          {lineNotice && (
                            <div
                              className={`flex items-center gap-1.5 text-xs pl-1 ${
                                lineNotice.blocking ? "text-warning" : "text-muted-foreground"
                              }`}
                            >
                              {lineNotice.blocking ? (
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                              ) : (
                                <Info className="w-3 h-3 shrink-0" />
                              )}
                              {lineNotice.text}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Add line */}
                  <div className="px-3 py-2 border-t border-border">
                    <Button variant="ghost" size="sm" onClick={addLine} className="text-xs">
                      + Add Line
                    </Button>
                  </div>
                </div>
              </div>

              {/* Budget Warnings for expense lines */}
              {lines.filter(l => l.account_id && l.debit > 0).map((line, idx) => {
                const acc = accountsMap.get(line.account_id);
                if (!acc || (acc.account_type !== "Expense" && acc.account_type !== "Cost of Goods Sold")) return null;
                return (
                  <BudgetWarningBanner
                    key={`je-budget-${idx}-${line.account_id}`}
                    accountId={line.account_id}
                    amount={line.debit}
                    transactionDate={entryDate}
                  />
                );
              })}

              {/* Validation Panel */}
              {formTouched && validation.errors.length > 0 && (
                <div className="space-y-2">
                  {validation.errors.filter(e => !["entry_date", "description"].includes(e.field) && !/^lines\[\d+\]\.memo$/.test(e.field)).map((err, i) => (
                    <div key={`err-${i}`} className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded-md px-3 py-2 border border-destructive/20">
                      <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{err.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals bar */}
              <div className="flex items-center justify-between text-sm bg-card rounded-lg px-4 py-3 border border-border">
                <span className="tabular-nums text-foreground">
                  Debit: <strong>LKR {fmt(totalDebit)}</strong>
                </span>
                <span className="tabular-nums text-foreground">
                  Credit: <strong>LKR {fmt(totalCredit)}</strong>
                </span>
                <span className={`font-semibold flex items-center gap-1.5 ${isBalanced ? "text-success" : "text-destructive"}`}>
                  {isBalanced ? (
                    <><CheckCircle2 className="w-4 h-4" /> Balanced</>
                  ) : (
                    <><XCircle className="w-4 h-4" /> Off by LKR {fmt(Math.abs(totalDebit - totalCredit))}</>
                  )}
                </span>
              </div>

              {/* Info banner */}
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Every line carries its own description, which is what the General Ledger and Account Register show
                  against that account; the entry is filed under the first line's description. Entries are validated
                  both client-side and server-side. Control accounts (A/R, A/P, Inventory) are automatically
                  excluded — post to those via Invoices, Bills, or Payments.
                </span>
              </div>

              <Button
                onClick={handleCreate}
                disabled={!validation.valid || createEntry.isPending}
                className="w-full"
              >
                {createEntry.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Validating & Posting…
                  </span>
                ) : (
                  "Post Entry"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>}
      </div>

      {/* Create-ledger dialog — the exact same form the Chart of Accounts page uses.
          Opened from any line's account picker; the new account drops into that line. */}
      {newAccountFor && (
        <AccountForm
          open
          draftScope="je"
          initialName={newAccountFor.name}
          onOpenChange={(v) => { if (!v) setNewAccountFor(null); }}
          accounts={(accounts ?? []) as LedgerAccount[]}
          categories={accountCategories || []}
          isPending={createAccount.isPending}
          existingCodes={existingAccountCodes}
          onSubmit={async (data) => {
            const created = await createAccount.mutateAsync(
              data as Parameters<typeof createAccount.mutateAsync>[0]
            );
            // Fresh account isn't in the picker's search cache yet.
            queryClient.invalidateQueries({ queryKey: ["account-search"] });
            if (created?.id) updateLine(newAccountFor.lineIndex, "account_id", created.id);
            setNewAccountFor(null);
          }}
          onCreateCategory={async (data) => await createAccountCategory.mutateAsync(data)}
          onUseExisting={(acc) => {
            // Duplicate avoided: drop the account that already exists into the line.
            updateLine(newAccountFor.lineIndex, "account_id", acc.id);
            setNewAccountFor(null);
          }}
        />
      )}

      {/* Void Dialog */}
      <Dialog open={!!voidDialogId} onOpenChange={(v) => { if (!v) { setVoidDialogId(null); setVoidReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Journal Entry</DialogTitle>
            <DialogDescription>Voiding marks this entry as invalid. It will no longer affect account balances.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium text-foreground">Reason for voiding <span className="text-destructive">*</span></label>
              <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)}
                className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                placeholder="e.g. Incorrect account used, duplicate entry…" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setVoidDialogId(null); setVoidReason(""); }} className="flex-1">Cancel</Button>
              <Button variant="destructive" onClick={() => voidDialogId && voidEntry.mutate(voidDialogId)}
                disabled={!voidReason.trim() || voidEntry.isPending} className="flex-1">
                {voidEntry.isPending ? "Voiding…" : "Void Entry"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reverse Dialog */}
      <Dialog open={!!reverseDialogId} onOpenChange={(v) => { if (!v) setReverseDialogId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Journal Entry</DialogTitle>
            <DialogDescription>
              This creates a new posted entry with opposite debits and credits. Both entries remain in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {reverseDialogId && (() => {
              const entry = entries?.find(e => e.id === reverseDialogId);
              if (!entry) return null;
              const entryLines = (entry.journal_lines as any[]) || [];
              return (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">{entry.description}</p>
                  <p className="text-xs text-muted-foreground">Date: {entry.entry_date} · Ref: {entry.reference || "—"}</p>
                  <div className="mt-2 space-y-1">
                    {entryLines.map((line: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{line.accounts?.account_code} – {line.accounts?.account_name}</span>
                        <span className="tabular-nums">
                          {Number(line.debit) > 0 ? `Dr ${fmt(Number(line.debit))}` : `Cr ${fmt(Number(line.credit))}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setReverseDialogId(null)} className="flex-1">Cancel</Button>
              <Button onClick={() => reverseDialogId && reverseEntry.mutate(reverseDialogId)}
                disabled={reverseEntry.isPending} className="flex-1">
                {reverseEntry.isPending ? "Reversing…" : "Confirm Reversal"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore Dialog */}
      <Dialog open={!!restoreDialogId} onOpenChange={(v) => { if (!v) setRestoreDialogId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restore Journal Entry</DialogTitle>
            <DialogDescription>
              This puts the entry back to posted, so its debits and credits affect account balances again.
              The void reason will be cleared, and the restore is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {restoreDialogId && (() => {
              const entry = entries?.find(e => e.id === restoreDialogId);
              if (!entry) return null;
              const lines = (entry.journal_lines as any[]) || [];
              const debit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
              return (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{entry.description}</span>
                    <span className="font-mono text-xs text-muted-foreground">{entry.reference || "—"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.entry_date} · LKR {fmt(debit)} across {lines.length} line{lines.length === 1 ? "" : "s"}
                  </p>
                  {entry.void_reason && (
                    <p className="text-xs text-muted-foreground border-t border-border pt-2">
                      <span className="font-medium text-foreground">Voided because:</span> {entry.void_reason}
                    </p>
                  )}
                </div>
              );
            })()}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRestoreDialogId(null)} className="flex-1">Cancel</Button>
              <Button onClick={() => restoreDialogId && restoreEntry.mutate(restoreDialogId)}
                disabled={restoreEntry.isPending} className="flex-1">
                {restoreEntry.isPending ? "Restoring…" : "Restore Entry"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteDialogId} onOpenChange={(v) => { if (!v) setDeleteDialogId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Journal Entry</DialogTitle>
            <DialogDescription>
              {entries?.find(e => e.id === deleteDialogId)?.status === "voided"
                ? "This permanently removes the entry and every debit and credit line on it, including its void record. It cannot be undone — a voided entry left in place keeps the audit trail intact."
                : "This permanently removes the entry and every debit and credit line on it. It cannot be undone — void or reverse the entry instead if you need to keep an audit trail."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {deleteDialogId && (() => {
              const entry = entries?.find(e => e.id === deleteDialogId);
              if (!entry) return null;
              const lines = (entry.journal_lines as any[]) || [];
              return (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{entry.description}</span>
                    <span className="font-mono text-xs text-muted-foreground">{entry.reference || "—"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.entry_date} · {lines.length} line{lines.length === 1 ? "" : "s"} will be removed
                    {entry.status === "voided" && " · currently voided"}
                  </p>
                  <div className="space-y-1">
                    {lines.map((line: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate mr-2">{getAccountName(line.account_id)}</span>
                        <span className="tabular-nums font-mono text-foreground shrink-0">
                          {Number(line.debit) > 0 ? `Dr ${fmt(Number(line.debit))}` : `Cr ${fmt(Number(line.credit))}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDeleteDialogId(null)} className="flex-1">Cancel</Button>
              <Button variant="destructive" onClick={() => deleteDialogId && deleteEntry.mutate(deleteDialogId)}
                disabled={deleteEntry.isPending} className="flex-1">
                {deleteEntry.isPending ? "Deleting…" : "Delete Entry"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Total Entries</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{stats?.total ?? 0}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Posted</p>
          <p className="text-2xl font-bold text-success tabular-nums">{totalPosted}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Voided</p>
          <p className="text-2xl font-bold text-destructive tabular-nums">{totalVoided}</p>
        </div>
      </div>

      {/* Filters + Table */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Search description or reference…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            {(["all", "posted", "voided"] as StatusFilter[]).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-accent"
                }`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Source:</span>
            {(["all", "manual", "invoice", "payment_received", "credit_note", "depreciation", "opening_balance", "other"] as SourceFilter[]).map(s => (
              <button key={s} onClick={() => setSourceFilter(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  sourceFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-accent"
                }`}>
                {s === "all" ? "All" : s === "payment_received" ? "Payment" : s === "credit_note" ? "Credit Note" : s === "opening_balance" ? "OB" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No journal entries found</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8"></th>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th>Source</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const entryTotalDebit = (entry.journal_lines as any[])?.reduce((sum, l) => sum + Number(l.debit), 0) || 0;
                const entryTotalCredit = (entry.journal_lines as any[])?.reduce((sum, l) => sum + Number(l.credit), 0) || 0;
                const isVoided = entry.status === "voided";
                const isReversal = !!(entry as any).reversal_of;
                const isExpanded = expandedId === entry.id;
                const entryLines = (entry.journal_lines as any[]) || [];
                const isHighlighted = highlightId === entry.id;
                const entrySource = (entry as any).source_type || (entry as any).entry_type || "manual";
                const isSystemGenerated = entry.is_system_generated || entrySource !== "manual";
                const sourceLabel = entrySource === "payment_received" ? "Payment" : entrySource === "credit_note" ? "Credit Note" : entrySource === "opening_balance" ? "OB" : entrySource.charAt(0).toUpperCase() + entrySource.slice(1).replace(/_/g, " ");
                const sourceColor = entrySource === "invoice" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                  : entrySource === "payment_received" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : entrySource === "credit_note" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                  : entrySource === "depreciation" ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                  : entrySource === "opening_balance" ? "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400"
                  : "bg-muted text-muted-foreground";

                // Dim the data cells rather than the whole row: opacity on the <tr>
                // would drag the action buttons down with it, and a child can never
                // render more opaque than its parent.
                const dim = isVoided ? "opacity-50" : "";

                return (
                  <Fragment key={entry.id}>
                    <tr
                      ref={isHighlighted ? highlightRef : undefined}
                      className={`cursor-pointer hover:bg-muted/50 ${isHighlighted ? "ring-2 ring-primary ring-inset bg-primary/5" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    >
                      <td className={`px-2 ${dim}`}>
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                      </td>
                      <td className={`text-muted-foreground text-sm ${dim}`}>{entry.entry_date}</td>
                      <td className={`font-medium text-foreground ${dim} ${isVoided ? "line-through" : ""}`}>
                        {entry.description}
                        {isReversal && <span className="ml-1.5 text-xs text-muted-foreground">(reversal)</span>}
                      </td>
                      <td className={`font-mono text-xs text-muted-foreground ${dim}`}>{entry.reference || "—"}</td>
                      <td className={dim}>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sourceColor}`}>
                          {sourceLabel}
                        </span>
                      </td>
                      <td className={`text-right tabular-nums font-medium text-foreground ${dim}`}>LKR {fmt(entryTotalDebit)}</td>
                      <td className={`text-right tabular-nums font-medium text-foreground ${dim}`}>LKR {fmt(entryTotalCredit)}</td>
                      <td>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          isVoided ? "bg-destructive/10 text-destructive" :
                          entry.status === "posted" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                        }`}>{entry.status}</span>
                      </td>
                      <td className="text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end">
                          {entry.status === "posted" && (
                            <>
                              {isSystemGenerated && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50 self-center">Auto</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">System-generated from {sourceLabel}. Edit the source document instead.</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              <Button variant="ghost" size="sm" title="Reverse" onClick={() => setReverseDialogId(entry.id)}>
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" title="Void" onClick={() => setVoidDialogId(entry.id)}>
                                <Ban className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {isVoided && canEditJournals("journals") && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" title="Restore" onClick={() => setRestoreDialogId(entry.id)}>
                                  <Undo2 className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Restore this entry to posted</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {canDeleteJournals("journals") && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Delete"
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10 disabled:pointer-events-none"
                                    disabled={isSystemGenerated}
                                    onClick={() => setDeleteDialogId(entry.id)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  {isSystemGenerated
                                    ? `Generated from ${sourceLabel} — delete the source document instead.`
                                    : "Delete entry and both sides of the double entry"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded line details */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="bg-muted/30 px-6 py-3">
                          {/* Source Info Banner (shown when navigated from register) */}
                          {isHighlighted && (
                            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 mb-4 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                                  <FileText className="w-3.5 h-3.5" />
                                  Source Transaction Details
                                </div>
                                <button onClick={clearHighlight} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                                  Dismiss
                                </button>
                              </div>
                              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                                <span className="text-muted-foreground font-medium">Type:</span>
                                <span className="text-foreground">Journal Entry</span>
                                <span className="text-muted-foreground font-medium">Reference:</span>
                                <span className="font-mono text-foreground">{entry.reference || "—"}</span>
                                <span className="text-muted-foreground font-medium">Transaction ID:</span>
                                <div className="flex items-center gap-1.5">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="font-mono text-foreground cursor-help">
                                        {entry.id.slice(0, 8)}…{entry.id.slice(-4)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="font-mono text-xs">
                                      {entry.id}
                                    </TooltipContent>
                                  </Tooltip>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(entry.id);
                                      import("sonner").then(({ toast }) => toast.success("Transaction ID copied"));
                                    }}
                                    className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                                    title="Copy full ID"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-muted-foreground">
                                <th className="text-left font-medium pb-1.5">Account</th>
                                <th className="text-left font-medium pb-1.5 w-24">Type</th>
                                <th className="text-right font-medium pb-1.5 w-36">Debit</th>
                                <th className="text-right font-medium pb-1.5 w-36">Credit</th>
                                <th className="text-left font-medium pb-1.5">Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entryLines.map((line: any, idx: number) => {
                                const lineAcc = accounts?.find(a => a.id === line.account_id);
                                return (
                                  <tr key={idx} className="border-t border-border/50">
                                    <td className="py-1.5 text-foreground">
                                      <span className="font-mono text-xs text-muted-foreground mr-2">{line.accounts?.account_code}</span>
                                      {line.accounts?.account_name || line.account_id}
                                    </td>
                                    <td className="py-1.5">
                                      {lineAcc && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeColors[lineAcc.account_type] || "bg-muted text-muted-foreground"}`}>
                                          {getTypeLabel(lineAcc.account_type)}
                                        </span>
                                      )}
                                    </td>
                                    <td className="text-right tabular-nums py-1.5">
                                      {Number(line.debit) > 0 ? `LKR ${fmt(Number(line.debit))}` : "—"}
                                    </td>
                                    <td className="text-right tabular-nums py-1.5">
                                      {Number(line.credit) > 0 ? `LKR ${fmt(Number(line.credit))}` : "—"}
                                    </td>
                                    <td className={`py-1.5 pl-3 ${isMemoInherited(line.memo) ? "text-muted-foreground italic" : "text-foreground"}`}>
                                      {resolveLineMemo(line.memo, entry.description) || "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-border font-semibold text-foreground">
                                <td className="pt-1.5" colSpan={2}>Totals</td>
                                <td className="text-right tabular-nums pt-1.5">LKR {fmt(entryTotalDebit)}</td>
                                <td className="text-right tabular-nums pt-1.5">LKR {fmt(entryTotalCredit)}</td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                          {isVoided && entry.void_reason && (
                            <p className="mt-2 text-xs text-destructive">
                              <strong>Void reason:</strong> {entry.void_reason}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {!isLoading && total > 0 && (
          <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border flex-wrap">
            <p className="text-xs text-muted-foreground tabular-nums">
              Showing {(pageIndex * PAGE_SIZE + 1).toLocaleString()}–
              {Math.min(pageIndex * PAGE_SIZE + pageRows.length, total).toLocaleString()} of {total.toLocaleString()}
              {isFetching && <span className="ml-2 text-muted-foreground/70">updating…</span>}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={goFirst} disabled={pageIndex === 0}>First</Button>
              <Button variant="outline" size="sm" onClick={goPrev} disabled={pageIndex === 0}>Previous</Button>
              <span className="text-xs text-muted-foreground tabular-nums px-1">
                Page {(pageIndex + 1).toLocaleString()} of {pageCount.toLocaleString()}
              </span>
              <Button variant="outline" size="sm" onClick={goNext}
                disabled={pageIndex >= pageCount - 1 || pageRows.length < PAGE_SIZE}>
                Next
              </Button>
              <Button variant="outline" size="sm" onClick={goLast} disabled={pageIndex >= pageCount - 1}>Last</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
