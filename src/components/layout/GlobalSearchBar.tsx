import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { MODULE_CONFIGS } from "@/config/modules";
import { useAuth } from "@/contexts/AuthContext";

type NavItem = {
  label: string;
  path: string;
  icon: React.ElementType;
  moduleLabel: string;
  moduleIcon: React.ElementType;
  moduleColor: string;
};

// Build flat list of all nav items from MODULE_CONFIGS
function buildNavItems(isSuperAdmin: boolean): NavItem[] {
  const items: NavItem[] = [];
  for (const mod of Object.values(MODULE_CONFIGS)) {
    const isSuperAdminModule = mod.id === "superadmin";
    if (isSuperAdmin !== isSuperAdminModule) continue;
    for (const item of mod.sidebarItems) {
      items.push({
        label: item.label,
        path: item.path,
        icon: item.icon,
        moduleLabel: mod.label,
        moduleIcon: mod.icon,
        moduleColor: mod.color,
      });
    }
  }
  return items;
}

export default function GlobalSearchBar() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const allItems = buildNavItems(isSuperAdmin);

  const filtered = query.trim()
    ? allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.moduleLabel.toLowerCase().includes(query.toLowerCase()) ||
          item.path.toLowerCase().includes(query.toLowerCase())
      )
    : allItems;

  // Group by module for the dropdown
  const grouped: Record<string, NavItem[]> = {};
  for (const item of filtered) {
    if (!grouped[item.moduleLabel]) grouped[item.moduleLabel] = [];
    grouped[item.moduleLabel].push(item);
  }

  const flatFiltered = filtered; // for keyboard nav

  const handleSelect = useCallback(
    (path: string) => {
      navigate(path);
      setQuery("");
      setOpen(false);
      setActiveIdx(-1);
      inputRef.current?.blur();
    },
    [navigate]
  );

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && flatFiltered[activeIdx]) {
        handleSelect(flatFiltered[activeIdx].path);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
      inputRef.current?.blur();
    }
  };

  const groupEntries = Object.entries(grouped);
  const isEmpty = flatFiltered.length === 0;

  // Track flat index across groups for keyboard highlight
  let globalIdx = 0;

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      {/* Input */}
      <div
        className={`flex items-center gap-2 bg-muted/60 border rounded-lg px-3.5 py-2 w-72 transition-all duration-200 ${
          open
            ? "border-primary/50 shadow-sm bg-card"
            : "border-border focus-within:border-primary/40 focus-within:shadow-sm focus-within:bg-card"
        }`}
      >
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search anything…"
          className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setActiveIdx(-1); inputRef.current?.focus(); }}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground font-mono border border-border/60 rounded px-1 py-0.5 hidden lg:block">
          ⌘K
        </span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {isEmpty ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No results for <span className="font-medium text-foreground">"{query}"</span>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto py-1.5">
              {!query && (
                <p className="px-3.5 pt-1 pb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  All navigation
                </p>
              )}
              {query && (
                <p className="px-3.5 pt-1 pb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {flatFiltered.length} result{flatFiltered.length !== 1 ? "s" : ""}
                </p>
              )}
              {groupEntries.map(([modLabel, items]) => (
                <div key={modLabel}>
                  {/* Module group header */}
                  <div className="flex items-center gap-2 px-3.5 py-1.5">
                    {(() => {
                      const first = items[0];
                      const Icon = first.moduleIcon;
                      return (
                        <>
                          <div className={`w-4 h-4 rounded flex items-center justify-center ${first.moduleColor} shrink-0`}>
                            <Icon className="w-2.5 h-2.5 text-primary-foreground" />
                          </div>
                          <span className="text-[11px] font-semibold text-muted-foreground">{modLabel}</span>
                        </>
                      );
                    })()}
                  </div>

                  {/* Items */}
                  {items.map((item) => {
                    const thisIdx = globalIdx++;
                    const isActive = activeIdx === thisIdx;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.path}
                        className={`w-full flex items-center gap-2.5 px-5 py-2 text-sm text-left transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted/60"
                        }`}
                        onMouseEnter={() => setActiveIdx(thisIdx)}
                        onMouseDown={(e) => {
                          e.preventDefault(); // prevent blur before click
                          handleSelect(item.path);
                        }}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate flex-1">{item.label}</span>
                        {isActive && (
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">↵</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
