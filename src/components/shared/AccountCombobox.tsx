import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface AccountOption {
  id: string;
  account_code?: string | null;
  account_name: string;
  account_type?: string | null;
  account_subtype?: string | null;
  is_active?: boolean | null;
}

interface Props {
  /** The accounts this picker is allowed to offer — already scoped by the caller. */
  options: AccountOption[];
  value: string | null | undefined;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Applied to the trigger button, e.g. "h-8" inside a table row. */
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /**
   * Adds a first row that clears the selection — for pickers where "no account"
   * is a meaningful answer ("Default", "Don't post to GL").
   */
  clearLabel?: string;
  /** Adds a footer action, e.g. creating a ledger that isn't in the list yet. */
  onCreateNew?: (query: string) => void;
  createLabel?: string;
}

const label = (a: AccountOption) =>
  a.account_code ? `${a.account_code} — ${a.account_name}` : a.account_name;

/**
 * Type-to-filter picker over a caller-supplied set of ledger accounts.
 *
 * Unlike AccountSelector — which searches the whole chart of accounts on the
 * server — this filters a list already in memory, so screens that may only post
 * to a curated subset (bank accounts, revenue accounts, the postable accounts of
 * one type) keep that restriction while still matching from the first keystroke.
 * Matching is on code, name and type, all terms must hit, order doesn't matter.
 */
export default function AccountCombobox({
  options,
  value,
  onChange,
  placeholder = "Select account…",
  searchPlaceholder = "Search by code, name or type…",
  emptyText = "No accounts found",
  disabled,
  className,
  id,
  clearLabel,
  onCreateNew,
  createLabel = "Create new ledger account",
  ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((a) => a.id === value) ?? null;

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return options;
    return options.filter((a) => {
      const haystack =
        `${a.account_code ?? ""} ${a.account_name} ${a.account_type ?? ""} ${a.account_subtype ?? ""}`.toLowerCase();
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
      else if (onCreateNew) {
        const q = query.trim();
        setOpen(false);
        onCreateNew(q);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={rest["aria-invalid"]}
          aria-describedby={rest["aria-describedby"]}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-9",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{selected ? label(selected) : placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[320px] z-[9999]"
        align="start"
      >
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-10 px-2"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {clearLabel && (
            <button
              type="button"
              onClick={() => pick("")}
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left",
                "hover:bg-accent hover:text-accent-foreground text-muted-foreground",
                !value && "font-medium"
              )}
            >
              {clearLabel}
              {!value && <Check className="h-4 w-4 text-primary shrink-0" />}
            </button>
          )}
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
          ) : (
            results.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pick(a.id)}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                ref={i === highlight ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left",
                  "hover:bg-accent hover:text-accent-foreground",
                  i === highlight && "bg-accent text-accent-foreground",
                  a.id === value && "font-medium",
                  a.is_active === false && "opacity-70"
                )}
              >
                <span className="truncate">
                  {a.account_code && (
                    <span className="font-mono text-xs text-muted-foreground mr-2">{a.account_code}</span>
                  )}
                  {a.account_name}
                  {a.is_active === false && (
                    <span className="ml-2 text-[10px] text-muted-foreground">(inactive)</span>
                  )}
                </span>
                {a.id === value && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            ))
          )}
        </div>
        {onCreateNew && (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => {
                const q = query.trim();
                setOpen(false);
                onCreateNew(q);
              }}
              onMouseDown={(e) => e.preventDefault()}
              className="w-full flex items-center gap-2 px-2 py-2 text-sm text-left rounded-sm text-primary hover:bg-accent"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {query.trim() ? `${createLabel} "${query.trim()}"` : createLabel}
              </span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
