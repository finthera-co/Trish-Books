import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const stats = [
  { label: "Total Revenue", value: "$124,500", change: "+12.5%", trend: "up", icon: DollarSign },
  { label: "Total Expenses", value: "$87,200", change: "+3.1%", trend: "up", icon: TrendingDown },
  { label: "Net Profit", value: "$37,300", change: "+18.2%", trend: "up", icon: TrendingUp },
  { label: "Cash Balance", value: "$52,840", change: "-2.4%", trend: "down", icon: Wallet },
];

const monthlyData = [
  { month: "Jan", revenue: 18000, expenses: 12000 },
  { month: "Feb", revenue: 20000, expenses: 14000 },
  { month: "Mar", revenue: 17500, expenses: 11000 },
  { month: "Apr", revenue: 22000, expenses: 15000 },
  { month: "May", revenue: 24500, expenses: 16500 },
  { month: "Jun", revenue: 22500, expenses: 18700 },
];

const cashFlowData = [
  { month: "Jan", balance: 42000 },
  { month: "Feb", balance: 48000 },
  { month: "Mar", balance: 54500 },
  { month: "Apr", balance: 51000 },
  { month: "May", balance: 59000 },
  { month: "Jun", balance: 52840 },
];

const recentTransactions = [
  { id: "TXN-001", description: "Office Supplies", account: "Expenses", amount: -1250, date: "2026-03-07" },
  { id: "TXN-002", description: "Client Payment - Acme Corp", account: "Revenue", amount: 8500, date: "2026-03-06" },
  { id: "TXN-003", description: "Utility Bill", account: "Expenses", amount: -340, date: "2026-03-05" },
  { id: "TXN-004", description: "Consulting Fee", account: "Revenue", amount: 4200, date: "2026-03-05" },
  { id: "TXN-005", description: "Software License", account: "Expenses", amount: -899, date: "2026-03-04" },
];

export default function Index() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Dashboard</h1>
          <p className="page-description">Overview of your financial performance</p>
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
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Revenue vs Expenses</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
              <Tooltip />
              <Bar dataKey="revenue" fill="hsl(215 60% 42%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" fill="hsl(0 72% 51%)" radius={[4, 4, 0, 0]} opacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Cash Flow Trend</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={cashFlowData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 20% 90%)" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(215 14% 46%)" />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="balance"
                stroke="hsl(215 60% 42%)"
                strokeWidth={2}
                dot={{ fill: "hsl(215 60% 42%)", r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="stat-card">
        <h3 className="text-sm font-medium text-foreground mb-4">Recent Transactions</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Description</th>
              <th>Account</th>
              <th>Date</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {recentTransactions.map((txn) => (
              <tr key={txn.id}>
                <td className="font-medium text-foreground">{txn.id}</td>
                <td>{txn.description}</td>
                <td>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                    {txn.account}
                  </span>
                </td>
                <td className="text-muted-foreground">{txn.date}</td>
                <td className={`text-right font-medium ${txn.amount >= 0 ? "text-success" : "text-destructive"}`}>
                  {txn.amount >= 0 ? "+" : ""}
                  ${Math.abs(txn.amount).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
