import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { useInvoices, useExpenses, useJournalEntries, useAccounts } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";

const COLORS = ["hsl(215, 60%, 42%)", "hsl(142, 71%, 35%)", "hsl(38, 92%, 50%)", "hsl(199, 89%, 48%)", "hsl(0, 72%, 51%)"];

export default function Index() {
  const { appUser } = useAuth();
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: journalEntries } = useJournalEntries();
  const { data: accounts } = useAccounts();

  const totalRevenue = invoices?.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.total_amount), 0) || 0;
  const totalExpenses = expenses?.filter(e => e.status === "approved").reduce((s, e) => s + Number(e.amount), 0) || 0;
  const netProfit = totalRevenue - totalExpenses;
  const pendingInvoices = invoices?.filter(i => i.status === "sent").reduce((s, i) => s + Number(i.total_amount), 0) || 0;

  const stats = [
    { label: "Total Revenue", value: `LKR ${totalRevenue.toLocaleString()}`, change: totalRevenue > 0 ? "+12.5%" : "", trend: "up", icon: DollarSign },
    { label: "Total Expenses", value: `LKR ${totalExpenses.toLocaleString()}`, change: totalExpenses > 0 ? "+3.1%" : "", trend: "up", icon: TrendingDown },
    { label: "Net Profit", value: `LKR ${netProfit.toLocaleString()}`, change: netProfit !== 0 ? (netProfit >= 0 ? "+18.2%" : "-5%") : "", trend: netProfit >= 0 ? "up" : "down", icon: TrendingUp },
    { label: "Pending Invoices", value: `LKR ${pendingInvoices.toLocaleString()}`, change: "", trend: "up", icon: Wallet },
  ];

  // Monthly revenue chart from invoices
  const monthlyData = (() => {
    const months: Record<string, { revenue: number; expenses: number }> = {};
    invoices?.filter(i => i.status === "paid").forEach(inv => {
      const month = inv.issue_date?.slice(0, 7) || "Unknown";
      if (!months[month]) months[month] = { revenue: 0, expenses: 0 };
      months[month].revenue += Number(inv.total_amount);
    });
    expenses?.filter(e => e.status === "approved").forEach(exp => {
      const month = exp.expense_date?.slice(0, 7) || "Unknown";
      if (!months[month]) months[month] = { revenue: 0, expenses: 0 };
      months[month].expenses += Number(exp.amount);
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, data]) => ({ month, ...data }));
  })();

  // Expense by category pie chart
  const expenseByCategory = (() => {
    const cats: Record<string, number> = {};
    expenses?.forEach(e => {
      const cat = (e.expense_categories as any)?.name || "Uncategorized";
      cats[cat] = (cats[cat] || 0) + Number(e.amount);
    });
    return Object.entries(cats).map(([name, value]) => ({ name, value }));
  })();

  // Account type summary
  const accountTypeSummary = (() => {
    const types: Record<string, number> = {};
    const balanceMap = new Map<string, number>();
    accounts?.forEach(a => balanceMap.set(a.id, 0));
    journalEntries?.forEach(entry => {
      ((entry.journal_lines as any[]) || []).forEach(line => {
        const current = balanceMap.get(line.account_id) || 0;
        balanceMap.set(line.account_id, current + Number(line.debit) - Number(line.credit));
      });
    });
    accounts?.forEach(a => {
      const bal = Math.abs(balanceMap.get(a.id) || 0);
      if (bal > 0) types[a.account_type] = (types[a.account_type] || 0) + bal;
    });
    return Object.entries(types).map(([name, value]) => ({ name, value }));
  })();

  const recentTransactions = journalEntries?.slice(0, 5).map(entry => ({
    id: entry.id.slice(0, 8),
    description: entry.description,
    date: entry.entry_date,
    amount: (entry.journal_lines as any[])?.reduce((s, l) => s + Number(l.debit), 0) || 0,
  })) || [];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Dashboard</h1>
          <p className="page-description">
            Welcome back, {appUser?.first_name}! Here's your financial overview.
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-semibold text-foreground">{stat.value}</span>
              {stat.change && (
                <span className={`flex items-center text-xs font-medium ${stat.trend === "up" ? "text-success" : "text-destructive"}`}>
                  {stat.trend === "up" ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {stat.change}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue vs Expenses */}
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Revenue vs Expenses</h3>
          {monthlyData.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground text-sm">Create invoices and expenses to see trends here.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(215, 14%, 46%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(215, 14%, 46%)" />
                <Tooltip />
                <Bar dataKey="revenue" fill="hsl(142, 71%, 35%)" radius={[4, 4, 0, 0]} name="Revenue" />
                <Bar dataKey="expenses" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Account Balances by Type */}
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Account Balances by Type</h3>
          {accountTypeSummary.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground text-sm">Post journal entries to see account balances.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={accountTypeSummary} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: LKR ${value.toLocaleString()}`}>
                  {accountTypeSummary.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Expense by Category */}
      {expenseByCategory.length > 0 && (
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Expenses by Category</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={expenseByCategory} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 20%, 90%)" />
              <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(215, 14%, 46%)" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(215, 14%, 46%)" width={120} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(38, 92%, 50%)" radius={[0, 4, 4, 0]} name="Amount" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="stat-card">
        <h3 className="text-sm font-medium text-foreground mb-4">Recent Transactions</h3>
        {recentTransactions.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No transactions yet. Create journal entries to see them here.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Description</th>
                <th>Date</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map((txn) => (
                <tr key={txn.id}>
                  <td className="font-medium text-foreground">{txn.id}...</td>
                  <td>{txn.description}</td>
                  <td className="text-muted-foreground">{txn.date}</td>
                  <td className="text-right font-medium text-foreground">${txn.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
