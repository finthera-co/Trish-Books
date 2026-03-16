import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";

const COLORS = [
  "hsl(200, 98%, 39%)", "hsl(142, 71%, 35%)", "hsl(38, 92%, 50%)",
  "hsl(270, 60%, 50%)", "hsl(0, 72%, 51%)", "hsl(199, 89%, 48%)",
];

const fmt = (v: number) => `LKR ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const kFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;

interface Props {
  metrics: DashboardMetrics;
}

export default function DashboardCharts({ metrics }: Props) {
  const { monthlyData, expenseDistribution, topCustomers } = metrics;
  const hasMonthly = monthlyData.some(d => d.revenue || d.expenses || d.inflow || d.outflow);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Cash Flow */}
      <ChartCard title="Cash Flow">
        {!hasMonthly ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(212, 26%, 83%)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(215, 20%, 65%)" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(215, 20%, 65%)" tickFormatter={kFmt} />
              <Tooltip formatter={(v: number) => [fmt(v), ""]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="inflow" stroke="hsl(142, 71%, 35%)" strokeWidth={2} dot={{ r: 3 }} name="Inflows" />
              <Line type="monotone" dataKey="outflow" stroke="hsl(0, 72%, 51%)" strokeWidth={2} dot={{ r: 3 }} name="Outflows" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Income vs Expense */}
      <ChartCard title="Income vs Expenses">
        {!hasMonthly ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(212, 26%, 83%)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(215, 20%, 65%)" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(215, 20%, 65%)" tickFormatter={kFmt} />
              <Tooltip formatter={(v: number) => [fmt(v), ""]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" fill="hsl(200, 98%, 39%)" radius={[4, 4, 0, 0]} name="Revenue" />
              <Bar dataKey="expenses" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Top Customers */}
      <ChartCard title="Top 5 Customers by Balance">
        {topCustomers.length === 0 ? <EmptyChart text="No customer balances found." /> : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topCustomers} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(212, 26%, 83%)" />
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(215, 20%, 65%)" tickFormatter={kFmt} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(215, 20%, 65%)" width={100} />
              <Tooltip formatter={(v: number) => [fmt(v), "Balance"]} />
              <Bar dataKey="balance" fill="hsl(199, 89%, 48%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Expense Distribution */}
      <ChartCard title="Expense Distribution">
        {expenseDistribution.length === 0 ? <EmptyChart text="No categorized expenses found." /> : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={expenseDistribution}
                cx="50%" cy="50%"
                outerRadius={85} innerRadius={45}
                dataKey="value"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                labelLine={{ strokeWidth: 1 }}
              >
                {expenseDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [fmt(v), ""]} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      {children}
    </div>
  );
}

function EmptyChart({ text = "Post journal entries to see trends." }: { text?: string }) {
  return <p className="text-center py-16 text-muted-foreground text-sm">{text}</p>;
}
