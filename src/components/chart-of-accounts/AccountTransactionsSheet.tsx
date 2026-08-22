import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ExternalLink, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAccountLedgerPage, useAccountLedgerFacets } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";

const PAGE_SIZE = 25;

interface AccountTransactionsSheetProps {
  account: { id: string; account_code: string; account_name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Slide-over "View Transactions" panel — a filterable, paginated list of
 * everything posted to one account, without leaving the Chart of Accounts
 * page. Reuses the same paged register RPC (account_ledger_page) the Ledger
 * page's register runs on, so a 30k-line bank account never comes down in one
 * response.
 */
export default function AccountTransactionsSheet({ account, open, onOpenChange }: AccountTransactionsSheetProps) {
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [txnType, setTxnType] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [page, setPage] = useState(0);

  // Reset filters whenever a different account is opened.
  useEffect(() => {
    if (open) {
      setDateFrom("");
      setDateTo("");
      setTxnType("all");
      setSearchTerm("");
      setDebouncedSearchTerm("");
      setPage(0);
    }
  }, [account?.id, open]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    setPage(0);
  }, [dateFrom, dateTo, txnType, debouncedSearchTerm]);

  const { data: facets } = useAccountLedgerFacets(account?.id, dateFrom || undefined, dateTo || undefined);
  const { data: ledgerPage, isLoading } = useAccountLedgerPage({
    accountId: account?.id,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    search: debouncedSearchTerm,
    txnType,
    sort: "date",
    sortDir: "desc",
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = ledgerPage?.rows ?? [];
  const filteredRows = ledgerPage?.filteredRows ?? 0;
  const totalPages = Math.max(1, Math.ceil(filteredRows / PAGE_SIZE));

  const openEntry = (entryId: string) => {
    onOpenChange(false);
    navigate(`/accounting/journals/${entryId}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {account ? `${account.account_code} · ${account.account_name}` : "Transactions"}
          </SheetTitle>
          <SheetDescription>Posted transactions for this account.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="text-xs border border-input rounded-md px-2 py-1.5 bg-background"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="text-xs border border-input rounded-md px-2 py-1.5 bg-background"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Type</label>
              <select
                value={txnType}
                onChange={(e) => setTxnType(e.target.value)}
                className="text-xs border border-input rounded-md px-2 py-1.5 bg-background"
              >
                <option value="all">All types</option>
                {(facets?.txnTypes ?? []).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <label className="text-[11px] text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Reference or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="text-xs border border-input rounded-md pl-7 pr-2 py-1.5 bg-background w-full"
                />
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">Date</th>
                  <th className="text-left px-2 py-1.5 font-medium">Type</th>
                  <th className="text-left px-2 py-1.5 font-medium">Description</th>
                  <th className="text-left px-2 py-1.5 font-medium">Reference</th>
                  <th className="text-right px-2 py-1.5 font-medium">Debit</th>
                  <th className="text-right px-2 py-1.5 font-medium">Credit</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No transactions found.</td></tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.line_id}
                      className="border-t border-border hover:bg-muted/20 cursor-pointer"
                      onClick={() => openEntry(row.entry_id)}
                    >
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(row.entry_date)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{row.txn_type}</td>
                      <td className="px-2 py-1.5 max-w-[220px] truncate" title={row.description ?? undefined}>
                        {row.description || "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{row.reference || "—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.debit ? formatCurrency(row.debit) : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{row.credit ? formatCurrency(row.credit) : "—"}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        <ExternalLink className="w-3 h-3" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{filteredRows} transaction{filteredRows !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span>Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
