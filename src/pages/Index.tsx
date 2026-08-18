import {
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  BookOpen,
  FileText,
  Receipt,
  Banknote,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import {
  useInvoices, useExpenses, useAccounts,
  useMonthlyAccountMovements, useRecentJournalEntries, useJournalEntryStats,
} from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";
import { format, subMonths, startOfMonth } from "date-fns";
import { isDebitNormal } from "@/lib/accountTypes";
import { formatDate } from "@/lib/format";

// Income statement sides, by canonical account_type. These must match
// src/lib/accountTypes.ts — the previous values here were "Revenue" and "COGS",
// which are not account types this app ever writes, so both sets matched nothing
// and the dashboard reported zero revenue.
const INCOME_TYPES = ["Income", "Other Income"];
const EXPENSE_TYPES = ["Expense", "Cost of Goods Sold", "Other Expense"];

const COLORS = ["hsl(215, 60%, 42%)", "hsl(142, 71%, 35%)", "hsl(38, 92%, 50%)", "hsl(199, 89%, 48%)", "hsl(0, 72%, 51%)", "hsl(270, 60%, 50%)"];

const fmt = (n: number) => `LKR ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Index() {
  const { appUser } = useAuth();
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: accounts } = useAccounts();
  // Pre-aggregated GL totals (one row per month per account) instead of every
  // journal entry and line. Already restricted to posted, non-voided entries.
  const { data: movements } = useMonthlyAccountMovements();
  const { data: recentEntries } = useRecentJournalEntries(8);
  const { data: entryStats } = useJournalEntryStats();

  // Calculate real metrics from journal entries (not hardcoded)
  const metrics = useMemo(() => {
    let totalRevenue = 0;
    let totalExpenses = 0;
    let prevMonthRevenue = 0;
    let prevMonthExpenses = 0;

    const now = new Date();
    const lastMonth = format(subMonths(now, 1), "yyyy-MM");

    (movements || []).forEach(m => {
      const month = m.month?.slice(0, 7);
      if (INCOME_TYPES.includes(m.account_type)) {
        const amt = m.credit - m.debit;
        totalRevenue += amt;
        if (month === lastMonth) prevMonthRevenue += amt;
      }
      if (EXPENSE_TYPES.includes(m.account_type)) {
        const amt = m.debit - m.credit;
        totalExpenses += amt;
        if (month === lastMonth) prevMonthExpenses += amt;
      }
    });

    const netIncome = totalRevenue - totalExpenses;
    const pendingInvoices = invoices?.filter(i => i.status === "sent").reduce((s, i) => s + Number(i.total_amount), 0) || 0;
    const overdueInvoices = invoices?.filter(i => i.status === "overdue").reduce((s, i) => s + Number(i.total_amount), 0) || 0;
    const pendingExpenses = expenses?.filter(e => e.status === "pending").length || 0;

    // Calculate real MoM change
    const revenueChange = prevMonthRevenue > 0 ? ((totalRevenue - prevMonthRevenue) / prevMonthRevenue * 100) : 0;
    const expenseChange = prevMonthExpenses > 0 ? ((totalExpenses - prevMonthExpenses) / prevMonthExpenses * 100) : 0;

    return { totalRevenue, totalExpenses, netIncome, pendingInvoices, overdueInvoices, pendingExpenses, revenueChange, expenseChange };
  }, [movements, invoices, expenses]);

  const stats = [
    {
      label: "Total Revenue", value: fmt(metrics.totalRevenue),
      change: metrics.revenueChange !== 0 ? `${metrics.revenueChange > 0 ? "+" : ""}${metrics.revenueChange.toFixed(1)}%` : null,
      trend: metrics.revenueChange >= 0 ? "up" : "down",
      icon: TrendingUp, color: "text-success",
    },
    {
      label: "Total Expenses", value: fmt(metrics.totalExpenses),
      change: metrics.expenseChange !== 0 ? `${metrics.expenseChange > 0 ? "+" : ""}${metrics.expenseChange.toFixed(1)}%` : null,
      trend: metrics.expenseChange <= 0 ? "up" : "down",
      icon: TrendingDown, color: "text-destructive",
    },
    {
      label: "Net Income", value: fmt(metrics.netIncome),
      change: null, trend: metrics.netIncome >= 0 ? "up" : "down",
      icon: Wallet, color: metrics.netIncome >= 0 ? "text-success" : "text-destructive",
    },
    {
      label: "Outstanding Invoices", value: fmt(metrics.pendingInvoices),
      subtext: metrics.overdueInvoices > 0 ? `${fmt(metrics.overdueInvoices)} overdue` : null,
      change: null, trend: "up",
      icon: FileText, color: "text-foreground",
    },
  ];

  // Monthly revenue vs expenses from journal entries
  const monthlyData = useMemo(() => {
    const months: Record<string, { revenue: number; expenses: number }> = {};

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const m = format(subMonths(new Date(), i), "yyyy-MM");
      months[m] = { revenue: 0, expenses: 0 };
    }

    (movements || []).forEach(mv => {
      const month = mv.month?.slice(0, 7);
      if (!month || !months[month]) return;
      if (INCOME_TYPES.includes(mv.account_type)) {
        months[month].revenue += mv.credit - mv.debit;
      }
      if (EXPENSE_TYPES.includes(mv.account_type)) {
        months[month].expenses += mv.debit - mv.credit;
      }
    });

    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month: format(new Date(month + "-01"), "MMM yy"),
        ...data,
      }));
  }, [movements]);

  // Account type breakdown
  const accountBreakdown = useMemo(() => {
    // Roll the monthly rows up per account, signed by the account's normal balance.
    const balanceMap = new Map<string, number>();
    (movements || []).forEach(mv => {
      const signed = isDebitNormal(mv.account_type)
        ? mv.debit - mv.credit
        : mv.credit - mv.debit;
      balanceMap.set(mv.account_id, (balanceMap.get(mv.account_id) || 0) + signed);
    });
    const types: Record<string, number> = {};
    accounts?.forEach(a => {
      const bal = balanceMap.get(a.id) || 0;
      if (bal > 0) types[a.account_type] = (types[a.account_type] || 0) + bal;
    });
    return Object.entries(types).map(([name, value]) => ({ name, value }));
  }, [movements, accounts]);

  // Recent transactions
  const recentTransactions = useMemo(() => {
    return (recentEntries || []).map(entry => ({
      id: entry.id,
      description: entry.description,
      reference: entry.reference || entry.id.slice(0, 8),
      date: entry.entry_date,
      amount: Number(entry.total_debit) || 0,
      isReversal: !!entry.reversal_of,
    }));
  }, [recentEntries]);

  // Quick stats row
  const quickStats = [
    { label: "Journal Entries", value: entryStats?.posted ?? 0, icon: BookOpen },
    { label: "Accounts", value: accounts?.length || 0, icon: Receipt },
    { label: "Pending Expenses", value: metrics.pendingExpenses, icon: Banknote },
    { label: "Active Invoices", value: invoices?.filter(i => ["sent", "draft"].includes(i.status)).length || 0, icon: FileText },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Dashboard</h1>
          <p className="page-description">
            Welcome back, {appUser?.first_name}. Here's your financial overview as of {formatDate(new Date())}.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className={`text-2xl font-bold tabular-nums ${stat.color}`}>{stat.value}</p>
            <div className="flex items-center justify-between mt-1">
              {stat.change ? (
                <span className={`flex items-center text-xs font-medium ${stat.trend === "up" ? "text-success" : "text-destructive"}`}>
                  {stat.trend === "up" ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {stat.change} vs last month
                </span>
              ) : (stat as any).subtext ? (
                <span className="text-xs text-destructive font-medium">{(stat as any).subtext}</span>
              ) : (
                <span />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {quickStats.map(s => (
          <div key={s.label} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card">
            <s.icon className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-lg font-bold text-foreground tabular-nums">{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="stat-card">
          <h3 className="text-sm font-semibold text-foreground mb-4">Revenue vs Expenses (Last 6 Months)</h3>
          {monthlyData.every(d => d.revenue === 0 && d.expenses === 0) ? (
            <p className="text-center py-12 text-muted-foreground text-sm">Post journal entries to see trends.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [`LKR ${v.toLocaleString()}`, ""]} />
                <Bar dataKey="revenue" fill="hsl(142, 71%, 35%)" radius={[4, 4, 0, 0]} name="Revenue" />
                <Bar dataKey="expenses" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="stat-card">
          <h3 className="text-sm font-semibold text-foreground mb-4">Balance by Account Type</h3>
          {accountBreakdown.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground text-sm">Post journal entries to see account balances.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={accountBreakdown} cx="50%" cy="50%" outerRadius={90} innerRadius={45} dataKey="value"
                  label={({ name, value }) => `${name}: LKR ${(value/1000).toFixed(0)}k`}>
                  {accountBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`LKR ${v.toLocaleString()}`, ""]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="stat-card">
        <h3 className="text-sm font-semibold text-foreground mb-4">Recent Journal Entries</h3>
        {recentTransactions.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground text-sm">No posted transactions yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th className="text-right">Amount (LKR)</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map((txn) => (
                <tr key={txn.id}>
                  <td className="text-muted-foreground tabular-nums">{formatDate(txn.date)}</td>
                  <td className="font-medium text-foreground">
                    {txn.description}
                    {txn.isReversal && <span className="ml-1 text-xs text-destructive">(reversal)</span>}
                  </td>
                  <td className="font-mono text-xs text-muted-foreground">{txn.reference}</td>
                  <td className="text-right font-mono tabular-nums font-medium text-foreground">
                    {txn.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
