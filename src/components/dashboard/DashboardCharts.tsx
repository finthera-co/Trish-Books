import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line, ReferenceLine,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Scale, TrendingUp, TrendingDown, Wallet, LineChart as LineChartIcon, FileText, CreditCard, CalendarClock, Receipt, Landmark } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";
import RecentTransactions from "@/components/dashboard/RecentTransactions";

// Distinct, modern palette so every expense category gets its own colour.
const EXPENSE_PALETTE = [
  "hsl(217, 91%, 60%)", "hsl(160, 84%, 39%)", "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)", "hsl(0, 84%, 60%)", "hsl(199, 89%, 48%)",
  "hsl(330, 81%, 60%)", "hsl(24, 95%, 53%)", "hsl(142, 71%, 45%)",
  "hsl(252, 83%, 67%)", "hsl(173, 80%, 40%)", "hsl(47, 96%, 53%)",
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
  const navigate = useNavigate();
  const {
    monthlyData, expenseDistribution, totalInflows, totalOutflows,
    invoiceCount, overdueInvoiceCount, accountsPayable, currentMonthOverdueAmount,
    bankAccounts,
  } = metrics;
  const hasMonthly = monthlyData.some(d => d.revenue || d.expenses || d.inflow || d.outflow);

  // Diverging series: inflows above the zero line, outflows below it, net as a line.
  const cashData = monthlyData.map(d => ({
    month: d.month,
    inflow: d.inflow,
    outflowNeg: -d.outflow,
    net: d.inflow - d.outflow,
  }));

  const totalExpenseDist = expenseDistribution.reduce((s, d) => s + d.value, 0);

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
      {/* Invoice / payables summary strip — sits above the Cash Flow card */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => navigate("/sales/invoices")}
          className="text-left rounded-2xl border border-border/60 shadow-sm p-4 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ backgroundImage: `linear-gradient(135deg, hsl(217 91% 60% / 0.18), hsl(var(--card)))` }}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <FileText className="w-3.5 h-3.5" style={{ color: NET }} /> Invoices
          </div>
          <div className="mt-2 flex items-end gap-4">
            <div>
              <p className="text-2xl font-bold tracking-tight leading-none" style={{ color: NET }}>{invoiceCount}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Total</p>
            </div>
            <div className="h-8 w-px bg-border/70" />
            <div>
              <p className="text-2xl font-bold tracking-tight leading-none" style={{ color: OUTFLOW }}>{overdueInvoiceCount}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Overdue</p>
            </div>
          </div>
        </button>
        <InvoiceStat label="Accounts Payable" value={fmt(accountsPayable)} icon={CreditCard} color="hsl(347 77% 50%)" />
        <InvoiceStat label="Expense" value={fmt(totalExpenseDist)} icon={Receipt} color={OUTFLOW} />
        <BankBalanceCard accounts={bankAccounts} />
        <InvoiceStat label="Current Month Overdue" value={fmt(currentMonthOverdueAmount)} icon={CalendarClock} color={MARGIN} />
      </div>

      {/* Cash Flow — full-width hero chart */}
      <div
        className="rounded-2xl border border-border/60 shadow-sm overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(135deg, hsl(217 91% 60% / 0.28) 0%, hsl(217 91% 60% / 0.12) 45%, hsl(var(--card)) 100%)`,
        }}
      >
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
      <div
        className="rounded-2xl border border-border/60 shadow-sm overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(135deg, hsl(38 92% 50% / 0.28) 0%, hsl(160 84% 39% / 0.12) 45%, hsl(var(--card)) 100%)`,
        }}
      >
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

        {/* Recent Transactions — live activity feed */}
        <RecentTransactions />

        {/* Expense Distribution */}
        <ChartCard title="Expense Distribution" subtitle="By category" className="lg:col-span-2">
          {expenseDistribution.length === 0 ? <EmptyChart text="No categorized expenses found." /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Donut */}
              <div className="relative">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <defs>
                      {EXPENSE_PALETTE.map((c, i) => (
                        <linearGradient key={i} id={`expSlice${i}`} x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor={c} stopOpacity={1} />
                          <stop offset="100%" stopColor={c} stopOpacity={0.72} />
                        </linearGradient>
                      ))}
                    </defs>
                    <Pie
                      data={expenseDistribution}
                      cx="50%" cy="50%"
                      outerRadius={115} innerRadius={74}
                      paddingAngle={3}
                      cornerRadius={6}
                      dataKey="value"
                      stroke="hsl(var(--card))"
                      strokeWidth={3}
                    >
                      {expenseDistribution.map((_, i) => (
                        <Cell key={i} fill={`url(#expSlice${i % EXPENSE_PALETTE.length})`} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, n: string) => [fmt(v), n]}
                      contentStyle={{ borderRadius: "10px", border: "1px solid hsl(220, 13%, 91%)", fontSize: "12px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</span>
                  <span className="text-xl font-bold tracking-tight text-foreground">{fmt(totalExpenseDist)}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">{expenseDistribution.length} categories</span>
                </div>
              </div>

              {/* Legend list with share bars */}
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {expenseDistribution.map((d, i) => {
                  const share = totalExpenseDist ? (d.value / totalExpenseDist) * 100 : 0;
                  const color = EXPENSE_PALETTE[i % EXPENSE_PALETTE.length];
                  return (
                    <div key={d.name} className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-inset ring-white/40" style={{ backgroundColor: color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-foreground truncate">{d.name}</span>
                          <span className="text-xs font-semibold tabular-nums text-foreground">{fmt(d.value)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${share}%`, backgroundColor: color }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">{share.toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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

function InvoiceStat({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string;
}) {
  return (
    <div
      className="rounded-2xl border border-border/60 shadow-sm p-4"
      style={{ backgroundImage: `linear-gradient(135deg, ${color.replace(")", " / 0.18)")}, hsl(var(--card)))` }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight leading-none truncate" style={{ color }}>{value}</p>
    </div>
  );
}

// Bank Balance card: headline total + per-account breakdown for every COA
// account whose detail type is "Bank", so multiple bank accounts show separately.
function BankBalanceCard({ accounts }: { accounts: DashboardMetrics["bankAccounts"] }) {
  const color = INFLOW;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  return (
    <div
      className="rounded-2xl border border-border/60 shadow-sm p-4"
      style={{ backgroundImage: `linear-gradient(135deg, ${color.replace(")", " / 0.18)")}, hsl(var(--card)))` }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Landmark className="w-3.5 h-3.5" style={{ color }} /> Bank Balance
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight leading-none truncate" style={{ color }}>{fmt(total)}</p>
      {accounts.length > 0 ? (
        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2">
          {accounts.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-muted-foreground" title={`${a.code} · ${a.name}`}>{a.name}</span>
              <span className="font-semibold tabular-nums text-foreground whitespace-nowrap">{fmt(a.balance)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-muted-foreground">No bank accounts in the chart of accounts.</p>
      )}
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
