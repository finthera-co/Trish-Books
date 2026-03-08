import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { useInvoices, useExpenses, useJournalEntries } from "@/hooks/useData";
import { useAuth } from "@/contexts/AuthContext";

export default function Index() {
  const { appUser } = useAuth();
  const { data: invoices } = useInvoices();
  const { data: expenses } = useExpenses();
  const { data: journalEntries } = useJournalEntries();

  // Calculate stats from real data
  const totalRevenue = invoices?.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.total_amount), 0) || 0;
  const totalExpenses = expenses?.filter(e => e.status === "approved").reduce((s, e) => s + Number(e.amount), 0) || 0;
  const netProfit = totalRevenue - totalExpenses;
  const pendingInvoices = invoices?.filter(i => i.status === "sent").reduce((s, i) => s + Number(i.total_amount), 0) || 0;

  const stats = [
    { label: "Total Revenue", value: `$${totalRevenue.toLocaleString()}`, change: "+12.5%", trend: "up", icon: DollarSign },
    { label: "Total Expenses", value: `$${totalExpenses.toLocaleString()}`, change: "+3.1%", trend: "up", icon: TrendingDown },
    { label: "Net Profit", value: `$${netProfit.toLocaleString()}`, change: netProfit >= 0 ? "+18.2%" : "-5%", trend: netProfit >= 0 ? "up" : "down", icon: TrendingUp },
    { label: "Pending Invoices", value: `$${pendingInvoices.toLocaleString()}`, change: "", trend: "up", icon: Wallet },
  ];

  // Recent transactions from journal entries
  const recentTransactions = journalEntries?.slice(0, 5).map(entry => ({
    id: entry.id.slice(0, 8),
    description: entry.description,
    date: entry.entry_date,
    amount: (entry.journal_lines as any[])?.reduce((s, l) => s + Number(l.debit), 0) || 0,
  })) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Dashboard</h1>
          <p className="page-description">
            Welcome back, {appUser?.first_name}! Here's your financial overview.
          </p>
        </div>
        <div className="flex gap-2">
          <select className="text-sm border rounded-md px-3 py-2 bg-card text-foreground">
            <option>This Month</option>
            <option>Last Month</option>
            <option>This Quarter</option>
            <option>This Year</option>
          </select>
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
                <span
                  className={`flex items-center text-xs font-medium ${
                    stat.trend === "up" ? "text-success" : "text-destructive"
                  }`}
                >
                  {stat.trend === "up" ? (
                    <ArrowUpRight className="w-3 h-3 mr-0.5" />
                  ) : (
                    <ArrowDownRight className="w-3 h-3 mr-0.5" />
                  )}
                  {stat.change}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

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
                  <td className="text-right font-medium text-foreground">
                    ${txn.amount.toLocaleString()}
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
