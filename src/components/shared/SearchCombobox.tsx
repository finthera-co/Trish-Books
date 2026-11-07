import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchOption {
  id: string;
  label: string;
  /** Secondary text shown muted on the right of the row (code, email, price). */
  hint?: string | null;
  /** Extra text matched by the search but not shown (SKU, phone, …). */
  keywords?: string | null;
}

interface Props {
  options: SearchOption[];
  value: string | null | undefined;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Applied to the trigger button, e.g. "h-10 text-xs" inside a table row. */
  className?: string;
  /** Adds a first row that clears the selection (value ""). */
  clearLabel?: string;
}

/**
 * Type-to-filter picker over an in-memory list — the same interaction as
 * AccountCombobox (arrow keys, Enter to pick, Escape to close), for lists that
 * aren't ledger accounts: customers, products. All search terms must hit the
 * label, hint or keywords; order doesn't matter.
 */
export default function SearchCombobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  className,
  clearLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return options;
    return options.filter((o) => {
      const haystack = `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [options, query]);

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
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-9",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width] min-w-[300px] z-[9999]"
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
            results.map((o, i) => (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                ref={i === highlight ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left",
                  "hover:bg-accent hover:text-accent-foreground",
                  i === highlight && "bg-accent text-accent-foreground",
                  o.id === value && "font-medium"
                )}
              >
                <span className="truncate">{o.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                  {o.id === value && <Check className="h-4 w-4 text-primary" />}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
