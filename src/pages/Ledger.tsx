import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useAccounts,
  useAccountLedgerPage,
  useAccountLedgerTotals,
  useAccountLedgerFacets,
  useAccountOpeningBalance,
  fetchAccountLedgerAll,
  type AccountLedgerPageRow,
} from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Download, Search, BookOpen, Filter, FileText, Users, Building2,
  ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, X,
  ChevronsLeft, ChevronsRight, AlertCircle, FileSpreadsheet,
} from "lucide-react";
import { downloadDataExcel } from "@/lib/reportExcel";
import { downloadDataPdf } from "@/lib/reportPdf";
import { toast } from "sonner";
import { isDebitNormal as checkDebitNormal, isPeriodBasedAccount, getTypeLabel, ACCOUNT_TYPES, typeColors } from "@/lib/accountTypes";
import { formatCurrency } from "@/lib/currency";
import { resolveLineMemo } from "@/lib/journalValidation";
import GeneralLedgerReport from "@/components/ledger/GeneralLedgerReport";
import BulkChangeLedgerAccountDialog from "@/components/ledger/BulkChangeLedgerAccountDialog";
import { ReportMasthead } from "@/components/reports/ReportMasthead";
import { ARSubledger, APSubledger } from "@/components/ledger/SubsidiaryLedger";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format";

// ─── Types ───────────────────────────────────────────────────────────────────

type TransactionType = "journal_entry" | "payment_voucher" | "expense" | "invoice" | "payroll" | "opening";

interface RegisterRow {
  id: string;
  date: string;
  transactionType: string;
  refNumber: string;
  chequeNo: string;
  entityName: string;
  contraAccount: string;
  memo: string;
  debit: number;
  credit: number;
  balance: number;
  entryId: string;
  isReversal: boolean;
  isOpeningBalance: boolean;
  /** UUID of the source transaction (journal entry, voucher, etc.) */
  transaction_id: string | null;
  /** Type of the source transaction for navigation */
  transaction_type: TransactionType;
}

type SortField = "date" | "amount" | "refNumber";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtAmt = (n: number) => {
  if (n === 0) return "—";
  return formatCurrency(n);
};

const fmtBal = (n: number) => formatCurrency(n);

// Supabase/Postgrest errors are plain objects with a `.message`, not Error
// instances — `String(e)` on one of those renders as the useless "[object Object]".
const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message?: unknown }).message);
  return String(e);
};

// The transaction type is no longer derived here. It comes from the register
// RPC's txn_type (public.ledger_txn_type, ported verbatim from the function
// that used to live at this spot), because the type filter now runs in SQL
// across the whole account — a client-side copy could disagree with what the
// server filtered on, and the register would drop rows for no visible reason.

/** Badge color for transaction types */
const txnTypeBadge: Record<string, string> = {
  "Invoice": "bg-info/10 text-info",
  "Payment": "bg-success/10 text-success",
  "Bill Payment": "bg-warning/10 text-warning",
  "Expense": "bg-destructive/10 text-destructive",
  "Payroll": "bg-primary/10 text-primary",
  "Journal Entry": "bg-muted text-muted-foreground",
  "Adjustment": "bg-accent text-accent-foreground",
  "Reversal": "bg-destructive/15 text-destructive",
  "Opening Balance": "bg-secondary text-secondary-foreground",
  "Transfer": "bg-info/10 text-info",
  "Depreciation": "bg-muted text-muted-foreground",
};

/** Ledger register columns offered in the export customizer (Excel and PDF). */
const EXPORT_COLUMN_DEFS: { key: string; label: string; numeric?: boolean }[] = [
  { key: "date", label: "Date" },
  { key: "type", label: "Type" },
  { key: "ref", label: "Ref No" },
  { key: "chequeNo", label: "Cheque No" },
  { key: "name", label: "Name" },
  { key: "account", label: "Account" },
  { key: "memo", label: "Memo" },
  { key: "debit", label: "Debit", numeric: true },
  { key: "credit", label: "Credit", numeric: true },
  { key: "balance", label: "Balance", numeric: true },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function Ledger() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: accounts, isLoading: accountsLoading } = useAccounts();

  // Drill-through from the Trial Balance: ?tab=general-ledger&account=<uuid>&from=&to=
  const focusAccountId = searchParams.get("account");
  const focusFrom = searchParams.get("from") ?? undefined;
  const focusTo = searchParams.get("to") ?? undefined;
  const focusAccount = focusAccountId ? accounts?.find((a) => a.id === focusAccountId) : undefined;
  const clearFocus = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("account");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Reverse-lookup: journal_entry_id → source transaction
  const { data: voucherLookup } = useQuery({
    queryKey: ["voucher_je_lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_vouchers")
        .select("id, journal_entry_id, voucher_number")
        .not("journal_entry_id", "is", null);
      if (error) throw error;
      const map = new Map<string, { id: string; ref: string }>();
      data?.forEach(v => { if (v.journal_entry_id) map.set(v.journal_entry_id, { id: v.id, ref: v.voucher_number }); });
      return map;
    },
  });

  const { data: payrollLookup } = useQuery({
    queryKey: ["payroll_je_lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("id, journal_entry_id, run_number")
        .not("journal_entry_id", "is", null);
      if (error) throw error;
      const map = new Map<string, { id: string; ref: string }>();
      data?.forEach(r => { if (r.journal_entry_id) map.set(r.journal_entry_id, { id: r.id, ref: r.run_number }); });
      return map;
    },
  });

  // State
  // Seeded once from ?account= on mount (e.g. "Open Ledger" from the Chart of
  // Accounts context menu) — not kept in sync afterwards, so a manual pick
  // from the account dropdown isn't clobbered by an unrelated searchParams
  // change (like the tab switching).
  const [selectedAccountId, setSelectedAccountId] = useState<string>(() => searchParams.get("account") ?? "");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  // Tab lives in the URL so the Trial Balance can link straight to the General
  // Ledger tab, and so a drilled-into ledger is a shareable/bookmarkable link.
  const activeTab = searchParams.get("tab") ?? "register";
  const setActiveTab = useCallback((tab: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [drillDownEntry, setDrillDownEntry] = useState<RegisterRow | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [bulkAccountDialogOpen, setBulkAccountDialogOpen] = useState(false);
  // Export column customizer, shared by the Excel and PDF downloads — which
  // register columns to include and in what order. Lives at page scope (not
  // per-export) so a customization sticks across repeated downloads in the
  // same session.
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"excel" | "pdf">("excel");
  const [columnOrder, setColumnOrder] = useState<string[]>(EXPORT_COLUMN_DEFS.map(c => c.key));
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const toggleColumn = (key: string) => {
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const moveColumn = (index: number, dir: -1 | 1) => {
    setColumnOrder(prev => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const openExportDialog = (format: "excel" | "pdf") => {
    setExportFormat(format);
    setExportDialogOpen(true);
  };

  const activeColumnKeys = useMemo(
    () => columnOrder.filter(k => !hiddenColumns.has(k)),
    [columnOrder, hiddenColumns]
  );

  // Keystrokes shouldn't immediately re-run filter→sort→balance over the
  // account's register.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Fetch fiscal periods (still needed for period filter UI)
  const { data: fiscalPeriods } = useQuery({
    queryKey: ["fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods").select("*").order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Derived
  const selectedAccount = accounts?.find(a => a.id === selectedAccountId) || accounts?.[0];
  const selectedPeriod = fiscalPeriods?.find(p => p.id === periodFilter);
  const isDebitNormal = selectedAccount ? checkDebitNormal(selectedAccount.account_type) : true;
  const effectiveDateFrom = selectedPeriod ? selectedPeriod.period_start : dateFrom;
  const effectiveDateTo = selectedPeriod ? selectedPeriod.period_end : dateTo;

  // One page of the register at a time. Search, the type filter, the sort, the
  // running balance and the row count are all resolved server-side by
  // account_ledger_page — a bank account here can hold 30k+ lines, which is
  // neither a sensible download nor a sensible number of <tr>s.
  const { data: ledgerPage, isLoading: ledgerLoading } = useAccountLedgerPage({
    accountId: selectedAccount?.id,
    dateFrom: effectiveDateFrom || undefined,
    dateTo: effectiveDateTo || undefined,
    search: debouncedSearchTerm,
    txnType: typeFilter,
    sort: sortField === "refNumber" ? "reference" : sortField,
    sortDir,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: windowTotals } = useAccountLedgerTotals(
    selectedAccount?.id, effectiveDateFrom || undefined, effectiveDateTo || undefined
  );
  const { data: facets } = useAccountLedgerFacets(
    selectedAccount?.id, effectiveDateFrom || undefined, effectiveDateTo || undefined
  );
  // The opening balance is what sits BEFORE the register's start date. With no
  // start date the register shows the account's whole history, so nothing
  // precedes it and the opening balance is zero.
  //
  // This used to fall back to today's date when no filter was set, which asked
  // for "everything before today" — i.e. the entire account — while the rows
  // below listed that same entire account. The account's whole balance was
  // counted twice: 1110 Sampath Bank showed opening 190,192,738.18 and closing
  // 380,385,476.36, exactly double its real 190,192,738.18.
  const { data: openingBalanceData, isLoading: openingBalanceLoading } = useAccountOpeningBalance(
    selectedAccount?.id, effectiveDateFrom || undefined
  );

  // Reporting Layer rule:
  //   - Balance Sheet accounts: opening balance = sum of journal lines BEFORE
  //     the date range (cumulative carry-forward).
  //   - P&L accounts (Income/Expense/COGS): opening balance is conceptually 0
  //     because these accounts reset each fiscal year via closing entries.
  //     The ledger posting is unchanged — this is a presentation-only rule.
  const isPeriodBased = selectedAccount ? isPeriodBasedAccount(selectedAccount.account_type) : false;
  const openingBalance = useMemo(() => {
    if (!selectedAccount || isPeriodBased || !openingBalanceData) return 0;
    const { debit, credit } = openingBalanceData;
    return isDebitNormal ? debit - credit : credit - debit;
  }, [selectedAccount, isPeriodBased, openingBalanceData, isDebitNormal]);

  // Group accounts by type for selector
  const accountsByType = useMemo(() => {
    if (!accounts) return [];
    const groups = new Map<string, typeof accounts>();
    accounts.forEach(a => {
      if (!groups.has(a.account_type)) groups.set(a.account_type, []);
      groups.get(a.account_type)!.push(a);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [accounts]);

  /** Resolve source transaction for a journal entry */
  const resolveSourceTransaction = useCallback((entryId: string, txnType: string): { transaction_id: string | null; transaction_type: TransactionType } => {
    // Check if this journal entry was created by a payment voucher
    if (voucherLookup?.has(entryId)) {
      return { transaction_id: voucherLookup.get(entryId)!.id, transaction_type: "payment_voucher" };
    }
    // Check if this journal entry was created by a payroll run
    if (payrollLookup?.has(entryId)) {
      return { transaction_id: payrollLookup.get(entryId)!.id, transaction_type: "payroll" };
    }
    // Default: the journal entry itself is the source
    return { transaction_id: entryId, transaction_type: "journal_entry" };
  }, [voucherLookup, payrollLookup]);

  // Reshape one page of account_ledger_page rows into RegisterRows. Date,
  // status, account, search, type filtering and ordering all happened
  // server-side; the running balance comes from the server's cumulative sums
  // over the whole window in ledger order, so it is a real balance on every
  // page rather than a re-count of whatever this page holds.
  const buildRows = useCallback((lines: AccountLedgerPageRow[]): RegisterRow[] => {
    if (!selectedAccount) return [];

    return lines.map(line => {
      const contraNames = (line.contra_lines || [])
        .map(cl => cl.account_name || "Unknown")
        .filter((v, i, a) => a.indexOf(v) === i);
      const contraAccount = contraNames.length > 0
        ? (contraNames.length <= 2 ? contraNames.join(", ") : `${contraNames[0]} +${contraNames.length - 1} more`)
        : "—";

      // Extract entity name from description patterns
      let entityName = "";
      const desc = line.description || "";
      const namePatterns = [
        /(?:for|from|to|by)\s+(.+?)(?:\s*[-–—]|\s*$)/i,
        /^(?:Invoice|Payment|Expense|Bill)\s*[-–—:]\s*(.+?)(?:\s*[-–—]|\s*$)/i,
      ];
      for (const pat of namePatterns) {
        const match = desc.match(pat);
        if (match) { entityName = match[1].trim(); break; }
      }

      const txnType = line.txn_type || "Journal Entry";
      const { transaction_id, transaction_type } = resolveSourceTransaction(line.entry_id, txnType);

      const cheque = (line.cheque || "").trim();
      // Bank imports store the cheque in reference too; show it only in the
      // dedicated Cheque column, not duplicated in Ref No.
      const refNumber = line.reference && line.reference.trim() !== cheque ? line.reference : "";
      const payee = (line.payee || "").trim();

      return {
        id: line.line_id,
        date: line.entry_date,
        transactionType: txnType,
        refNumber,
        chequeNo: cheque,
        entityName: payee || entityName,
        contraAccount,
        // The line's own narration when it has one, else the entry's — same
        // rule the General Ledger and the Account Report apply.
        memo: resolveLineMemo(line.line_memo, desc),
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        // opening + this row's cumulative movement through the window, in
        // ledger order — independent of the page, the sort and the search.
        balance: openingBalance + (isDebitNormal
          ? Number(line.cum_debit ?? 0) - Number(line.cum_credit ?? 0)
          : Number(line.cum_credit ?? 0) - Number(line.cum_debit ?? 0)),
        entryId: line.entry_id,
        isReversal: !!line.reversal_of,
        isOpeningBalance: false,
        transaction_id,
        transaction_type,
      };
    });
  }, [selectedAccount, resolveSourceTransaction, openingBalance, isDebitNormal]);

  const pagedRows = useMemo(
    () => buildRows(ledgerPage?.rows ?? []),
    [buildRows, ledgerPage]
  );

  // A live sample for the export column customizer — the currently loaded
  // page's own rows, so the preview always shows real ledger data rather than
  // a re-fetch just to populate a dialog.
  const PREVIEW_ROW_LIMIT = 20;
  const exportPreviewRows = useMemo(() => {
    if (!selectedAccount) return [];
    const openingRow: RegisterRow | null = isPeriodBased ? null : {
      id: "__opening__",
      date: effectiveDateFrom || "",
      transactionType: "Opening Balance",
      refNumber: "",
      chequeNo: "",
      entityName: "",
      contraAccount: "",
      memo: "Carried forward from prior period",
      debit: 0,
      credit: 0,
      balance: openingBalance,
      entryId: "",
      isReversal: false,
      isOpeningBalance: true,
      transaction_id: null,
      transaction_type: "journal_entry",
    };
    const rows = openingRow ? [openingRow, ...pagedRows] : pagedRows;
    return rows.slice(0, PREVIEW_ROW_LIMIT);
  }, [selectedAccount, isPeriodBased, effectiveDateFrom, openingBalance, pagedRows]);

  const exportPreviewValue = useCallback((key: string, row: RegisterRow): string => {
    switch (key) {
      case "date": return formatDate(row.date);
      case "type": return row.transactionType;
      case "ref": return row.refNumber || "—";
      case "chequeNo": return row.chequeNo || "—";
      case "name": return row.entityName || "—";
      case "account": return row.contraAccount || "—";
      case "memo": return row.memo || "—";
      case "debit": return row.debit > 0 ? row.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—";
      case "credit": return row.credit > 0 ? row.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—";
      case "balance": return row.balance.toLocaleString(undefined, { minimumFractionDigits: 2 });
      default: return "—";
    }
  }, []);

  // Bulk selection is scoped to the rows on screen — whenever the account,
  // window, filters or sort change (or the page turns), the ids on screen are
  // no longer what's selected, so start clean rather than carry over a
  // selection the user can't see.
  useEffect(() => {
    setSelectedLineIds(new Set());
  }, [selectedAccount?.id, page, effectiveDateFrom, effectiveDateTo, debouncedSearchTerm, typeFilter, sortField, sortDir]);

  const pageRowIds = useMemo(() => pagedRows.map(r => r.id), [pagedRows]);
  const allOnPageSelected = pageRowIds.length > 0 && pageRowIds.every(id => selectedLineIds.has(id));
  const someOnPageSelected = pageRowIds.some(id => selectedLineIds.has(id));

  const toggleLineSelected = (id: string) => {
    setSelectedLineIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedLineIds(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageRowIds.forEach(id => next.delete(id));
      } else {
        pageRowIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  // Re-points selected register lines at a different account. Debit/credit
  // are untouched, so the parent entry stays balanced — this is purely a
  // reclassification, not an amount change. Sub-ledger dimensions (customer,
  // vendor, item, asset, cost center) belonged to the old account's context,
  // so they're dropped, same as a single-line account change in
  // EditTransactionModal.
  const bulkChangeAccountMutation = useMutation({
    mutationFn: async (targetAccountId: string) => {
      const { error } = await supabase
        .from("journal_lines")
        .update({
          account_id: targetAccountId,
          customer_id: null,
          vendor_id: null,
          item_id: null,
          asset_id: null,
          cost_center_id: null,
        })
        .in("id", Array.from(selectedLineIds));
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Moved ${selectedLineIds.size} line${selectedLineIds.size !== 1 ? "s" : ""} to the new account`);
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["trial_balance"] });
      queryClient.invalidateQueries({ queryKey: ["balance_sheet"] });
      setSelectedLineIds(new Set());
      setBulkAccountDialogOpen(false);
    },
    onError: (e: Error) => toast.error(`Move failed: ${errorMessage(e)}`),
  });

  // Transaction types present in the window, from the server — the same
  // ledger_txn_type() the filter is applied with.
  const availableTypes = facets?.txnTypes ?? [];

  // Pagination — matchingRows counts every row the current search/filter
  // matches across all pages, not just the ones in hand.
  const matchingRows = ledgerPage?.filteredRows ?? 0;
  const totalPages = Math.max(1, Math.ceil(matchingRows / PAGE_SIZE));

  // Totals. Debit/Credit follow the active filter (as they always did); the
  // closing balance is opening + the whole window's movements, because a
  // balance filtered down to some of its transactions is not a balance.
  const totalDebit = ledgerPage?.filteredDebit ?? 0;
  const totalCredit = ledgerPage?.filteredCredit ?? 0;
  const closingBalance = openingBalance + (isDebitNormal
    ? (windowTotals?.totalDebit ?? 0) - (windowTotals?.totalCredit ?? 0)
    : (windowTotals?.totalCredit ?? 0) - (windowTotals?.totalDebit ?? 0));
  const isLoading = accountsLoading || ledgerLoading || openingBalanceLoading;

  // Sort toggle
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(0);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // Drill-down handler
  const handleDrillDown = (row: RegisterRow) => {
    setDrillDownEntry(row);
  };

  const navigateToSource = (row: RegisterRow) => {
    if (!row.transaction_id) return;
    switch (row.transaction_type) {
      case "payment_voucher":
        navigate(`/checks/${row.transaction_id}`);
        break;
      case "payroll":
        navigate(`/payroll/runs?highlight=${row.transaction_id}`);
        break;
      case "expense":
        navigate(`/expenses/tracker?highlight=${row.transaction_id}`);
        break;
      case "invoice":
        navigate(`/sales/invoices?highlight=${row.transaction_id}`);
        break;
      case "journal_entry":
      default:
        navigate(`/accounting/journals/${row.transaction_id}`);
        break;
    }
  };

  // The grid holds one page; an export covers every row matching the current
  // filters, so it pulls the full set from the server on demand.
  const fetchExportRows = useCallback(async (): Promise<RegisterRow[]> => {
    const lines = await fetchAccountLedgerAll({
      accountId: selectedAccount?.id,
      dateFrom: effectiveDateFrom || undefined,
      dateTo: effectiveDateTo || undefined,
      search: debouncedSearchTerm,
      txnType: typeFilter,
      sort: sortField === "refNumber" ? "reference" : sortField,
      sortDir,
    });
    return buildRows(lines);
  }, [selectedAccount, effectiveDateFrom, effectiveDateTo, debouncedSearchTerm, typeFilter, sortField, sortDir, buildRows]);

  // Excel/PDF export — built from the full filtered register, not the
  // current page, so the download covers every transaction in the selection.
  // Columns come from the customizer dialog (columnOrder/hiddenColumns), so
  // both formats always reflect the same picked-and-ordered set.
  const handleExportRegister = useCallback(async (format: "excel" | "pdf") => {
    if (!selectedAccount) return;
    type ExportRow = {
      date: string; type: string; ref: string; chequeNo: string; name: string;
      account: string; memo: string;
      debit: number | null; credit: number | null; balance: number;
    };
    setExporting(true);
    try {
      const registerRows = await fetchExportRows();
      const exportRows: ExportRow[] = [
        {
          date: effectiveDateFrom ? formatDate(effectiveDateFrom) : "", type: "Opening Balance", ref: "", chequeNo: "", name: "",
          account: "", memo: "", debit: null, credit: null, balance: openingBalance,
        },
        ...registerRows.map(r => ({
          date: formatDate(r.date),
          type: r.transactionType,
          ref: r.refNumber,
          chequeNo: r.chequeNo,
          name: r.entityName,
          account: r.contraAccount,
          memo: r.memo,
          debit: r.debit > 0 ? r.debit : null,
          credit: r.credit > 0 ? r.credit : null,
          balance: r.balance,
        })),
      ];

      // Header/value/total per column key, so the customizer dialog can pick a
      // subset and reorder them without touching the export shape below.
      const columnConfig: Record<string, {
        header: string; numeric?: boolean; value: (r: ExportRow) => string | number | null; total: number | null;
      }> = {
        date: { header: "Date", value: r => r.date, total: null },
        type: { header: "Type", value: r => r.type, total: null },
        ref: { header: "Ref No", value: r => r.ref, total: null },
        chequeNo: { header: "Cheque No", value: r => r.chequeNo || "", total: null },
        name: { header: "Name", value: r => r.name, total: null },
        account: { header: "Account", value: r => r.account, total: null },
        memo: { header: "Memo", value: r => r.memo, total: null },
        debit: { header: "Debit", numeric: true, value: r => r.debit, total: totalDebit },
        credit: { header: "Credit", numeric: true, value: r => r.credit, total: totalCredit },
        balance: { header: "Balance", numeric: true, value: r => r.balance, total: closingBalance },
      };
      const activeKeys = columnOrder.filter(k => !hiddenColumns.has(k));
      // The TOTALS label lands on whichever text column survived the
      // customizer, rather than a fixed position — a short row silently
      // shifts totals into the wrong column and loses their currency format.
      const firstTextKeyIdx = activeKeys.findIndex(k => !columnConfig[k].numeric);
      const columns = activeKeys.map(k => ({ header: columnConfig[k].header, numeric: columnConfig[k].numeric, value: columnConfig[k].value }));
      const totalRow = activeKeys.map((k, i) => columnConfig[k].total ?? (i === firstTextKeyIdx ? "TOTALS" : ""));

      const dateLine = (effectiveDateFrom || dateTo)
        ? `${effectiveDateFrom ? formatDate(effectiveDateFrom) : "Inception"} → ${dateTo ? formatDate(dateTo) : "Today"}`
        : undefined;
      const title = `Account Register — ${selectedAccount.account_code} ${selectedAccount.account_name}`;
      const subtitle = getTypeLabel(selectedAccount.account_type);
      const fileBase = `Register ${selectedAccount.account_code} ${selectedAccount.account_name}`;

      if (format === "excel") {
        downloadDataExcel<ExportRow>(
          { title, subtitle, dateLine, sheetName: `${selectedAccount.account_code} Register`, fileName: `${fileBase}.xlsx` },
          columns,
          exportRows,
          totalRow,
        );
      } else {
        downloadDataPdf<ExportRow>(
          { title, subtitle, dateLine: dateLine ?? "All periods to date", fileName: `${fileBase}.pdf` },
          columns,
          exportRows,
          totalRow,
        );
      }
    } catch (e) {
      toast.error(`Export failed: ${errorMessage(e)}`);
    } finally {
      setExporting(false);
    }
  }, [selectedAccount, fetchExportRows, openingBalance, totalDebit, totalCredit, closingBalance, effectiveDateFrom, dateTo, columnOrder, hiddenColumns]);

  // Reset filters
  const clearFilters = () => {
    setDateFrom(""); setDateTo(""); setSearchTerm(""); setTypeFilter("all"); setPeriodFilter("all"); setPage(0);
  };

  const hasActiveFilters = searchTerm || typeFilter !== "all" || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">General Ledger</h1>
          <p className="page-description">Account registers, general ledger report, and subsidiary ledgers</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="register" className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> Account Register
          </TabsTrigger>
          <TabsTrigger value="general-ledger" className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> General Ledger
          </TabsTrigger>
          <TabsTrigger value="ar" className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> AR Subledger
          </TabsTrigger>
          <TabsTrigger value="ap" className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> AP Subledger
          </TabsTrigger>
        </TabsList>

        {/* ═══ Account Register Tab ═══ */}
        <TabsContent value="register">
          <div className="space-y-4">

            {/* ── Account Selector & Actions ── */}
            <div className="stat-card print:shadow-none">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[280px]">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Account</label>
                  <select
                    value={selectedAccountId || selectedAccount?.id || ""}
                    onChange={(e) => { setSelectedAccountId(e.target.value); setPage(0); }}
                    className="w-full text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                  >
                    {accountsByType.map(([type, accs]) => (
                      <optgroup key={type} label={type}>
                        {accs.map(a => (
                          <option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="min-w-[180px]">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Period</label>
                  <select
                    value={periodFilter}
                    onChange={(e) => { setPeriodFilter(e.target.value); setDateFrom(""); setDateTo(""); setPage(0); }}
                    className="w-full text-sm border border-input rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  >
                    <option value="all">All Periods</option>
                    {fiscalPeriods?.map(p => (
                      <option key={p.id} value={p.id}>{p.name} {p.status === "closed" ? "🔒" : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="print:hidden">
                    <Filter className="w-4 h-4 mr-1" />
                    Filters
                    {hasActiveFilters && <span className="ml-1 w-2 h-2 rounded-full bg-primary" />}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openExportDialog("excel")} disabled={matchingRows === 0 || exporting}>
                    <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openExportDialog("pdf")} disabled={matchingRows === 0 || exporting}>
                    <FileText className="w-4 h-4 mr-1" /> PDF
                  </Button>
                </div>
              </div>

              {/* Advanced Filters */}
              {showFilters && (
                <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-end gap-4 print:hidden">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">From Date</label>
                    <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPeriodFilter("all"); setPage(0); }}
                      className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">To Date</label>
                    <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPeriodFilter("all"); setPage(0); }}
                      className="text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
                  </div>
                  <div className="min-w-[160px]">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Transaction Type</label>
                    <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0); }}
                      className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                      <option value="all">All Types</option>
                      {availableTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Search</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input type="text" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(0); }}
                        placeholder="Search memo, reference, name, cheque, amount..."
                        className="w-full text-sm border border-input rounded-lg pl-9 pr-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground" />
                    </div>
                  </div>
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      <X className="w-3.5 h-3.5 mr-1" /> Clear All
                    </Button>
                  )}
                </div>
              )}

              {/* Account Info Bar */}
              {selectedAccount && (
                <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary font-semibold">
                    <BookOpen className="w-3 h-3" /> {selectedAccount.account_code}
                  </span>
                  <span className="font-medium text-foreground">{selectedAccount.account_name}</span>
                  <span className={`px-2 py-0.5 rounded-full font-medium ${typeColors[selectedAccount.account_type] || "bg-secondary text-secondary-foreground"}`}>
                    {getTypeLabel(selectedAccount.account_type)}
                  </span>
                  {selectedAccount.account_subtype && (
                    <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {selectedAccount.account_subtype}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    Normal: {isDebitNormal ? "Debit" : "Credit"}
                  </span>
                  {effectiveDateFrom && (
                    <span className="text-muted-foreground ml-auto">
                      {effectiveDateFrom} → {effectiveDateTo || "present"}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── Summary Strip ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="stat-card">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  {isPeriodBased ? "Period Start" : "Opening Balance"}
                </p>
                <p className="text-base font-bold text-foreground mt-0.5 font-mono">
                  {isPeriodBased ? "LKR 0.00" : fmtBal(openingBalance)}
                </p>
                {isPeriodBased && (
                  <p className="text-[9px] text-muted-foreground italic">P&L resets each year</p>
                )}
              </div>
              <div className="stat-card">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Total Debits</p>
                <p className="text-base font-bold text-foreground mt-0.5 font-mono">{fmtAmt(totalDebit) === "—" ? "LKR 0.00" : fmtAmt(totalDebit)}</p>
              </div>
              <div className="stat-card">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Total Credits</p>
                <p className="text-base font-bold text-foreground mt-0.5 font-mono">{fmtAmt(totalCredit) === "—" ? "LKR 0.00" : fmtAmt(totalCredit)}</p>
              </div>
              <div className="stat-card">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  {isPeriodBased ? "Period Total" : "Closing Balance"}
                </p>
                <p className={`text-base font-bold mt-0.5 font-mono ${closingBalance < 0 ? "text-destructive" : "text-foreground"}`}>
                  {fmtBal(closingBalance)}
                </p>
                <p className="text-[10px] text-muted-foreground">{matchingRows.toLocaleString()} transaction{matchingRows !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* ── Register Table ── */}
            <div className="stat-card print:shadow-none overflow-x-auto">
              <ReportMasthead
                title="Account Register"
                subtitle={selectedAccount ? `${selectedAccount.account_code} · ${selectedAccount.account_name}` : null}
                dateFrom={effectiveDateFrom || undefined}
                dateTo={effectiveDateTo || undefined}
                periodCaption={
                  !effectiveDateFrom && !effectiveDateTo ? "All periods to date" : undefined
                }
                currency="LKR"
                scope={[
                  selectedAccount && { label: "Account type", value: getTypeLabel(selectedAccount.account_type) },
                  { label: "Normal balance", value: isDebitNormal ? "Debit" : "Credit" },
                  typeFilter !== "all" && { label: "Transaction type", value: typeFilter },
                  searchTerm && { label: "Search", value: `"${searchTerm}"` },
                ]}
                note={
                  isPeriodBased
                    ? "Income and expense accounts are period-based; no balance is carried forward into this window."
                    : null
                }
              />

              {selectedLineIds.size > 0 && (
                <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 print:hidden">
                  <span className="text-sm font-medium text-foreground">
                    {selectedLineIds.size} transaction{selectedLineIds.size !== 1 ? "s" : ""} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedLineIds(new Set())}>
                      Clear
                    </Button>
                    <Button size="sm" onClick={() => setBulkAccountDialogOpen(true)}>
                      Change Account
                    </Button>
                  </div>
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              ) : !accounts?.length ? (
                <div className="text-center py-16">
                  <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No accounts found</p>
                  <p className="text-sm text-muted-foreground mt-1">Create accounts in Chart of Accounts first.</p>
                </div>
              ) : matchingRows === 0 && openingBalance === 0 ? (
                <div className="text-center py-16">
                  <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No transactions found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {searchTerm ? `No results matching "${searchTerm}"` : "Post journal entries to see activity here."}
                  </p>
                </div>
              ) : (
                <>
                  <table className="w-full text-sm report-table report-table--grid">
                    <thead>
                      <tr className="border-b-2 border-border bg-muted/30">
                        <th className="px-3 py-2.5 w-8 print:hidden">
                          <Checkbox
                            checked={allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false}
                            onCheckedChange={toggleSelectAllOnPage}
                            aria-label="Select all transactions on this page"
                          />
                        </th>
                        <th className="text-right px-3 py-2.5 w-12">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">#</span>
                        </th>
                        <th className="text-left px-3 py-2.5 w-24">
                          <button onClick={() => toggleSort("date")} className="flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
                            Date <SortIcon field="date" />
                          </button>
                        </th>
                        <th className="text-left px-3 py-2.5 w-28">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</span>
                        </th>
                        <th className="text-left px-3 py-2.5 w-24">
                          <button onClick={() => toggleSort("refNumber")} className="flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
                            Ref No <SortIcon field="refNumber" />
                          </button>
                        </th>
                        <th className="text-left px-3 py-2.5 w-24">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cheque No</span>
                        </th>
                        <th className="text-left px-3 py-2.5 w-32">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
                        </th>
                        <th className="text-left px-3 py-2.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</span>
                        </th>
                        <th className="text-left px-3 py-2.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Memo</span>
                        </th>
                        <th className="text-right px-3 py-2.5 w-28">
                          <button onClick={() => toggleSort("amount")} className="flex items-center justify-end text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors w-full">
                            Debit <SortIcon field="amount" />
                          </button>
                        </th>
                        <th className="text-right px-3 py-2.5 w-28">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Credit</span>
                        </th>
                        <th className="text-right px-3 py-2.5 w-32">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balance</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Opening Balance Row — only for cumulative (Balance Sheet) accounts */}
                      {!isPeriodBased && (
                        <tr className="bg-muted/20 border-b border-border">
                          <td className="px-3 py-2 print:hidden" />
                          <td className="px-3 py-2 text-right text-muted-foreground/50 text-xs tabular-nums">—</td>
                          <td className="px-3 py-2 text-muted-foreground text-xs tabular-nums">{effectiveDateFrom || "—"}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-secondary text-secondary-foreground">
                              Opening Balance
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-muted-foreground italic" colSpan={2}>Carried forward from prior period</td>
                          <td className="text-right px-3 py-2 font-mono text-muted-foreground">—</td>
                          <td className="text-right px-3 py-2 font-mono text-muted-foreground">—</td>
                          <td className="text-right px-3 py-2 font-mono font-semibold text-foreground">{fmtBal(openingBalance)}</td>
                        </tr>
                      )}
                      {/* Transaction Rows */}
                      {pagedRows.map((row, i) => (
                        <tr
                          key={row.id}
                          onClick={() => handleDrillDown(row)}
                          className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-primary/5 ${row.isReversal ? "bg-destructive/5" : i % 2 === 0 ? "bg-[hsl(var(--success)/16%)]" : "bg-background"}`}
                        >
                          <td className="px-3 py-2 print:hidden" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedLineIds.has(row.id)}
                              onCheckedChange={() => toggleLineSelected(row.id)}
                              aria-label={`Select transaction on ${formatDate(row.date)}`}
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground text-xs tabular-nums">{page * PAGE_SIZE + i + 1}</td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDate(row.date)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${txnTypeBadge[row.transactionType] || txnTypeBadge["Journal Entry"]}`}>
                              {row.transactionType}
                            </span>
                            {row.isReversal && (
                              <span className="ml-1 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-destructive/15 text-destructive">
                                REV
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.refNumber || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs text-foreground">{row.chequeNo || "—"}</td>
                          <td className="px-3 py-2 text-foreground text-xs truncate max-w-[120px]">{row.entityName || "—"}</td>
                          <td className="px-3 py-2 text-foreground text-xs truncate max-w-[160px]" title={row.contraAccount}>{row.contraAccount}</td>
                          <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[200px]" title={row.memo}>{row.memo}</td>
                          <td className="text-right px-3 py-2 font-mono tabular-nums">
                            {row.debit > 0 ? (
                              <span className="text-foreground">{row.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                          <td className="text-right px-3 py-2 font-mono tabular-nums">
                            {row.credit > 0 ? (
                              <span className="text-foreground">{row.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                          <td className={`text-right px-3 py-2 font-mono tabular-nums font-semibold ${row.balance < 0 ? "text-destructive" : "text-foreground"}`}>
                            {fmtBal(row.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/30">
                        <td colSpan={9} className="px-3 py-2.5 font-bold text-foreground text-xs">Period Totals</td>
                        <td className="text-right px-3 py-2.5 font-mono font-bold tabular-nums text-foreground">
                          {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-right px-3 py-2.5 font-mono font-bold tabular-nums text-foreground">
                          {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-right px-3 py-2.5 text-muted-foreground">—</td>
                      </tr>
                      <tr className="border-t border-border/50">
                        <td colSpan={9} className="px-3 py-2.5 font-bold text-foreground text-xs">Closing Balance</td>
                        <td colSpan={2}></td>
                        <td className={`text-right px-3 py-2.5 font-mono font-bold tabular-nums ${closingBalance < 0 ? "text-destructive" : "text-foreground"}`}>
                          {fmtBal(closingBalance)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-4 px-1 print:hidden">
                      <p className="text-xs text-muted-foreground">
                        Showing {page * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE + pagedRows.length, matchingRows)} of {matchingRows.toLocaleString()} transactions
                      </p>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(0)}>
                          <ChevronsLeft className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-xs text-muted-foreground px-2">
                          Page {page + 1} of {totalPages}
                        </span>
                        <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                          <ChevronsRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="general-ledger">
          <GeneralLedgerReport
            focusAccountId={focusAccountId}
            focusAccountLabel={focusAccount ? `${focusAccount.account_code} · ${focusAccount.account_name}` : null}
            onClearFocus={clearFocus}
            initialDateFrom={focusFrom}
            initialDateTo={focusTo}
          />
        </TabsContent>
        <TabsContent value="ar"><ARSubledger /></TabsContent>
        <TabsContent value="ap"><APSubledger /></TabsContent>
      </Tabs>

      {/* ═══ Bulk Change Account Dialog ═══ */}
      <BulkChangeLedgerAccountDialog
        open={bulkAccountDialogOpen}
        onOpenChange={setBulkAccountDialogOpen}
        count={selectedLineIds.size}
        accounts={accounts ?? []}
        currentAccountId={selectedAccount?.id}
        onConfirm={(accountId) => bulkChangeAccountMutation.mutate(accountId)}
        isPending={bulkChangeAccountMutation.isPending}
      />

      {/* ═══ Export Column Customizer ═══ */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {exportFormat === "excel" ? <FileSpreadsheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
              Customize {exportFormat === "excel" ? "Excel" : "PDF"} Columns
            </DialogTitle>
            <DialogDescription>
              Choose which register columns to include, and reorder them, before downloading.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
            {/* ── Column checklist ── */}
            <div className="space-y-1 max-h-[65vh] overflow-y-auto md:border-r md:border-border md:pr-3">
              {columnOrder.map((key, i) => {
                const def = EXPORT_COLUMN_DEFS.find(c => c.key === key)!;
                const checked = !hiddenColumns.has(key);
                return (
                  <div key={key} className="flex items-center gap-1.5 px-1.5 py-1.5 rounded-md hover:bg-muted/50">
                    <Checkbox checked={checked} onCheckedChange={() => toggleColumn(key)} aria-label={`Include ${def.label} column`} />
                    <span className={`flex-1 text-sm truncate ${checked ? "text-foreground" : "text-muted-foreground line-through"}`}>{def.label}</span>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" disabled={i === 0} onClick={() => moveColumn(i, -1)} aria-label={`Move ${def.label} up`}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" disabled={i === columnOrder.length - 1} onClick={() => moveColumn(i, 1)} aria-label={`Move ${def.label} down`}>
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>

            {/* ── Live preview: real register rows, in the picked columns/order ── */}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Preview
                {matchingRows > 0 && (
                  <span className="normal-case font-normal text-muted-foreground/80">
                    {" "}— showing {exportPreviewRows.length} of {matchingRows.toLocaleString()} transactions
                  </span>
                )}
              </p>
              <div className="border border-border rounded-lg overflow-auto max-h-[65vh]">
                {activeColumnKeys.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No columns selected</div>
                ) : exportPreviewRows.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">No data to preview</div>
                ) : (
                  <table className="w-full text-xs report-table report-table--grid">
                    <thead className="sticky top-0 bg-muted/60 z-10">
                      <tr>
                        {activeColumnKeys.map(k => {
                          const def = EXPORT_COLUMN_DEFS.find(c => c.key === k)!;
                          return (
                            <th key={k} className={`px-2 py-1.5 whitespace-nowrap font-semibold text-muted-foreground ${def.numeric ? "text-right" : "text-left"}`}>
                              {def.label}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {exportPreviewRows.map((row, i) => (
                        <tr key={row.id} className={row.isOpeningBalance ? "bg-muted/20" : i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                          {activeColumnKeys.map(k => {
                            const def = EXPORT_COLUMN_DEFS.find(c => c.key === k)!;
                            return (
                              <td key={k} className={`px-2 py-1.5 whitespace-nowrap font-mono text-foreground ${def.numeric ? "text-right" : "text-left"}`}>
                                {exportPreviewValue(k, row)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setColumnOrder(EXPORT_COLUMN_DEFS.map(c => c.key)); setHiddenColumns(new Set()); }}
            >
              Reset to Default
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={activeColumnKeys.length === 0 || exporting}
                onClick={async () => { await handleExportRegister(exportFormat); setExportDialogOpen(false); }}
              >
                <Download className="w-4 h-4 mr-1" /> Download {exportFormat === "excel" ? "Excel" : "PDF"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ Drill-Down Dialog ═══ */}
      <Dialog open={!!drillDownEntry} onOpenChange={() => setDrillDownEntry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${txnTypeBadge[drillDownEntry?.transactionType || ""] || txnTypeBadge["Journal Entry"]}`}>
                {drillDownEntry?.transactionType}
              </span>
              Transaction Detail
            </DialogTitle>
            <DialogDescription>Source transaction information</DialogDescription>
          </DialogHeader>
          {drillDownEntry && (
            <div className="space-y-4">
              {/* ── Source Info Banner ── */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <FileText className="w-3.5 h-3.5" />
                  Source Information
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground font-medium">Type:</span>
                  <span className="capitalize text-foreground">{drillDownEntry.transaction_type.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground font-medium">Reference:</span>
                  <span className="font-mono text-foreground">{drillDownEntry.refNumber || "—"}</span>
                  <span className="text-muted-foreground font-medium">Transaction ID:</span>
                  <div className="flex items-center gap-1.5">
                    {drillDownEntry.transaction_id ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="font-mono text-foreground cursor-help">
                            {drillDownEntry.transaction_id.slice(0, 8)}…{drillDownEntry.transaction_id.slice(-4)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="font-mono text-xs">
                          {drillDownEntry.transaction_id}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground italic">Not linked</span>
                    )}
                    {drillDownEntry.transaction_id && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(drillDownEntry.transaction_id!);
                          import("sonner").then(({ toast }) => toast.success("Transaction ID copied"));
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                        title="Copy full ID"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Date</p>
                  <p className="font-medium text-foreground">{formatDate(drillDownEntry.date)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Reference</p>
                  <p className="font-mono text-foreground">{drillDownEntry.refNumber || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Name</p>
                  <p className="text-foreground">{drillDownEntry.entityName || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Contra Account</p>
                  <p className="text-foreground">{drillDownEntry.contraAccount}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Memo / Description</p>
                <p className="text-sm text-foreground bg-muted/30 rounded-lg px-3 py-2">{drillDownEntry.memo}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Debit</p>
                  <p className="font-bold font-mono text-foreground">{drillDownEntry.debit > 0 ? fmtAmt(drillDownEntry.debit) : "—"}</p>
                </div>
                <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Credit</p>
                  <p className="font-bold font-mono text-foreground">{drillDownEntry.credit > 0 ? fmtAmt(drillDownEntry.credit) : "—"}</p>
                </div>
                <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Balance</p>
                  <p className={`font-bold font-mono ${drillDownEntry.balance < 0 ? "text-destructive" : "text-foreground"}`}>{fmtBal(drillDownEntry.balance)}</p>
                </div>
              </div>
              {drillDownEntry.transaction_id ? (
                <Button variant="outline" className="w-full" onClick={() => { navigateToSource(drillDownEntry); setDrillDownEntry(null); }}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Go to Source Transaction
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button variant="outline" className="w-full" disabled>
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Go to Source Transaction
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Source transaction not available</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
