import { Plus, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface Account {
  code: string;
  name: string;
  type: string;
  balance: number;
  children?: Account[];
}

const mockAccounts: Account[] = [
  {
    code: "1000", name: "Assets", type: "Asset", balance: 125000,
    children: [
      { code: "1100", name: "Cash & Bank", type: "Asset", balance: 52840 },
      { code: "1200", name: "Accounts Receivable", type: "Asset", balance: 34500 },
      { code: "1300", name: "Inventory", type: "Asset", balance: 18200 },
      { code: "1400", name: "Fixed Assets", type: "Asset", balance: 19460 },
    ],
  },
  {
    code: "2000", name: "Liabilities", type: "Liability", balance: 45000,
    children: [
      { code: "2100", name: "Accounts Payable", type: "Liability", balance: 28000 },
      { code: "2200", name: "Loans Payable", type: "Liability", balance: 17000 },
    ],
  },
  {
    code: "3000", name: "Equity", type: "Equity", balance: 80000,
    children: [
      { code: "3100", name: "Owner's Equity", type: "Equity", balance: 65000 },
      { code: "3200", name: "Retained Earnings", type: "Equity", balance: 15000 },
    ],
  },
  {
    code: "4000", name: "Revenue", type: "Revenue", balance: 124500,
    children: [
      { code: "4100", name: "Sales Revenue", type: "Revenue", balance: 98000 },
      { code: "4200", name: "Service Revenue", type: "Revenue", balance: 26500 },
    ],
  },
  {
    code: "5000", name: "Expenses", type: "Expense", balance: 87200,
    children: [
      { code: "5100", name: "Cost of Goods Sold", type: "Expense", balance: 42000 },
      { code: "5200", name: "Operating Expenses", type: "Expense", balance: 31200 },
      { code: "5300", name: "Payroll Expenses", type: "Expense", balance: 14000 },
    ],
  },
];

const typeColors: Record<string, string> = {
  Asset: "bg-info/10 text-info",
  Liability: "bg-warning/10 text-warning",
  Equity: "bg-primary/10 text-primary",
  Revenue: "bg-success/10 text-success",
  Expense: "bg-destructive/10 text-destructive",
};

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
            <span className="font-mono text-xs text-muted-foreground">{account.code}</span>
            <span className={`font-medium ${depth === 0 ? "text-foreground" : ""}`}>{account.name}</span>
          </div>
        </td>
        <td>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[account.type]}`}>
            {account.type}
          </span>
        </td>
        <td className="text-right font-medium text-foreground">${account.balance.toLocaleString()}</td>
      </tr>
      {expanded && account.children?.map((child) => (
        <AccountRow key={child.code} account={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function ChartOfAccounts() {
  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-description">Manage your financial account structure</p>
        </div>
        <Button>
          <Plus className="w-4 h-4" />
          Add Account
        </Button>
      </div>

      <div className="stat-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {mockAccounts.map((account) => (
              <AccountRow key={account.code} account={account} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
