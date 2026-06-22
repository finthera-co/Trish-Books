import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line, ReferenceLine,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Scale, TrendingUp, TrendingDown, Wallet, LineChart as LineChartIcon } from "lucide-react";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";

const COLORS = [
  "hsl(217, 91%, 60%)", "hsl(160, 84%, 39%)", "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)", "hsl(0, 84%, 60%)", "hsl(199, 89%, 48%)",
];

const INFLOW = "hsl(160 84% 39%)";   // emerald
const OUTFLOW = "hsl(0 84% 60%)";    // red
const NET = "hsl(217 91% 60%)";      // blue
const MARGIN = "hsl(38 92% 50%)";    // amber
const soft = (c: string) => c.replace(")", " / 0.10)");

const fmt = (v: number) => `LKR ${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const kFmt = (v: number) => {
  const a = Math.abs(v);
  return `${v < 0 ? "-" : ""}${a >= 1000 ? `${(a / 1000).toFixed(0)}k` : a}`;
};

interface Props {
  metrics: DashboardMetrics;
}

export default function DashboardCharts({ metrics }: Props) {
  const { monthlyData, expenseDistribution, topCustomers, totalInflows, totalOutflows } = metrics;
  const hasMonthly = monthlyData.some(d => d.revenue || d.expenses || d.inflow || d.outflow);

  // Diverging series: inflows above the zero line, outflows below it, net as a line.
  const cashData = monthlyData.map(d => ({
    month: d.month,
    inflow: d.inflow,
    outflowNeg: -d.outflow,
    net: d.inflow - d.outflow,
  }));

  const netCashFlow = totalInflows - totalOutflows;
  const monthsWithData = cashData.filter(d => d.inflow || d.outflowNeg);
  const avgMonthlyNet = monthsWithData.length ? netCashFlow / monthsWithData.length : 0;
  const best = monthsWithData.reduce<typeof cashData[number] | null>((b, d) => (!b || d.net > b.net ? d : b), null);

  // Monthly profit: net profit per month + net margin %. (expenses already includes COGS.)
  const profitData = monthlyData.map(d => {
    const profit = d.revenue - d.expenses;
    return { month: d.month, profit, margin: d.revenue ? (profit / d.revenue) * 100 : 0 };
  });
  const totalNetProfit = profitData.reduce((s, d) => s + d.profit, 0);
  const totalRevenuePeriod = monthlyData.reduce((s, d) => s + d.revenue, 0);
  const avgMargin = totalRevenuePeriod ? (totalNetProfit / totalRevenuePeriod) * 100 : 0;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Cash Flow — full-width hero chart */}
      <div className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 sm:px-6 pt-5">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" /> Cash Flow
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Money in vs money out across the period — net trend overlaid
            </p>
          </div>
          <div
            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              backgroundColor: netCashFlow >= 0 ? "hsl(160 84% 39% / 0.12)" : "hsl(0 84% 60% / 0.12)",
              color: netCashFlow >= 0 ? INFLOW : OUTFLOW,
            }}
          >
            {netCashFlow >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            Net {fmt(netCashFlow)}
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 px-5 sm:px-6 pt-4">
          <StatTile label="Total Inflows" value={fmt(totalInflows)} icon={ArrowUpRight} color={INFLOW} />
          <StatTile label="Total Outflows" value={fmt(totalOutflows)} icon={ArrowDownRight} color={OUTFLOW} />
          <StatTile label="Net Cash Flow" value={fmt(netCashFlow)} icon={Scale} color={NET} signed={netCashFlow} />
          <StatTile label="Avg / Month" value={fmt(avgMonthlyNet)} icon={Scale} color={NET} signed={avgMonthlyNet} />
          <StatTile
            label="Best Month"
            value={best ? best.month : "—"}
            sub={best ? `+${fmt(best.net)}` : undefined}
            icon={TrendingUp}
            color={INFLOW}
          />
        </div>

        <div className="px-2 sm:px-4 pb-5 pt-4">
          {!hasMonthly ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={cashData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }} stackOffset="sign">
                <defs>
                  <linearGradient id="inflowBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={INFLOW} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={INFLOW} stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="outflowBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={OUTFLOW} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={OUTFLOW} stopOpacity={0.95} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={kFmt} />
                <Tooltip
                  formatter={(v: number, name: string) => [fmt(v), name]}
                  contentStyle={{ borderRadius: "10px", border: "1px solid hsl(220, 13%, 91%)", fontSize: "12px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="hsl(220, 13%, 80%)" />
                <Bar dataKey="inflow" name="Inflows" fill="url(#inflowBar)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                <Bar dataKey="outflowNeg" name="Outflows" fill="url(#outflowBar)" radius={[0, 0, 6, 6]} maxBarSize={48} />
                <Line type="monotone" dataKey="net" name="Net Cash Flow" stroke={NET} strokeWidth={2.5} dot={{ r: 3, fill: NET }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Monthly Profit Trend — net profit bars + margin line */}
      <div className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 sm:px-6 pt-5">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <LineChartIcon className="w-4 h-4 text-primary" /> Monthly Profit Trend
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Net profit per month with net-margin % overlaid
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: totalNetProfit >= 0 ? soft(INFLOW) : soft(OUTFLOW),
                color: totalNetProfit >= 0 ? INFLOW : OUTFLOW,
              }}
            >
              {totalNetProfit >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              Net Profit {fmt(totalNetProfit)}
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: soft(MARGIN), color: MARGIN }}
            >
              {avgMargin.toFixed(1)}% avg margin
            </span>
          </div>
        </div>
        <div className="px-2 sm:px-4 pb-5 pt-4">
          {!hasMonthly ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={profitData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
                <YAxis yAxisId="amt" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={kFmt} />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} stroke={MARGIN} tickFormatter={(v) => `${Math.round(v)}%`} />
                <Tooltip
                  formatter={(v: number, name: string) => [name === "Net Margin" ? `${v.toFixed(1)}%` : fmt(v), name]}
                  contentStyle={{ borderRadius: "10px", border: "1px solid hsl(220, 13%, 91%)", fontSize: "12px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine yAxisId="amt" y={0} stroke="hsl(220, 13%, 80%)" />
                <Bar yAxisId="amt" dataKey="profit" name="Net Profit" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {profitData.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? INFLOW : OUTFLOW} />)}
                </Bar>
                <Line yAxisId="pct" type="monotone" dataKey="margin" name="Net Margin" stroke={MARGIN} strokeWidth={2.5} dot={{ r: 3, fill: MARGIN }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Income vs Expense */}
        <ChartCard title="Income vs Expenses" subtitle="Monthly comparison (accrual)">
          {!hasMonthly ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData} barGap={4}>
                <defs>
                  <linearGradient id="revBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.6} />
                  </linearGradient>
                  <linearGradient id="expBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={kFmt} />
                <Tooltip formatter={(v: number) => [fmt(v), ""]} contentStyle={{ borderRadius: "8px", border: "1px solid hsl(220, 13%, 91%)", fontSize: "12px" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="revenue" fill="url(#revBar)" radius={[6, 6, 0, 0]} name="Revenue" />
                <Bar dataKey="expenses" fill="url(#expBar)" radius={[6, 6, 0, 0]} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Top Customers */}
        <ChartCard title="Top 5 Customers" subtitle="By outstanding balance">
          {topCustomers.length === 0 ? <EmptyChart text="No customer balances found." /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topCustomers} layout="vertical" barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={kFmt} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" width={100} />
                <Tooltip formatter={(v: number) => [fmt(v), "Balance"]} contentStyle={{ borderRadius: "8px", border: "1px solid hsl(220, 13%, 91%)", fontSize: "12px" }} />
                <Bar dataKey="balance" radius={[0, 6, 6, 0]}>
                  {topCustomers.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Expense Distribution */}
        <ChartCard title="Expense Distribution" subtitle="By category" className="lg:col-span-2">
          {expenseDistribution.length === 0 ? <EmptyChart text="No categorized expenses found." /> : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={expenseDistribution}
                  cx="50%" cy="50%"
                  outerRadius={100} innerRadius={60}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  labelLine={{ strokeWidth: 1 }}
                >
                  {expenseDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [fmt(v), ""]} contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, icon: Icon, color, signed }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string; signed?: number;
}) {
  const valueColor = signed !== undefined ? (signed >= 0 ? INFLOW : OUTFLOW) : "hsl(var(--foreground))";
  return (
    <div
      className="rounded-xl border border-border/60 p-3"
      style={{ backgroundImage: `linear-gradient(135deg, ${soft(color)}, transparent)` }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}
      </div>
      <p className="mt-1.5 text-lg font-bold tracking-tight truncate" style={{ color: valueColor }}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-2xl border border-border/60 p-5 shadow-sm hover:shadow-md transition-shadow duration-300 ${className ?? ""}`}>
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
