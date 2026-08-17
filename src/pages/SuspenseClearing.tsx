import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HelpCircle, CheckCircle2, Clock, Wand2, Loader2,
  Search, ArrowUp, ArrowDown, ArrowUpDown, X, Download, Check, ChevronsUpDown, Landmark,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
  useSuspenseClearedStats,
  useImportedBankAccounts,
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

/** Sentinel bank ids: the combined view, and lines whose batch lost its bank. */
const ALL_BANKS = "__all__";
const UNASSIGNED = "__unassigned__";

type SortKey = "bank" | "date" | "description" | "reason" | "amount" | "age";

interface BankGroup {
  id: string;
  name: string;
  code: string;
  openCount: number;
  openValue: number;
  oldest: number;
  clearedCount: number;
  clearedValue: number;
}

interface AccountOption {
  id: string;
  account_code: string;
  account_name: string;
  account_type?: string | null;
}

/**
 * Type-to-filter picker for the reclass target account. Filters the postable
 * accounts already in memory, so it matches on code, name or type from the
 * first keystroke — no round trip and no minimum query length.
 */
function AccountCombobox({
  options, value, onChange, placeholder = "Choose the final ledger account…",
}: {
  options: AccountOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((a) => a.id === value) ?? null;

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return options;
    return options.filter((a) => {
      const haystack = `${a.account_code} ${a.account_name} ${a.account_type ?? ""}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [options, query]);

  // Opening resets the query so the full list is offered again; the highlight
  // follows the filter so Enter always picks the row the user is looking at.
  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);
  useEffect(() => setHighlight(0), [query]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[highlight];
      if (hit) pick(hit.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal h-9", !selected && "text-muted-foreground")}
        >
          <span className="truncate">
            {selected ? `${selected.account_code} — ${selected.account_name}` : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search by code, name or type…"
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-10 px-2"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No accounts found</div>
          ) : (
            results.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pick(a.id)}
                onMouseEnter={() => setHighlight(i)}
                ref={i === highlight ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left",
                  "hover:bg-accent hover:text-accent-foreground",
                  i === highlight && "bg-accent text-accent-foreground",
                  a.id === value && "font-medium"
                )}
              >
                <span className="truncate">
                  <span className="font-mono text-xs text-muted-foreground mr-2">{a.account_code}</span>
                  {a.account_name}
                </span>
                {a.id === value && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One bank's clearing scoreboard, and the control that scopes the table to it.
 * Cleared counts are lifetime figures for the bank, so the ratio reads as
 * "how much of everything that ever landed in Suspense has been dealt with".
 */
function BankCard({
  active, onClick, name, code, openCount, openValue, clearedCount, clearedValue, oldest,
}: {
  active: boolean;
  onClick: () => void;
  name: string;
  code: string;
  openCount: number;
  openValue: number;
  clearedCount: number;
  clearedValue: number;
  oldest: number;
}) {
  const total = openCount + clearedCount;
  const pct = total === 0 ? 0 : Math.round((clearedCount / total) * 100);
  const done = openCount === 0;
  // A bank that has never produced a suspense item is a different state from
  // one that was worked down to zero — do not congratulate it for clearing 0.
  const untouched = total === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-left rounded-lg border p-3 transition-colors hover:border-primary/60 hover:bg-accent/40",
        active ? "border-primary bg-accent/60 ring-1 ring-primary/30" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{name}</p>
          {code && <p className="text-xs text-muted-foreground font-mono truncate">{code}</p>}
        </div>
        <Badge variant={done ? "outline" : "secondary"} className="shrink-0 text-xs">
          {untouched ? (
            <span className="text-muted-foreground">no suspense</span>
          ) : done ? (
            <span className="flex items-center gap-1 text-primary"><CheckCircle2 className="w-3 h-3" /> clear</span>
          ) : (
            `${openCount} open`
          )}
        </Badge>
      </div>

      <p className={cn("mt-2 text-lg font-bold tabular-nums", done ? "text-muted-foreground" : "text-amber-600")}>
        {formatCurrency(openValue)}
      </p>

      <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span>{untouched ? "nothing has gone to Suspense" : `${clearedCount} of ${total} cleared (${pct}%)`}</span>
        {openCount > 0 && (
          <span className={oldest > 30 ? "text-destructive" : undefined}>oldest {oldest}d</span>
        )}
      </div>
      {clearedValue > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(clearedValue)} reclassified</p>
      )}
    </button>
  );
}

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
  const { data: clearedStats } = useSuspenseClearedStats();
  const { data: importedBanks } = useImportedBankAccounts();
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
  // Clearing is worked one bank at a time; ALL_BANKS keeps the combined view.
  const [bank, setBank] = useState<string>(ALL_BANKS);

  const allOpen = useMemo(() => lines ?? [], [lines]);

  const bankLabel = useMemo(() => {
    const m = new Map<string, { name: string; code: string }>();
    for (const a of (accounts as any[] | undefined) ?? []) {
      m.set(a.id, { name: a.account_name, code: a.account_code });
    }
    return m;
  }, [accounts]);

  const bankNameOf = useCallback(
    (id: string | null | undefined): string => {
      if (!id) return "Unassigned bank";
      return bankLabel.get(id)?.name ?? "Unknown bank";
    },
    [bankLabel]
  );

  // One row per bank: what is still open, how much has already been cleared,
  // and the oldest item still sitting there.
  const bankGroups = useMemo<BankGroup[]>(() => {
    const byBank = new Map<string, BankGroup>();
    const blank = (id: string): BankGroup => ({
      id,
      name: bankNameOf(id === UNASSIGNED ? null : id),
      code: id === UNASSIGNED ? "" : bankLabel.get(id)?.code ?? "",
      openCount: 0,
      openValue: 0,
      oldest: 0,
      clearedCount: 0,
      clearedValue: 0,
    });

    // Seed from every bank ever imported, so a bank that has never produced a
    // suspense item still shows — as a bank with nothing to clear, not as a
    // bank that is missing from the screen.
    for (const id of importedBanks ?? []) byBank.set(id, blank(id));

    for (const l of allOpen) {
      const key = l.bank_account_id ?? UNASSIGNED;
      const g = byBank.get(key) ?? blank(key);
      g.openCount += 1;
      g.openValue += Number(l.debit || 0) + Number(l.credit || 0);
      g.oldest = Math.max(g.oldest, ageDays(l.created_at));
      byBank.set(key, g);
    }

    // A bank whose suspense is fully cleared still deserves a card — it shows
    // the work is done rather than silently disappearing from the screen.
    for (const s of clearedStats ?? []) {
      const key = s.bank_account_id ?? UNASSIGNED;
      const g = byBank.get(key) ?? blank(key);
      g.clearedCount += s.cleared_count;
      g.clearedValue += s.cleared_value;
      byBank.set(key, g);
    }

    return [...byBank.values()].sort(
      (a, b) => b.openCount - a.openCount || b.openValue - a.openValue || a.name.localeCompare(b.name)
    );
  }, [allOpen, clearedStats, importedBanks, bankLabel, bankNameOf]);

  // Everything below the bank picker is scoped to the chosen bank.
  const open = useMemo(
    () => (bank === ALL_BANKS ? allOpen : allOpen.filter((l) => (l.bank_account_id ?? UNASSIGNED) === bank)),
    [allOpen, bank]
  );
  const openValue = open.reduce((s, l) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
  const oldest = open.reduce((max, l) => Math.max(max, ageDays(l.created_at)), 0);
  const scopeCleared = useMemo(() => {
    const rows = bank === ALL_BANKS ? bankGroups : bankGroups.filter((g) => g.id === bank);
    return rows.reduce(
      (acc, g) => ({ count: acc.count + g.clearedCount, value: acc.value + g.clearedValue }),
      { count: 0, value: 0 }
    );
  }, [bankGroups, bank]);

  // Switching bank drops the selection: clearing must never act on rows that
  // are no longer on screen.
  function pickBank(id: string) {
    setBank(id);
    setSelected(new Set());
    setPageIndex(0);
  }

  // Every visible column feeds the search box: bank, date, description, reason,
  // amount and age, so a query like "rent 2026-03" narrows on any of them.
  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return open;
    return open.filter((l) => {
      const amount = lineAmount(l);
      const haystack = [
        bankNameOf(l.bank_account_id),
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
  }, [open, search, bankNameOf]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "bank":
          return bankNameOf(a.bank_account_id).localeCompare(bankNameOf(b.bank_account_id)) * dir;
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
  }, [filtered, sortKey, sortDir, bankNameOf]);

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
  // whole open-suspense list for the selected bank.
  function exportExcel() {
    const today = new Date().toISOString().slice(0, 10);
    const scopeName = bank === ALL_BANKS ? "All banks" : bankNameOf(bank === UNASSIGNED ? null : bank);
    downloadDataExcel<SuspenseLine>(
      {
        title: `Suspense Clearing — Open Items (${scopeName})`,
        subtitle: search
          ? `Filtered by “${search}” — ${sorted.length} of ${open.length} open items`
          : `${open.length} open items awaiting reclassification`,
        dateLine: `As of ${today}`,
        sheetName: "Suspense",
        fileName: `Suspense Clearing ${scopeName} ${today}.xlsx`,
      },
      [
        { header: "Bank", value: (l) => bankNameOf(l.bank_account_id) },
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
        "TOTAL", "", "", "", "", "", "",
        sorted.reduce((s, l) => s + Number(l.debit || 0), 0),
        sorted.reduce((s, l) => s + Number(l.credit || 0), 0),
      ],
    );
  }

  // Lines sharing the selected line's unknown variant (for "apply to all N").
  const selectedLines = allOpen.filter((l) => selected.has(l.id));
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

  const totalOpen = allOpen.length;
  const totalCleared = bankGroups.reduce((s, g) => s + g.clearedCount, 0);
  const totalClearedValue = bankGroups.reduce((s, g) => s + g.clearedValue, 0);
  const scopeName = bank === ALL_BANKS ? "All banks" : bankNameOf(bank === UNASSIGNED ? null : bank);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <HelpCircle className="w-6 h-6 text-amber-500" /> Suspense Clearing
        </h1>
        <p className="text-sm text-muted-foreground">
          Reclassify imported lines parked in <strong>Unrecognized Payments</strong> (money out) and{" "}
          <strong>Unrecognized Deposits</strong> (money in) to their final ledger account. Items are grouped by the
          bank they were imported against, so one account can be cleared to zero at a time. Each clearing generates
          a reclass journal out of the matching holding account; the original entry is never changed.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Open items{bank !== ALL_BANKS && " (this bank)"}</p>
          <p className="text-2xl font-bold text-foreground">{open.length}</p>
          {bank !== ALL_BANKS && (
            <p className="text-xs text-muted-foreground mt-0.5">{totalOpen} across all banks</p>
          )}
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">Open value</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(openValue)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-sm text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Cleared</p>
          <p className="text-2xl font-bold text-primary">{scopeCleared.count}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(scopeCleared.value)} reclassified</p>
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

      {/* Bank picker. Each card is the bank's own scoreboard: what is left,
          what it is worth and how far the clearing has got. */}
      {bankGroups.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="w-4 h-4 text-muted-foreground" /> By bank account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              <BankCard
                active={bank === ALL_BANKS}
                onClick={() => pickBank(ALL_BANKS)}
                name="All banks"
                code={`${bankGroups.length} account${bankGroups.length === 1 ? "" : "s"}`}
                openCount={totalOpen}
                openValue={allOpen.reduce((s, l) => s + Number(l.debit || 0) + Number(l.credit || 0), 0)}
                clearedCount={totalCleared}
                clearedValue={totalClearedValue}
                oldest={allOpen.reduce((max, l) => Math.max(max, ageDays(l.created_at)), 0)}
              />
              {bankGroups.map((g) => (
                <BankCard
                  key={g.id}
                  active={bank === g.id}
                  onClick={() => pickBank(g.id)}
                  name={g.name}
                  code={g.code}
                  openCount={g.openCount}
                  openValue={g.openValue}
                  clearedCount={g.clearedCount}
                  clearedValue={g.clearedValue}
                  oldest={g.oldest}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Open Suspense items</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {scopeName} · {open.length} open
              {scopeCleared.count > 0 && ` · ${scopeCleared.count} already cleared`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {bank !== ALL_BANKS && (
              <Button onClick={() => pickBank(ALL_BANKS)} size="sm" variant="ghost">
                <X className="w-4 h-4 mr-1" /> All banks
              </Button>
            )}
            <Button
              onClick={exportExcel}
              size="sm"
              variant="outline"
              disabled={sorted.length === 0}
              title={search ? `Export the ${sorted.length} matching items` : "Export all open suspense items in view"}
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
              <p className="text-sm">
                {bank === ALL_BANKS
                  ? "Suspense is clear. Nothing to reclassify."
                  : `${scopeName} is fully cleared — nothing left in Suspense for this bank.`}
              </p>
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
                  {bank === ALL_BANKS && <SortHead sortKey="bank" label="Bank" {...sortProps} />}
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
                      {bank === ALL_BANKS && (
                        <TableCell className="text-sm">{bankNameOf(l.bank_account_id)}</TableCell>
                      )}
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
                <div className="flex-1 min-w-0">
                  <AccountCombobox options={postable} value={targetAccount} onChange={setTargetAccount} />
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
          // Only pre-select it when it is a valid reclass target, otherwise the
          // picker would show the placeholder while a hidden id sat in state.
          const postableResult =
            result?.is_postable !== false && !(result as any)?.is_control_account;
          if (result?.id && postableResult) setTargetAccount(result.id);
          setAccountFormOpen(false);
        }}
        onCreateCategory={async (data) => {
          return await createCategory.mutateAsync(data);
        }}
      />
    </div>
  );
}
