import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAccountById, useAccountSearch, AccountSearchResult } from "@/hooks/useAccountSearch";
import { useAuth } from "@/contexts/AuthContext";

const RECENTS_KEY_PREFIX = "account-selector:recent-v2";
const RECENTS_MAX = 5;
const recentsKeyFor = (tenantId: string | null | undefined) =>
  `${RECENTS_KEY_PREFIX}:${tenantId || "anon"}`;

interface Props {
  value: string | null | undefined;
  onChange: (value: string, account: AccountSearchResult | null) => void;
  /** Restrict to certain account_type values */
  types?: string[];
  includeInactive?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** When true, popover trigger is full-width (default) */
  fullWidth?: boolean;
  /** Optional id to bind <Label htmlFor=...> */
  id?: string;
}

function loadRecents(tenantId: string | null | undefined): AccountSearchResult[] {
  try {
    const raw = localStorage.getItem(recentsKeyFor(tenantId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(tenantId: string | null | undefined, acc: AccountSearchResult) {
  try {
    const current = loadRecents(tenantId).filter((a) => a.id !== acc.id);
    const next = [acc, ...current].slice(0, RECENTS_MAX);
    localStorage.setItem(recentsKeyFor(tenantId), JSON.stringify(next));
  } catch {
    // ignore quota / privacy mode errors
  }
}

/** Group results by account_type for the dropdown */
function groupByType(items: AccountSearchResult[]): Array<[string, AccountSearchResult[]]> {
  const map = new Map<string, AccountSearchResult[]>();
  for (const i of items) {
    const key = i.account_type || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(i);
  }
  // Stable order: Asset, Liability, Equity, Income/Revenue, Expense, COGS, Other
  const order = ["Asset", "Liability", "Equity", "Income", "Revenue", "Expense", "Cost of Goods Sold", "Other Income", "Other Expense"];
  return Array.from(map.entries()).sort(
    ([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b))
  );
}

export default function AccountSelector({
  value,
  onChange,
  types,
  includeInactive = false,
  placeholder = "Search account...",
  disabled,
  className,
  fullWidth = true,
  id,
}: Props) {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id || null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Hydrate the selected account label
  const { data: selected } = useAccountById(value || null);

  // Debounce query input by 350ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [], isFetching } = useAccountSearch({
    query: debounced,
    types,
    includeInactive,
    enabled: open && debounced.trim().length >= 2,
  });

  // Recent accounts (filtered by `types` if provided)
  const recents = useMemo(() => {
    const all = loadRecents();
    return types && types.length > 0 ? all.filter((a) => types.includes(a.account_type)) : all;
  }, [types, open]);

  // What to show: search results when typing, recents when idle
  const showRecents = debounced.trim().length < 2;
  const grouped = useMemo(
    () => (showRecents ? [] : groupByType(results)),
    [showRecents, results]
  );
  const flatList: AccountSearchResult[] = showRecents ? recents : results;

  useEffect(() => {
    setHighlight(0);
  }, [debounced, open]);

  // Auto-focus input on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const handleSelect = (acc: AccountSearchResult) => {
    saveRecent(acc);
    onChange(acc.id, acc);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("", null);
    setQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(flatList.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatList[highlight];
      if (item) handleSelect(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const buttonLabel = selected
    ? `${selected.account_code} — ${selected.account_name}`
    : placeholder;

  let runningIndex = -1; // for keyboard highlight across groups

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "justify-between font-normal",
            fullWidth && "w-full",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{buttonLabel}</span>
          <span className="flex items-center gap-1 ml-2 shrink-0">
            {selected && !disabled && (
              <X
                className="h-4 w-4 opacity-60 hover:opacity-100"
                onClick={handleClear}
                aria-label="Clear selection"
              />
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]"
        align="start"
      >
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-10 px-2"
          />
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {showRecents && recents.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Recent
              </div>
              {recents.map((acc, idx) => {
                runningIndex++;
                const isHi = runningIndex === highlight;
                return (
                  <AccountRow
                    key={`recent-${acc.id}`}
                    acc={acc}
                    selected={acc.id === value}
                    highlighted={isHi}
                    onSelect={() => handleSelect(acc)}
                  />
                );
              })}
            </>
          )}

          {showRecents && recents.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search…
            </div>
          )}

          {!showRecents && isFetching && results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Searching…
            </div>
          )}

          {!showRecents && !isFetching && results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No accounts found
            </div>
          )}

          {!showRecents &&
            grouped.map(([type, items]) => (
              <div key={type}>
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40">
                  {type}
                </div>
                {items.map((acc) => {
                  runningIndex++;
                  const isHi = runningIndex === highlight;
                  return (
                    <AccountRow
                      key={acc.id}
                      acc={acc}
                      selected={acc.id === value}
                      highlighted={isHi}
                      onSelect={() => handleSelect(acc)}
                    />
                  );
                })}
              </div>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AccountRow({
  acc,
  selected,
  highlighted,
  onSelect,
}: {
  acc: AccountSearchResult;
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left",
        "hover:bg-accent hover:text-accent-foreground",
        highlighted && "bg-accent text-accent-foreground",
        selected && "font-medium"
      )}
    >
      <span className="truncate">
        <span className="font-mono text-xs text-muted-foreground mr-2">{acc.account_code}</span>
        {acc.account_name}
      </span>
      {selected && <Check className="h-4 w-4 text-primary shrink-0" />}
    </button>
  );
}
