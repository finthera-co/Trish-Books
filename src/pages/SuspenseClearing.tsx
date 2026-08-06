import { useMemo, useState } from "react";
import {
  HelpCircle, CheckCircle2, Clock, Wand2, Loader2,
  Search, ArrowUp, ArrowDown, ArrowUpDown, X, Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox as Check2 } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { downloadDataExcel } from "@/lib/reportExcel";
import { useAccounts, useCreateAccount } from "@/hooks/useData";
import { useAccountCategories, useCreateAccountCategory } from "@/hooks/useAccountCategories";
import AccountForm from "@/components/chart-of-accounts/AccountForm";
import {
  useSuspenseLines,
  useClearSuspense,
  type SuspenseLine,
} from "@/hooks/useBankStatementImport";

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function lineAmount(l: SuspenseLine): number {
  return Number(l.debit || 0) > 0 ? Number(l.debit) : Number(l.credit || 0);
}

function reasonText(l: SuspenseLine): string {
  return (l.suspense_reason ?? "").replace(/_/g, " ");
}

const PAGE_SIZE = 25;

type SortKey = "date" | "description" | "reason" | "amount" | "age";

/** Clickable column header: first click sorts, further clicks flip direction. */
function SortHead({
  sortKey, label, align, activeKey, dir, onSort,
}: {
  sortKey: SortKey;
  label: string;
  align?: "right";
  activeKey: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${active ? "text-foreground font-medium" : ""}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon className={`w-3 h-3 ${active ? "" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

export default function SuspenseClearing() {
  const { data: lines, isLoading } = useSuspenseLines();
  const { data: accounts } = useAccounts();
  const { data: categories } = useAccountCategories();
  const createAccount = useCreateAccount();
  const createCategory = useCreateAccountCategory();
  const [accountFormOpen, setAccountFormOpen] = useState(false);

  const existingCodes = useMemo(
    () => new Set((accounts as any[] | undefined)?.map((a) => a.account_code) || []),
    [accounts]
  );
  const clearMut = useClearSuspense();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetAccount, setTargetAccount] = useState("");
  const [note, setNote] = useState("");
  const [teachVariant, setTeachVariant] = useState(false);

  const postable = useMemo(
    () => (accounts || []).filter((a: any) => a.is_active && a.is_postable && !a.is_control_account),
    [accounts]
  );

  // Search / sort / pagination are all client-side over the already-cached list,
  // so paging never re-queries and never remounts the table.
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pageIndex, setPageIndex] = useState(0);

  const open = lines ?? [];
  const openValue = open.reduce((s, l) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
  const oldest = open.reduce((max, l) => Math.max(max, ageDays(l.created_at)), 0);

  // Every visible column feeds the search box: date, description, reason,
  // amount and age, so a query like "rent 2026-03" narrows on any of them.
  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return open;
    return open.filter((l) => {
      const amount = lineAmount(l);
      const haystack = [
        l.txn_date ?? "",
        l.description ?? "",
        l.name ?? "",
        l.raw_account_type ?? "",
        reasonText(l),
        String(amount),
        formatCurrency(amount),
        `${ageDays(l.created_at)}d`,
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [open, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "date":
          // Undated lines sort last regardless of direction.
          if (!a.txn_date || !b.txn_date) return (a.txn_date ? 0 : 1) - (b.txn_date ? 0 : 1);
          return a.txn_date.localeCompare(b.txn_date) * dir;
        case "description":
          return (a.description || a.name || "").localeCompare(b.description || b.name || "") * dir;
        case "reason":
          return reasonText(a).localeCompare(reasonText(b)) * dir;
        case "amount":
          return (lineAmount(a) - lineAmount(b)) * dir;
        case "age":
          return (ageDays(a.created_at) - ageDays(b.created_at)) * dir;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1); // stays valid when a filter shrinks the list
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "amount" || key === "age" ? "desc" : "asc");
    }
    setPageIndex(0);
  }
  const sortProps = { activeKey: sortKey, dir: sortDir, onSort: toggleSort };

  // Exports every row in the current view — all pages, not just the one on
  // screen — in the active sort order. With the search box empty that is the
  // whole open-suspense list.
  function exportExcel() {
    const today = new Date().toISOString().slice(0, 10);
    downloadDataExcel<SuspenseLine>(
      {
        title: "Suspense Clearing — Open Items",
        subtitle: search
          ? `Filtered by “${search}” — ${sorted.length} of ${open.length} open items`
          : `${open.length} open items awaiting reclassification`,
        dateLine: `As of ${today}`,
        sheetName: "Suspense",
        fileName: `Suspense Clearing ${today}.xlsx`,
      },
      [
        { header: "Date", value: (l) => l.txn_date ?? "" },
        { header: "Description", value: (l) => l.description || l.name || "" },
        { header: "Name", value: (l) => l.name ?? "" },
        { header: "Raw Account Type", value: (l) => l.raw_account_type ?? "" },
        { header: "Category", value: (l) => l.canonical_category ?? "" },
        { header: "Reason", value: (l) => reasonText(l) },
        { header: "Debit", numeric: true, value: (l) => Number(l.debit || 0) || null },
        { header: "Credit", numeric: true, value: (l) => Number(l.credit || 0) || null },
        { header: "Age (days)", value: (l) => ageDays(l.created_at) },
        { header: "Source Sheet", value: (l) => l.sheet_name ?? "" },
        { header: "Imported On", value: (l) => l.created_at.slice(0, 10) },
      ],
      sorted,
      [
        "TOTAL", "", "", "", "", "",
        sorted.reduce((s, l) => s + Number(l.debit || 0), 0),
        sorted.reduce((s, l) => s + Number(l.credit || 0), 0),
      ],
    );
  }

  // Lines sharing the selected line's unknown variant (for "apply to all N").
  const selectedLines = open.filter((l) => selected.has(l.id));
  const commonVariant = useMemo(() => {
    if (selectedLines.length === 0) return null;
    const variants = new Set(selectedLines.map((l) => l.raw_account_type.trim().toLowerCase()).filter(Boolean));
    const allUnknown = selectedLines.every((l) => l.suspense_reason === "unknown_category_variant");
    return variants.size === 1 && allUnknown ? [...variants][0] : null;
  }, [selectedLines]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  // Header checkbox acts on the rows currently on screen; selections made on
  // other pages are kept so a multi-page batch can be cleared in one go.
  const pageAllSelected = pageRows.length > 0 && pageRows.every((l) => selected.has(l.id));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      pageRows.forEach((l) => (pageAllSelected ? next.delete(l.id) : next.add(l.id)));
      return next;
    });
  }

  async function submitClear() {
    if (!targetAccount || selected.size === 0) return;
    // Clearing and teaching happen in ONE transaction: the engine binds this
    // raw variant to the account chosen here, so it resolves at Tier 1 next
    // import instead of returning to Suspense.
    await clearMut.mutateAsync({
      line_ids: [...selected],
      target_account_id: targetAccount,
      note: note || undefined,
      teach_variant: teachVariant && commonVariant ? commonVariant : undefined,
    });
    setDialogOpen(false);
    setSelected(new Set());
    setTargetAccount("");
    setNote("");
    setTeachVariant(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <HelpCircle className="w-6 h-6 text-amber-500" /> Suspense Clearing
        </h1>
        <p className="text-sm text-muted-foreground">
          Reclassify imported lines parked in <strong>Unrecognized Payments</strong> (money out) and{" "}
          <strong>Unrecognized Deposits</strong> (money in) to their final ledger account. Each clearing generates
          a reclass journal out of the matching holding account; the original entry is never changed.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Open items</p>
          <p className="text-2xl font-bold text-foreground">{open.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Open value</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(openValue)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="w-4 h-4" /> Oldest</p>
          <p className={`text-2xl font-bold ${oldest > 30 ? "text-destructive" : "text-foreground"}`}>{oldest} days</p>
        </CardContent></Card>
      </div>

      {oldest > 30 && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <Clock className="w-4 h-4" /> Some items are older than 30 days — clear them to keep the bank GL accurate.
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Open Suspense items</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              onClick={exportExcel}
              size="sm"
              variant="outline"
              disabled={sorted.length === 0}
              title={search ? `Export the ${sorted.length} matching items` : "Export all open suspense items"}
            >
              <Download className="w-4 h-4 mr-2" /> Export Excel
            </Button>
            {selected.size > 0 && (
              <Button onClick={() => setDialogOpen(true)} size="sm">
                <Wand2 className="w-4 h-4 mr-2" /> Clear {selected.size} selected
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : open.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-primary" />
              <p className="text-sm">Suspense is clear. Nothing to reclassify.</p>
            </div>
          ) : (
            <>
            <div className="relative mb-4 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPageIndex(0); }}
                placeholder="Search date, description, reason, amount, age…"
                className="pl-9 pr-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setPageIndex(0); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {sorted.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <p className="text-sm">No items match “{search}”.</p>
              </div>
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={pageAllSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <SortHead sortKey="date" label="Date" {...sortProps} />
                  <SortHead sortKey="description" label="Description" {...sortProps} />
                  <SortHead sortKey="reason" label="Reason" {...sortProps} />
                  <SortHead sortKey="amount" label="Amount" align="right" {...sortProps} />
                  <SortHead sortKey="age" label="Age" align="right" {...sortProps} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((l: SuspenseLine) => {
                  const amount = Number(l.debit || 0) > 0 ? Number(l.debit) : Number(l.credit);
                  const dir = Number(l.debit || 0) > 0 ? "Dr" : "Cr";
                  return (
                    <TableRow key={l.id} data-state={selected.has(l.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} /></TableCell>
                      <TableCell className="font-mono text-sm">{l.txn_date ?? "—"}</TableCell>
                      <TableCell>
                        <span className="font-medium">{l.description || l.name || "—"}</span>
                        {l.raw_account_type && <span className="block text-xs text-muted-foreground">{l.raw_account_type}</span>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{(l.suspense_reason ?? "").replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(amount)} <span className="text-muted-foreground">{dir}</span></TableCell>
                      <TableCell className="text-right text-sm">{ageDays(l.created_at)}d</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            )}

            {/* Page switching is pure local state — no refetch, no remount, so
                the table keeps its place on screen. */}
            {sorted.length > 0 && (
              <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border flex-wrap">
                <p className="text-xs text-muted-foreground tabular-nums">
                  Showing {(page * PAGE_SIZE + 1).toLocaleString()}–
                  {(page * PAGE_SIZE + pageRows.length).toLocaleString()} of {sorted.length.toLocaleString()}
                  {search && open.length !== sorted.length && ` (filtered from ${open.length.toLocaleString()})`}
                  {selected.size > 0 && ` · ${selected.size} selected`}
                </p>
                {pageCount > 1 && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPageIndex(0)} disabled={page === 0}>First</Button>
                    <Button variant="outline" size="sm" onClick={() => setPageIndex(page - 1)} disabled={page === 0}>Previous</Button>
                    <span className="text-xs text-muted-foreground tabular-nums px-1">
                      Page {(page + 1).toLocaleString()} of {pageCount.toLocaleString()}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setPageIndex(page + 1)} disabled={page >= pageCount - 1}>Next</Button>
                    <Button variant="outline" size="sm" onClick={() => setPageIndex(pageCount - 1)} disabled={page >= pageCount - 1}>Last</Button>
                  </div>
                )}
              </div>
            )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear {selected.size} item(s) from Suspense</DialogTitle>
            <DialogDescription>
              A reclass journal moves each line from Suspense to the account below, dated on the original
              transaction. The original entry stays untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Final account</Label>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Select value={targetAccount} onValueChange={setTargetAccount}>
                    <SelectTrigger><SelectValue placeholder="Choose the final ledger account…" /></SelectTrigger>
                    <SelectContent>
                      {postable.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* No suitable ledger yet? Open the full Chart-of-Accounts
                    creation dialog. On save we pre-select the new account here. */}
                <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1 h-9"
                  onClick={() => setAccountFormOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> New account
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                No matching account? Use <strong>New account</strong> to create a ledger account — it appears here selected.
              </p>
            </div>
            <div>
              <Label className="text-sm">Note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this account…" rows={2} />
            </div>
            {commonVariant && (
              <label className="flex items-start gap-2 text-sm">
                <Check2 checked={teachVariant} onCheckedChange={(v) => setTeachVariant(!!v)} className="mt-0.5" />
                <span>
                  Teach the engine: save "<strong>{commonVariant}</strong>" as a permanent mapping so this variant
                  resolves automatically next time instead of returning to Suspense.
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitClear} disabled={!targetAccount || clearMut.isPending}>
              {clearMut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Clearing…</> : "Clear & reclassify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The exact Chart-of-Accounts creation dialog. On save we create the
          account and pre-select it in the Final-account dropdown above. */}
      <AccountForm
        open={accountFormOpen}
        onOpenChange={setAccountFormOpen}
        accounts={(accounts as any[]) || []}
        categories={categories || []}
        existingCodes={existingCodes}
        isPending={createAccount.isPending}
        onSubmit={async (data) => {
          const result = await createAccount.mutateAsync(data as any);
          if (result?.id) setTargetAccount(result.id);
          setAccountFormOpen(false);
        }}
        onCreateCategory={async (data) => {
          return await createCategory.mutateAsync(data);
        }}
      />
    </div>
  );
}
