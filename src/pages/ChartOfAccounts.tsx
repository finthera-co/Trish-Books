import { Plus, Search, Download, BookOpen, ChevronRight, Edit2, Power, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { useAccounts, useCreateAccount, useUpdateAccount } from "@/hooks/useData";
import { useAccountCategories, useSeedDefaultAccounts } from "@/hooks/useAccountCategories";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/currency";
import AccountForm from "@/components/chart-of-accounts/AccountForm";
import OpeningBalanceCell from "@/components/chart-of-accounts/OpeningBalanceCell";
import { toast } from "sonner";

const typeColors: Record<string, string> = {
  Asset: "bg-info/10 text-info",
  Liability: "bg-warning/10 text-warning",
  Equity: "bg-primary/10 text-primary",
  Revenue: "bg-success/10 text-success",
  COGS: "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
  Expense: "bg-destructive/10 text-destructive",
};

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_account_id: string | null;
  category_id: string | null;
  is_active: boolean;
  account_categories?: { name: string } | null;
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

function AccountRow({
  account,
  depth = 0,
  balanceMap,
  activePeriodId,
  tenantId,
  onEdit,
  onToggleActive,
}: {
  account: Account;
  depth?: number;
  balanceMap: Map<string, number>;
  activePeriodId: string | null;
  tenantId: string | undefined;
  onEdit: (a: Account) => void;
  onToggleActive: (a: Account) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = account.children && account.children.length > 0;

  return (
    <>
      <tr className={`hover:bg-muted/20 transition-colors ${!account.is_active ? "opacity-50" : ""}`}>
        <td style={{ paddingLeft: `${depth * 24 + 16}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button onClick={() => setExpanded(!expanded)} className="p-0.5 rounded hover:bg-muted">
                <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            ) : <span className="w-4" />}
            <span className="font-mono text-xs text-muted-foreground">{account.account_code}</span>
            <span className={`font-medium text-sm ${depth === 0 ? "text-foreground" : "text-foreground/80"}`}>
              {account.account_name}
            </span>
            {!account.is_active && (
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Inactive</span>
            )}
            {hasChildren && <span className="text-[10px] text-muted-foreground">({account.children!.length})</span>}
          </div>
        </td>
        <td>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[account.account_type] || "bg-muted text-muted-foreground"}`}>
            {account.account_type}
          </span>
        </td>
        <td className="text-xs text-muted-foreground">
          {account.account_categories?.name || "—"}
        </td>
        <td className="text-xs text-muted-foreground">
          {["Asset", "Expense", "COGS"].includes(account.account_type) ? "Debit" : "Credit"}
        </td>
        <td className="text-right">
          <OpeningBalanceCell
            accountId={account.id}
            currentBalance={balanceMap.get(account.id) ?? null}
            activePeriodId={activePeriodId}
            tenantId={tenantId}
          />
        </td>
        <td className="text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onEdit(account)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Edit"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onToggleActive(account)}
              className={`p-1 rounded hover:bg-muted ${account.is_active ? "text-muted-foreground hover:text-destructive" : "text-success hover:text-success"}`}
              title={account.is_active ? "Deactivate" : "Activate"}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && account.children?.sort((a, b) => a.account_code.localeCompare(b.account_code)).map((child) => (
        <AccountRow
          key={child.id}
          account={child}
          depth={depth + 1}
          balanceMap={balanceMap}
          activePeriodId={activePeriodId}
          tenantId={tenantId}
          onEdit={onEdit}
          onToggleActive={onToggleActive}
        />
      ))}
    </>
  );
}

export default function ChartOfAccounts() {
  const { appUser } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  const { data: accounts, isLoading } = useAccounts();
  const { data: categories } = useAccountCategories();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const seedDefaults = useSeedDefaultAccounts();

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

  const activePeriod = useMemo(() => {
    if (!fiscalPeriods?.length) return null;
    if (selectedPeriodId) return fiscalPeriods.find(p => p.id === selectedPeriodId) || null;
    return fiscalPeriods.find(p => p.status === "open") || fiscalPeriods[0];
  }, [fiscalPeriods, selectedPeriodId]);

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
    return (accounts as Account[]).filter(a => {
      if (!showInactive && !a.is_active) return false;
      if (filterType !== "all" && a.account_type !== filterType) return false;
      if (filterCategory !== "all" && a.category_id !== filterCategory) return false;
      if (search) {
        const s = search.toLowerCase();
        return a.account_code.toLowerCase().includes(s) || a.account_name.toLowerCase().includes(s);
      }
      return true;
    });
  }, [accounts, search, filterType, filterCategory, showInactive]);

  const tree = buildTree(filteredAccounts);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (accounts as Account[] | undefined)?.forEach(a => {
      if (a.is_active || showInactive) counts[a.account_type] = (counts[a.account_type] || 0) + 1;
    });
    return counts;
  }, [accounts, showInactive]);

  const handleCreate = async (data: any) => {
    await createAccount.mutateAsync(data);
    setFormOpen(false);
  };

  const handleEdit = async (data: any) => {
    if (!editAccount) return;
    await updateAccount.mutateAsync({ id: editAccount.id, ...data });
    setEditAccount(null);
  };

  const handleToggleActive = async (account: Account) => {
    await updateAccount.mutateAsync({ id: account.id, is_active: !account.is_active });
  };

  const handleExportCSV = () => {
    if (!accounts) return;
    const rows = [
      ["Code", "Name", "Type", "Category", "Normal Balance", "Status"],
      ...(accounts as Account[]).map(a => [
        a.account_code, a.account_name, a.account_type,
        a.account_categories?.name || "",
        ["Asset", "Expense", "COGS"].includes(a.account_type) ? "Debit" : "Credit",
        a.is_active ? "Active" : "Inactive",
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "chart-of-accounts.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const activeCount = (accounts as Account[] | undefined)?.filter(a => a.is_active).length || 0;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-description">
            Manage your financial account structure ({activeCount} active accounts)
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(!accounts || accounts.length === 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => seedDefaults.mutate()}
              disabled={seedDefaults.isPending}
            >
              <Sprout className="w-4 h-4 mr-1" />
              {seedDefaults.isPending ? "Seeding..." : "Seed Defaults"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!accounts?.length}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4" /> Add Account
          </Button>
        </div>
      </div>

      {/* Period selector */}
      {fiscalPeriods && fiscalPeriods.length > 0 ? (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-info/10 text-info text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2">
            Opening balances for:
            <select
              value={activePeriod?.id || ""}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="text-xs font-semibold bg-transparent border-none outline-none cursor-pointer text-info"
            >
              {fiscalPeriods.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.status})</option>
              ))}
            </select>
            <span className="text-info/60">— Click any balance to edit</span>
          </div>
        </div>
      ) : (
        <div className="bg-warning/10 text-warning text-xs font-medium px-3 py-2 rounded-lg">
          No fiscal periods found. Create one in Fiscal Periods to enter opening balances.
        </div>
      )}

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => { setFilterType("all"); setFilterCategory("all"); }}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterType === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
        >
          All ({activeCount})
        </button>
        {ACCOUNT_TYPES.map(t => (
          <button
            key={t}
            onClick={() => { setFilterType(t); setFilterCategory("all"); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : `${typeColors[t] || "bg-muted text-muted-foreground"} hover:opacity-80`}`}
          >
            {t} ({typeCounts[t] || 0})
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-input"
          />
          Show inactive
        </label>
      </div>

      {/* Category filter (when a type is selected) */}
      {filterType !== "all" && categories && categories.filter(c => c.account_type === filterType).length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterCategory("all")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${filterCategory === "all" ? "bg-accent text-accent-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
          >
            All Categories
          </button>
          {categories
            .filter(c => c.account_type === filterType)
            .map(c => (
              <button
                key={c.id}
                onClick={() => setFilterCategory(c.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${filterCategory === c.id ? "bg-accent text-accent-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              >
                {c.name}
              </button>
            ))}
        </div>
      )}

      <div className="stat-card">
        {/* Search */}
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by code or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : tree.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">
              {search || filterType !== "all" || filterCategory !== "all" ? "No matching accounts" : "No accounts yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search || filterType !== "all" ? "Try adjusting your filters." : "Click 'Seed Defaults' to create a standard chart of accounts, or add accounts manually."}
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="w-24">Type</th>
                <th className="w-36">Category</th>
                <th className="w-24">Normal Bal.</th>
                <th className="w-36 text-right">Opening Balance</th>
                <th className="w-20 text-right">Actions</th>
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
                  onEdit={(a) => setEditAccount(a)}
                  onToggleActive={handleToggleActive}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create form */}
      <AccountForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleCreate}
        accounts={(accounts as Account[]) || []}
        categories={categories || []}
        isPending={createAccount.isPending}
      />

      {/* Edit form */}
      {editAccount && (
        <AccountForm
          open={!!editAccount}
          onOpenChange={(open) => { if (!open) setEditAccount(null); }}
          onSubmit={handleEdit}
          accounts={(accounts as Account[]) || []}
          categories={categories || []}
          isPending={updateAccount.isPending}
          editAccount={editAccount}
        />
      )}
    </div>
  );
}
