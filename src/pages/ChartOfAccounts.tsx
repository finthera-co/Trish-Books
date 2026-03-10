import { Plus, ChevronRight, Search, Download, BookOpen, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { useAccounts, useCreateAccount } from "@/hooks/useData";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/currency";
import { toast } from "sonner";

const typeColors: Record<string, string> = {
  Asset: "bg-info/10 text-info",
  Liability: "bg-warning/10 text-warning",
  Equity: "bg-primary/10 text-primary",
  Revenue: "bg-success/10 text-success",
  COGS: "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
  Expense: "bg-destructive/10 text-destructive",
};

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Revenue", "COGS", "Expense"];

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_account_id: string | null;
  children?: Account[];
}

function buildTree(accounts: Account[]): Account[] {
  const map = new Map<string, Account>();
  const roots: Account[] = [];
  accounts.forEach(a => map.set(a.id, { ...a, children: [] }));
  accounts.forEach(a => {
    const node = map.get(a.id)!;
    if (a.parent_account_id && map.has(a.parent_account_id)) {
      map.get(a.parent_account_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function OpeningBalanceCell({
  accountId,
  currentBalance,
  activePeriodId,
  tenantId,
}: {
  accountId: string;
  currentBalance: number | null;
  activePeriodId: string | null;
  tenantId: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async (amount: number) => {
      if (!activePeriodId || !tenantId) throw new Error("No active fiscal period");
      const { error } = await supabase.from("opening_balances").upsert(
        {
          account_id: accountId,
          fiscal_period_id: activePeriodId,
          tenant_id: tenantId,
          balance: amount,
        },
        { onConflict: "account_id,fiscal_period_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opening_balances"] });
      toast.success("Opening balance saved");
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!activePeriodId) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-28 text-sm border border-input rounded px-2 py-1 bg-background text-foreground text-right focus:outline-none focus:ring-2 focus:ring-ring/20"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") saveMutation.mutate(parseFloat(value) || 0);
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button
          onClick={() => saveMutation.mutate(parseFloat(value) || 0)}
          className="p-0.5 rounded hover:bg-success/10 text-success"
          disabled={saveMutation.isPending}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setEditing(false)} className="p-0.5 rounded hover:bg-destructive/10 text-destructive">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setValue(currentBalance?.toString() || "0");
        setEditing(true);
      }}
      className="text-sm text-right w-full hover:underline cursor-pointer text-foreground/80"
      title="Click to edit"
    >
      {currentBalance ? formatCurrency(currentBalance) : <span className="text-muted-foreground">—</span>}
    </button>
  );
}

function AccountRow({
  account,
  depth = 0,
  balanceMap,
  activePeriodId,
  tenantId,
}: {
  account: Account;
  depth?: number;
  balanceMap: Map<string, number>;
  activePeriodId: string | null;
  tenantId: string | undefined;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = account.children && account.children.length > 0;

  return (
    <>
      <tr className="hover:bg-muted/20 transition-colors">
        <td style={{ paddingLeft: `${depth * 24 + 16}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button onClick={() => setExpanded(!expanded)} className="p-0.5 rounded hover:bg-muted">
                <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            ) : <span className="w-4" />}
            <span className="font-mono text-xs text-muted-foreground">{account.account_code}</span>
            <span className={`font-medium text-sm ${depth === 0 ? "text-foreground" : "text-foreground/80"}`}>{account.account_name}</span>
            {hasChildren && <span className="text-[10px] text-muted-foreground">({account.children!.length})</span>}
          </div>
        </td>
        <td>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[account.account_type] || "bg-muted text-muted-foreground"}`}>
            {account.account_type}
          </span>
        </td>
        <td className="text-xs text-muted-foreground">
          {account.account_type === "Asset" || account.account_type === "Expense" || account.account_type === "COGS" ? "Debit" : "Credit"}
        </td>
        <td className="text-right">
          <OpeningBalanceCell
            accountId={account.id}
            currentBalance={balanceMap.get(account.id) ?? null}
            activePeriodId={activePeriodId}
            tenantId={tenantId}
          />
        </td>
      </tr>
      {expanded && account.children?.sort((a, b) => a.account_code.localeCompare(b.account_code)).map((child) => (
        <AccountRow key={child.id} account={child} depth={depth + 1} balanceMap={balanceMap} activePeriodId={activePeriodId} tenantId={tenantId} />
      ))}
    </>
  );
}

export default function ChartOfAccounts() {
  const { appUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [accountName, setAccountName] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [accountType, setAccountType] = useState("Asset");
  const [parentId, setParentId] = useState("");

  const { data: accounts, isLoading } = useAccounts();
  const createAccount = useCreateAccount();

  // Get all fiscal periods for selection
  const { data: fiscalPeriods } = useQuery({
    queryKey: ["all_fiscal_periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fiscal_periods")
        .select("id, name, status")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  // Auto-select: prefer open period, then first available
  const activePeriod = useMemo(() => {
    if (!fiscalPeriods?.length) return null;
    if (selectedPeriodId) return fiscalPeriods.find(p => p.id === selectedPeriodId) || null;
    const openPeriod = fiscalPeriods.find(p => p.status === "open");
    return openPeriod || fiscalPeriods[0];
  }, [fiscalPeriods, selectedPeriodId]);

  // Get opening balances for the active period
  const { data: openingBalances } = useQuery({
    queryKey: ["opening_balances", activePeriod?.id],
    queryFn: async () => {
      if (!activePeriod?.id) return [];
      const { data, error } = await supabase
        .from("opening_balances")
        .select("account_id, balance")
        .eq("fiscal_period_id", activePeriod.id);
      if (error) throw error;
      return data;
    },
    enabled: !!activePeriod?.id,
  });

  const balanceMap = useMemo(() => {
    const m = new Map<string, number>();
    openingBalances?.forEach((ob) => m.set(ob.account_id, Number(ob.balance)));
    return m;
  }, [openingBalances]);

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts.filter(a => {
      if (filterType !== "all" && a.account_type !== filterType) return false;
      if (search) {
        const s = search.toLowerCase();
        return a.account_code.toLowerCase().includes(s) || a.account_name.toLowerCase().includes(s);
      }
      return true;
    });
  }, [accounts, search, filterType]);

  const tree = buildTree(filteredAccounts);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    accounts?.forEach(a => counts[a.account_type] = (counts[a.account_type] || 0) + 1);
    return counts;
  }, [accounts]);

  const handleCreate = async () => {
    await createAccount.mutateAsync({
      account_name: accountName,
      account_code: accountCode,
      account_type: accountType,
      parent_account_id: parentId || undefined,
    });
    setOpen(false);
    setAccountName("");
    setAccountCode("");
    setAccountType("Asset");
    setParentId("");
  };

  const handleExportCSV = () => {
    if (!accounts) return;
    const rows = [
      ["Code", "Name", "Type", "Normal Balance", "Parent ID"],
      ...accounts.map(a => [a.account_code, a.account_name, a.account_type,
        ["Asset", "Expense", "COGS"].includes(a.account_type) ? "Debit" : "Credit",
        a.parent_account_id || ""]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "chart-of-accounts.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-description">Manage your financial account structure ({accounts?.length || 0} accounts)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!accounts?.length}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4" />Add Account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create New Account</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Account Code</label>
                    <input type="text" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}
                      className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" placeholder="1100" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Account Type</label>
                    <select value={accountType} onChange={(e) => setAccountType(e.target.value)}
                      className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                      {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Account Name</label>
                  <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" placeholder="Cash & Bank" />
                </div>
                <div>
                  <label className="text-sm font-medium">Parent Account (optional)</label>
                  <select value={parentId} onChange={(e) => setParentId(e.target.value)}
                    className="mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                    <option value="">None (top-level)</option>
                    {accounts?.map(a => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
                  </select>
                </div>
                <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs text-muted-foreground">
                  Normal balance: <strong>{["Asset", "Expense", "COGS"].includes(accountType) ? "Debit" : "Credit"}</strong>
                </div>
                <Button onClick={handleCreate} disabled={!accountName || !accountCode || createAccount.isPending} className="w-full">
                  {createAccount.isPending ? "Creating..." : "Create Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Active period indicator */}
      {activePeriod ? (
        <div className="bg-info/10 text-info text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5">
          Opening balances for: <strong>{activePeriod.name}</strong>
          <span className="text-info/60">— Click any balance to edit</span>
        </div>
      ) : (
        <div className="bg-warning/10 text-warning text-xs font-medium px-3 py-2 rounded-lg">
          No open fiscal period found. Create one in Fiscal Periods to enter opening balances.
        </div>
      )}

      {/* Type summary pills */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilterType("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterType === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
          All ({accounts?.length || 0})
        </button>
        {ACCOUNT_TYPES.map(t => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : `${typeColors[t] || "bg-muted text-muted-foreground"} hover:opacity-80`}`}>
            {t} ({typeCounts[t] || 0})
          </button>
        ))}
      </div>

      <div className="stat-card">
        {/* Search */}
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search by code or name..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : tree.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">{search || filterType !== "all" ? "No matching accounts" : "No accounts yet"}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {search || filterType !== "all" ? "Try adjusting your filters." : "Create your first account to get started."}
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="w-28">Type</th>
                <th className="w-28">Normal Bal.</th>
                <th className="w-36 text-right">Opening Balance</th>
              </tr>
            </thead>
            <tbody>
              {tree.sort((a, b) => a.account_code.localeCompare(b.account_code)).map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  balanceMap={balanceMap}
                  activePeriodId={activePeriod?.id ?? null}
                  tenantId={appUser?.tenant_id}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
