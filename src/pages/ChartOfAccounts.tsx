import { Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useAccounts, useCreateAccount } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const typeColors: Record<string, string> = {
  Asset: "bg-info/10 text-info",
  Liability: "bg-warning/10 text-warning",
  Equity: "bg-primary/10 text-primary",
  Revenue: "bg-success/10 text-success",
  Expense: "bg-destructive/10 text-destructive",
};

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

function AccountRow({ account, depth = 0 }: { account: Account; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = account.children && account.children.length > 0;

  return (
    <>
      <tr>
        <td style={{ paddingLeft: `${depth * 24 + 16}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren && (
              <button onClick={() => setExpanded(!expanded)} className="p-0.5">
                <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            )}
            {!hasChildren && <span className="w-4" />}
            <span className="font-mono text-xs text-muted-foreground">{account.account_code}</span>
            <span className={`font-medium ${depth === 0 ? "text-foreground" : ""}`}>{account.account_name}</span>
          </div>
        </td>
        <td>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[account.account_type] || ""}`}>
            {account.account_type}
          </span>
        </td>
      </tr>
      {expanded && account.children?.map((child) => (
        <AccountRow key={child.id} account={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function ChartOfAccounts() {
  const [open, setOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [accountType, setAccountType] = useState("Asset");
  const [parentId, setParentId] = useState("");

  const { data: accounts, isLoading } = useAccounts();
  const createAccount = useCreateAccount();

  const tree = accounts ? buildTree(accounts) : [];

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

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-description">Manage your financial account structure</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />Add Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Account Code</label>
                  <input type="text" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="1100" />
                </div>
                <div>
                  <label className="text-sm font-medium">Account Type</label>
                  <select value={accountType} onChange={(e) => setAccountType(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                    {["Asset", "Liability", "Equity", "Revenue", "Expense"].map(t => 
                      <option key={t} value={t}>{t}</option>
                    )}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Account Name</label>
                <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Cash & Bank" />
              </div>
              <div>
                <label className="text-sm font-medium">Parent Account (optional)</label>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                  <option value="">None (top-level)</option>
                  {accounts?.map(a => <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>)}
                </select>
              </div>
              <Button onClick={handleCreate} disabled={!accountName || !accountCode || createAccount.isPending} className="w-full">
                {createAccount.isPending ? "Creating..." : "Create Account"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="stat-card">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : tree.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No accounts found. Create your first account to get started.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Account</th><th>Type</th></tr></thead>
            <tbody>
              {tree.map((account) => <AccountRow key={account.id} account={account} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
