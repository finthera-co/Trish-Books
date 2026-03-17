import { Plus, Search, Download, BookOpen, ChevronRight, Edit2, Power, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { useAccounts, useCreateAccount, useUpdateAccount } from "@/hooks/useData";
import { useAccountCategories, useCreateAccountCategory, useSeedDefaultAccounts } from "@/hooks/useAccountCategories";
import { useAuth } from "@/contexts/AuthContext";
import { useMyPermissions } from "@/hooks/usePermissions";

import AccountForm from "@/components/chart-of-accounts/AccountForm";

import InlineOpeningBalance from "@/components/chart-of-accounts/InlineOpeningBalance";
import { useSystemSetting } from "@/hooks/useOpeningBalanceSettings";

import {
  ACCOUNT_TYPES,
  typeColors,
  getTypeLabel,
  getNormalBalance,
  getStatementPlacement,
} from "@/lib/accountTypes";

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype?: string | null;
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

interface CategoryGroup {
  id: string;
  name: string;
  accounts: Account[];
}

interface TypeGroup {
  type: string;
  categories: CategoryGroup[];
  uncategorized: Account[];
}

function AccountRow({
  account,
  depth = 0,
  onEdit,
  onToggleActive,
}: {
  account: Account;
  depth?: number;
  onEdit: (a: Account) => void;
  onToggleActive: (a: Account) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = account.children && account.children.length > 0;

  return (
    <>
      <tr className={`hover:bg-muted/20 transition-colors ${!account.is_active ? "opacity-50" : ""}`}>
        <td style={{ paddingLeft: `${depth * 20 + 16}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button onClick={() => setExpanded(!expanded)} className="p-0.5 rounded hover:bg-muted">
                <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            ) : <span className="w-4" />}
            <span className="font-mono text-xs text-muted-foreground">{account.account_code}</span>
            <span className="font-medium text-sm text-foreground/80">
              {account.account_name}
            </span>
            {account.account_subtype && (
              <span className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                {account.account_subtype}
              </span>
            )}
            {!account.is_active && (
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Inactive</span>
            )}
          </div>
        </td>
        <td className="text-xs text-muted-foreground">
          {getNormalBalance(account.account_type)}
        </td>
        <td className="text-right">
          <InlineOpeningBalance
            accountId={account.id}
            accountType={account.account_type}
            accountSubtype={account.account_subtype}
            currentBalance={(account as any).opening_balance ?? 0}
            currentType={(account as any).opening_balance_type ?? "debit"}
            normalBalance={getNormalBalance(account.account_type)}
            isLocked={(account as any).is_locked || false}
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
          onEdit={onEdit}
          onToggleActive={onToggleActive}
        />
      ))}
    </>
  );
}

function TypeSection({
  typeGroup,
  onEdit,
  onToggleActive,
}: {
  typeGroup: TypeGroup;
  onEdit: (a: Account) => void;
  onToggleActive: (a: Account) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const totalAccounts = typeGroup.categories.reduce((s, c) => s + c.accounts.length, 0) + typeGroup.uncategorized.length;

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td colSpan={4} className="py-2">
          <div className="flex items-center gap-2">
            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${typeColors[typeGroup.type] || "bg-muted text-muted-foreground"}`}>
              {getTypeLabel(typeGroup.type)}
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              {totalAccounts} account{totalAccounts !== 1 ? "s" : ""}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {getNormalBalance(typeGroup.type)} balance · {getStatementPlacement(typeGroup.type)}
            </span>
          </div>
        </td>
      </tr>
      {expanded && typeGroup.categories.map(cat => (
        <CategorySection
          key={cat.id}
          category={cat}
          accountType={typeGroup.type}
          onEdit={onEdit}
          onToggleActive={onToggleActive}
        />
      ))}
      {expanded && typeGroup.uncategorized.length > 0 && (
        <>
          <tr className="bg-muted/10">
            <td colSpan={4} style={{ paddingLeft: "32px" }}>
              <span className="text-xs font-semibold text-muted-foreground italic">Uncategorized</span>
            </td>
          </tr>
          {buildTree(typeGroup.uncategorized).sort((a, b) => a.account_code.localeCompare(b.account_code)).map(account => (
            <AccountRow
              key={account.id}
              account={account}
              depth={2}
              onEdit={onEdit}
              onToggleActive={onToggleActive}
            />
          ))}
        </>
      )}
    </>
  );
}

function CategorySection({
  category,
  accountType,
  onEdit,
  onToggleActive,
}: {
  category: CategoryGroup;
  accountType: string;
  onEdit: (a: Account) => void;
  onToggleActive: (a: Account) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const tree = buildTree(category.accounts).sort((a, b) => a.account_code.localeCompare(b.account_code));

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-muted/20 transition-colors bg-muted/5"
        onClick={() => setExpanded(!expanded)}
      >
        <td colSpan={4} style={{ paddingLeft: "32px" }}>
          <div className="flex items-center gap-2 py-0.5">
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
            <span className="text-xs font-semibold text-foreground/70">{category.name}</span>
            <span className="text-[10px] text-muted-foreground">({category.accounts.length})</span>
          </div>
        </td>
      </tr>
      {expanded && tree.map(account => (
        <AccountRow
          key={account.id}
          account={account}
          depth={2}
          onEdit={onEdit}
          onToggleActive={onToggleActive}
        />
      ))}
    </>
  );
}

export default function ChartOfAccounts() {
  const { appUser } = useAuth();
  const { canEdit: canEditAccounts } = useMyPermissions();
  const [formOpen, setFormOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  const { data: accounts, isLoading } = useAccounts();
  const { data: categories } = useAccountCategories();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const seedDefaults = useSeedDefaultAccounts();
  const createCategory = useCreateAccountCategory();

  const { data: obStatus } = useSystemSetting("opening_balance_status");

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    return (accounts as Account[]).filter(a => {
      if (!showInactive && !a.is_active) return false;
      if (filterType !== "all" && a.account_type !== filterType) return false;
      if (search) {
        const s = search.toLowerCase();
        return a.account_code.toLowerCase().includes(s) ||
          a.account_name.toLowerCase().includes(s) ||
          (a.account_subtype || "").toLowerCase().includes(s);
      }
      return true;
    });
  }, [accounts, search, filterType, showInactive]);

  // Build Type → Category → Account hierarchy
  const typeGroups = useMemo((): TypeGroup[] => {
    const types = filterType !== "all" ? [filterType] : [...ACCOUNT_TYPES];
    return types.map(type => {
      const typeAccounts = filteredAccounts.filter(a => a.account_type === type);
      const typeCats = (categories || []).filter(c => c.account_type === type);
      const catGroups: CategoryGroup[] = typeCats
        .map(cat => ({
          id: cat.id,
          name: cat.name,
          accounts: typeAccounts.filter(a => a.category_id === cat.id),
        }))
        .filter(g => g.accounts.length > 0);
      const categorizedIds = new Set(catGroups.flatMap(g => g.accounts.map(a => a.id)));
      const uncategorized = typeAccounts.filter(a => !categorizedIds.has(a.id));
      return { type, categories: catGroups, uncategorized };
    }).filter(g => g.categories.length > 0 || g.uncategorized.length > 0);
  }, [filteredAccounts, categories, filterType]);

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
      ["Code", "Name", "Type", "Detail Type", "Category", "Normal Balance", "Statement", "Status"],
      ...(accounts as Account[]).map(a => [
        a.account_code, a.account_name, a.account_type,
        a.account_subtype || "",
        a.account_categories?.name || "",
        getNormalBalance(a.account_type),
        getStatementPlacement(a.account_type),
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
            Type → Category → Account hierarchy ({activeCount} active)
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => seedDefaults.mutate()}
            disabled={seedDefaults.isPending}
          >
            <Sprout className="w-4 h-4 mr-1" />
            {seedDefaults.isPending ? "Seeding..." : "Seed Defaults"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!accounts?.length}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          {canEditAccounts("accounts") && <Button onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4" /> Add Account
          </Button>}
        </div>
      </div>

      {/* OB Status Banner */}
      {obStatus === "finalized" && (
        <div className="bg-info/10 text-info text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2">
          Opening balances are finalized — click any balance to view (read-only)
        </div>
      )}
      {(!obStatus || obStatus === "draft") && (
        <div className="bg-info/10 text-info text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2">
          Click any opening balance to edit inline
        </div>
      )}

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setFilterType("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterType === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
        >
          All ({activeCount})
        </button>
        {ACCOUNT_TYPES.map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : `${typeColors[t] || "bg-muted text-muted-foreground"} hover:opacity-80`}`}
          >
            {getTypeLabel(t)} ({typeCounts[t] || 0})
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

      <div className="stat-card">
        {/* Search */}
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by code, name, or detail type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : typeGroups.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">
              {search || filterType !== "all" ? "No matching accounts" : "No accounts yet"}
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
                <th className="w-24">Normal Bal.</th>
                <th className="w-36 text-right">Opening Balance</th>
                <th className="w-20 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {typeGroups.map((tg) => (
                <TypeSection
                  key={tg.type}
                  typeGroup={tg}
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
        onCreateCategory={async (data) => {
          const result = await createCategory.mutateAsync(data);
          return result;
        }}
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
          onCreateCategory={async (data) => {
            const result = await createCategory.mutateAsync(data);
            return result;
          }}
        />
      )}
    </div>
  );
}
