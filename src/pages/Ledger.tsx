import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts, useJournalEntries } from "@/hooks/useData";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Download, Printer, Search, BookOpen, Filter, FileText, Users, Building2,
  ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, X,
  ChevronsLeft, ChevronsRight, AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { isDebitNormal as checkDebitNormal, getTypeLabel, ACCOUNT_TYPES, typeColors } from "@/lib/accountTypes";
import { formatCurrency } from "@/lib/currency";
import GeneralLedgerReport from "@/components/ledger/GeneralLedgerReport";
import { ARSubledger, APSubledger } from "@/components/ledger/SubsidiaryLedger";
import { useNavigate } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// ─── Types ───────────────────────────────────────────────────────────────────

type TransactionType = "journal_entry" | "payment_voucher" | "expense" | "invoice" | "payroll" | "opening";

interface RegisterRow {
  id: string;
  date: string;
  transactionType: string;
  refNumber: string;
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

/** Detect transaction type from reference prefix or description keywords */
function detectTransactionType(ref: string, desc: string): string {
  const r = (ref || "").toUpperCase();
  const d = (desc || "").toLowerCase();
  if (r.startsWith("INV") || d.includes("invoice")) return "Invoice";
  if (r.startsWith("PMT") || d.includes("payment received") || d.includes("receipt")) return "Payment";
  if (r.startsWith("PV-") || d.includes("payment voucher") || d.includes("bill payment")) return "Bill Payment";
  if (r.startsWith("EXP") || d.includes("expense")) return "Expense";
  if (r.startsWith("PAY") || d.includes("payroll")) return "Payroll";
  if (r.startsWith("ADJ") || d.includes("adjustment")) return "Adjustment";
  if (r.startsWith("REV") || d.includes("reversal")) return "Reversal";
  if (d.includes("opening balance")) return "Opening Balance";
  if (d.includes("depreciation")) return "Depreciation";
  if (d.includes("bank") || d.includes("transfer")) return "Transfer";
  return "Journal Entry";
}

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

// ─── Component ───────────────────────────────────────────────────────────────

export default function Ledger() {
  const navigate = useNavigate();
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const { data: journalEntries, isLoading: entriesLoading } = useJournalEntries();

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
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState("register");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [drillDownEntry, setDrillDownEntry] = useState<RegisterRow | null>(null);

  // Fetch fiscal periods & opening balances
  const { data: fiscalPeriods } = useQuery({
    queryKey: ["fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_periods").select("*").order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: openingBalances } = useQuery({
    queryKey: ["opening_balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("opening_balances").select("*");
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

  // Opening balance
  const openingBalance = useMemo(() => {
    if (!selectedAccount || !selectedPeriod || !openingBalances) return 0;
    const ob = openingBalances.find(
      (o: any) => o.account_id === selectedAccount.id && o.fiscal_period_id === selectedPeriod.id
    );
    return ob ? Number((ob as any).balance) : 0;
  }, [selectedAccount, selectedPeriod, openingBalances]);

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

  // Build register rows from journal entries
  const allRows = useMemo<RegisterRow[]>(() => {
    if (!journalEntries || !selectedAccount || !accounts) return [];

    return journalEntries
      .filter(entry => {
        if (entry.status === "voided" || (entry as any).voided_at) return false;
        if (entry.status !== "posted") return false;
        if (effectiveDateFrom && entry.entry_date < effectiveDateFrom) return false;
        if (effectiveDateTo && entry.entry_date > effectiveDateTo) return false;
        return true;
      })
      .flatMap(entry => {
        const lines = (entry.journal_lines as any[]) || [];
        const myLines = lines.filter(line => line.account_id === selectedAccount.id);
        if (myLines.length === 0) return [];

        // Find contra accounts (other side)
        const contraLines = lines.filter(line => line.account_id !== selectedAccount.id);
        const contraNames = contraLines
          .map(cl => {
            const acc = accounts.find(a => a.id === cl.account_id);
            return acc ? acc.account_name : "Unknown";
          })
          .filter((v, i, a) => a.indexOf(v) === i);
        const contraAccount = contraNames.length > 0
          ? (contraNames.length <= 2 ? contraNames.join(", ") : `${contraNames[0]} +${contraNames.length - 1} more`)
          : "—";

        // Extract entity name from description patterns
        let entityName = "";
        const desc = entry.description || "";
        const namePatterns = [
          /(?:for|from|to|by)\s+(.+?)(?:\s*[-–—]|\s*$)/i,
          /^(?:Invoice|Payment|Expense|Bill)\s*[-–—:]\s*(.+?)(?:\s*[-–—]|\s*$)/i,
        ];
        for (const pat of namePatterns) {
          const match = desc.match(pat);
          if (match) { entityName = match[1].trim(); break; }
        }

        const txnType = detectTransactionType(entry.reference || "", desc);
        const { transaction_id, transaction_type } = resolveSourceTransaction(entry.id, txnType);

        return myLines.map((line, idx) => ({
          id: `${entry.id}-${idx}`,
          date: entry.entry_date,
          transactionType: txnType,
          refNumber: entry.reference || "",
          entityName,
          contraAccount,
          memo: desc,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          balance: 0,
          entryId: entry.id,
          isReversal: !!(entry as any).reversal_of,
          isOpeningBalance: false,
          transaction_id,
          transaction_type,
        }));
      });
  }, [journalEntries, selectedAccount, accounts, effectiveDateFrom, effectiveDateTo, resolveSourceTransaction]);

  // Collect transaction types for filter dropdown
  const availableTypes = useMemo(() => {
    const set = new Set(allRows.map(r => r.transactionType));
    return Array.from(set).sort();
  }, [allRows]);

  // Apply search + type filter
  const filteredRows = useMemo(() => {
    return allRows.filter(row => {
      if (typeFilter !== "all" && row.transactionType !== typeFilter) return false;
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        return (
          row.memo.toLowerCase().includes(s) ||
          row.refNumber.toLowerCase().includes(s) ||
          row.entityName.toLowerCase().includes(s) ||
          row.contraAccount.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [allRows, typeFilter, searchTerm]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = a.date.localeCompare(b.date);
          if (cmp === 0) cmp = a.refNumber.localeCompare(b.refNumber);
          break;
        case "amount":
          cmp = (a.debit + a.credit) - (b.debit + b.credit);
          break;
        case "refNumber":
          cmp = a.refNumber.localeCompare(b.refNumber);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredRows, sortField, sortDir]);

  // Running balance
  const rowsWithBalance = useMemo(() => {
    let bal = openingBalance;
    return sortedRows.map(row => {
      bal += isDebitNormal ? (row.debit - row.credit) : (row.credit - row.debit);
      return { ...row, balance: bal };
    });
  }, [sortedRows, openingBalance, isDebitNormal]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(rowsWithBalance.length / PAGE_SIZE));
  const pagedRows = rowsWithBalance.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Totals
  const totalDebit = filteredRows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = filteredRows.reduce((s, r) => s + r.credit, 0);
  const closingBalance = rowsWithBalance.length > 0
    ? rowsWithBalance[rowsWithBalance.length - 1].balance
    : openingBalance;
  const isLoading = accountsLoading || entriesLoading;

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
        navigate(`/banking/payment-vouchers?highlight=${row.transaction_id}`);
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
        navigate(`/accounting/journals?highlight=${row.transaction_id}`);
        break;
    }
  };

  // CSV Export
  const handleExportCSV = useCallback(() => {
    if (!selectedAccount) return;
    const header = ["Date", "Type", "Ref No", "Name", "Account", "Memo", "Debit (LKR)", "Credit (LKR)", "Balance (LKR)"];
    const rows = [
      [effectiveDateFrom || "", "Opening Balance", "", "", "", "", "", "", openingBalance.toFixed(2)],
      ...rowsWithBalance.map(r => [
        r.date, r.transactionType, r.refNumber, r.entityName,
        r.contraAccount, r.memo.replace(/"/g, '""'),
        r.debit > 0 ? r.debit.toFixed(2) : "",
        r.credit > 0 ? r.credit.toFixed(2) : "",
        r.balance.toFixed(2),
      ]),
      ["", "TOTALS", "", "", "", "", totalDebit.toFixed(2), totalCredit.toFixed(2), closingBalance.toFixed(2)],
    ];
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `register-${selectedAccount.account_code}-${selectedAccount.account_name.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedAccount, rowsWithBalance, openingBalance, totalDebit, totalCredit, closingBalance, effectiveDateFrom]);

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
                  <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filteredRows.length === 0}>
                    <Download className="w-4 h-4 mr-1" /> Export
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Printer className="w-4 h-4 mr-1" /> Print
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
                        placeholder="Search memo, reference, name..."
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
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Opening Balance</p>
                <p className="text-base font-bold text-foreground mt-0.5 font-mono">{fmtBal(openingBalance)}</p>
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
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Closing Balance</p>
                <p className={`text-base font-bold mt-0.5 font-mono ${closingBalance < 0 ? "text-destructive" : "text-foreground"}`}>
                  {fmtBal(closingBalance)}
                </p>
                <p className="text-[10px] text-muted-foreground">{filteredRows.length} transaction{filteredRows.length !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* ── Register Table ── */}
            <div className="stat-card print:shadow-none overflow-x-auto">
              {/* Print header */}
              <div className="hidden print:block text-center mb-4">
                <h2 className="text-lg font-bold">Account Register</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedAccount?.account_code} · {selectedAccount?.account_name}
                  {effectiveDateFrom && ` | ${effectiveDateFrom} to ${effectiveDateTo || "present"}`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Generated: {format(new Date(), "PPpp")}</p>
              </div>

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
              ) : filteredRows.length === 0 && openingBalance === 0 ? (
                <div className="text-center py-16">
                  <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No transactions found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {searchTerm ? `No results matching "${searchTerm}"` : "Post journal entries to see activity here."}
                  </p>
                </div>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-border bg-muted/30">
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
                      {/* Opening Balance Row */}
                      <tr className="bg-muted/20 border-b border-border">
                        <td className="px-3 py-2 text-muted-foreground text-xs tabular-nums">{effectiveDateFrom || "—"}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-secondary text-secondary-foreground">
                            Opening Balance
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2 text-muted-foreground italic" colSpan={2}>Carried forward from prior period</td>
                        <td className="text-right px-3 py-2 font-mono text-muted-foreground">—</td>
                        <td className="text-right px-3 py-2 font-mono text-muted-foreground">—</td>
                        <td className="text-right px-3 py-2 font-mono font-semibold text-foreground">{fmtBal(openingBalance)}</td>
                      </tr>

                      {/* Transaction Rows */}
                      {pagedRows.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => handleDrillDown(row)}
                          className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-primary/5 ${row.isReversal ? "bg-destructive/5" : ""}`}
                        >
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.date}</td>
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
                        <td colSpan={6} className="px-3 py-2.5 font-bold text-foreground text-xs">Period Totals</td>
                        <td className="text-right px-3 py-2.5 font-mono font-bold tabular-nums text-foreground">
                          {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-right px-3 py-2.5 font-mono font-bold tabular-nums text-foreground">
                          {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="text-right px-3 py-2.5 text-muted-foreground">—</td>
                      </tr>
                      <tr className="border-t border-border/50">
                        <td colSpan={6} className="px-3 py-2.5 font-bold text-foreground text-xs">Closing Balance</td>
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
                        Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rowsWithBalance.length)} of {rowsWithBalance.length} transactions
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

        <TabsContent value="general-ledger"><GeneralLedgerReport /></TabsContent>
        <TabsContent value="ar"><ARSubledger /></TabsContent>
        <TabsContent value="ap"><APSubledger /></TabsContent>
      </Tabs>

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
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Date</p>
                  <p className="font-medium text-foreground">{drillDownEntry.date}</p>
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <span className="font-medium">Source:</span>
                <span className="capitalize">{drillDownEntry.transaction_type.replace(/_/g, " ")}</span>
                {drillDownEntry.transaction_id && (
                  <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{drillDownEntry.transaction_id.slice(0, 8)}…</span>
                )}
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
