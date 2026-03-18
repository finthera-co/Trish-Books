import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, AreaChart, Area,
} from "recharts";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";

const COLORS = [
  "hsl(217, 91%, 60%)", "hsl(160, 84%, 39%)", "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)", "hsl(0, 84%, 60%)", "hsl(199, 89%, 48%)",
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-fade-in">
      {/* Cash Flow */}
      <ChartCard title="Cash Flow" subtitle="Inflows vs Outflows">
        {!hasMonthly ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={monthlyData}>
              <defs>
                <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(160, 84%, 39%)" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="hsl(160, 84%, 39%)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={kFmt} />
              <Tooltip formatter={(v: number) => [fmt(v), ""]} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(220, 13%, 91%)', fontSize: '12px' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="inflow" stroke="hsl(160, 84%, 39%)" strokeWidth={2} fill="url(#inflowGrad)" name="Inflows" />
              <Area type="monotone" dataKey="outflow" stroke="hsl(0, 84%, 60%)" strokeWidth={2} fill="url(#outflowGrad)" name="Outflows" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Income vs Expense */}
      <ChartCard title="Income vs Expenses" subtitle="Monthly comparison">
        {!hasMonthly ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={kFmt} />
              <Tooltip formatter={(v: number) => [fmt(v), ""]} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(220, 13%, 91%)', fontSize: '12px' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" fill="hsl(217, 91%, 60%)" radius={[6, 6, 0, 0]} name="Revenue" />
              <Bar dataKey="expenses" fill="hsl(0, 84%, 60%)" radius={[6, 6, 0, 0]} name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Top Customers */}
      <ChartCard title="Top 5 Customers" subtitle="By outstanding balance">
        {topCustomers.length === 0 ? <EmptyChart text="No customer balances found." /> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={topCustomers} layout="vertical" barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={kFmt} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" width={100} />
              <Tooltip formatter={(v: number) => [fmt(v), "Balance"]} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(220, 13%, 91%)', fontSize: '12px' }} />
              <Bar dataKey="balance" fill="hsl(199, 89%, 48%)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Expense Distribution */}
      <ChartCard title="Expense Distribution" subtitle="By category">
        {expenseDistribution.length === 0 ? <EmptyChart text="No categorized expenses found." /> : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={expenseDistribution}
                cx="50%" cy="50%"
                outerRadius={90} innerRadius={50}
                dataKey="value"
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                labelLine={{ strokeWidth: 1 }}
              >
                {expenseDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [fmt(v), ""]} contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ text = "Post journal entries to see trends." }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-muted-foreground text-sm">{text}</p>
    </div>
  );
}
