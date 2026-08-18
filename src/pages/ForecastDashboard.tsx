import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import {
  useFinancialForecasts,
  useForecastJobs,
} from "@/hooks/useCashflowForecast";
import {
  useScenarios,
  useSimulateScenario,
  useDeleteScenario,
  useForecastInsights,
  type SimulateResult,
  type StructuredInsights,
  type StructuredInsightItem,
} from "@/hooks/useScenarios";
import {
  useRunValidation,
  useRunBacktest,
  type ForecastValidation,
  type ValidationSummary,
  type ForecastAccuracy,
} from "@/hooks/useForecastQuality";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, BarChart, Bar, Cell,
} from "recharts";
import {
  Brain, TrendingUp, TrendingDown, DollarSign, Clock, Loader2,
  Plus, Trash2, Sparkles, AlertTriangle, Lightbulb, Activity,
} from "lucide-react";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";
import { formatDate, formatDateTick, formatDateTime } from "@/lib/format";

export default function ForecastDashboard() {
  const { appUser } = useAuth();
  const tenantId = appUser?.tenant_id;

  const { data: cashFc = [], isLoading: loadingCash } = useFinancialForecasts("cash");
  const { data: revFc = [] } = useFinancialForecasts("revenue");
  const { data: expFc = [] } = useFinancialForecasts("expense");
  const { data: jobs = [] } = useForecastJobs();

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6 overflow-y-auto flex-1">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-medium text-primary mb-1">Intelligence Hub → Forecasting</p>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" /> Advanced Financial Forecasting
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Multi-stage statistical forecasts with confidence bands, category breakdowns,
            and scenario simulation.
          </p>
        </div>
        {jobs[0] && (
          <Badge variant="outline" className="gap-1.5">
            <Activity className="w-3 h-3" />
            Last run {formatDateTime(jobs[0].run_time)} · {jobs[0].status}
          </Badge>
        )}
      </header>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <CashForecastChart data={cashFc} loading={loadingCash} />
        </TabsContent>

        <TabsContent value="categories">
          <CategoryBreakdown revenue={revFc} expense={expFc} />
        </TabsContent>

        <TabsContent value="scenarios">
          <ScenariosTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="quality">
          <QualityTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="insights">
          <InsightsTab tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────────────────────  CASH OVERVIEW  ───────────────────────────── */
function CashForecastChart({ data, loading }: { data: Array<{ period: string; forecast_value: number; lower_bound: number; upper_bound: number }>; loading: boolean }) {
  const chartData = useMemo(() => data.map((d) => ({
    label: formatDateTick(d.period),
    forecast: Number(d.forecast_value),
    lower: Number(d.lower_bound),
    upper: Number(d.upper_bound),
    band: Number(d.upper_bound) - Number(d.lower_bound),
  })), [data]);

  const last = data[data.length - 1];
  const first = data[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <KpiCard icon={<DollarSign className="w-4 h-4" />} label="Projected end-of-horizon cash"
        value={formatCurrencyShort(Number(last?.forecast_value ?? 0))} />
      <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Forecast horizon"
        value={`${data.length} days`} />
      <KpiCard icon={<TrendingDown className="w-4 h-4" />} label="Lower bound (95% CI)"
        value={formatCurrencyShort(Number(last?.lower_bound ?? 0))} />
      <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Upper bound (95% CI)"
        value={formatCurrencyShort(Number(last?.upper_bound ?? 0))} />

      <Card className="lg:col-span-4">
        <CardHeader>
          <CardTitle className="text-base">Cash Balance Forecast with Confidence Bands</CardTitle>
          <CardDescription>
            {first && last && `${formatDateTick(first.period)} → ${formatDate(last.period)}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              No forecast data yet. The forecasting engine runs daily at 02:00 UTC.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id="ci" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12, backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number) => formatCurrency(v)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="lower" stroke="none" fill="url(#ci)" name="Lower bound" />
                <Area type="monotone" dataKey="upper" stroke="none" fill="url(#ci)" name="Upper bound" />
                <Line type="monotone" dataKey="forecast" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} name="Forecast" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────────  CATEGORIES  ───────────────────────────── */
function CategoryBreakdown({
  revenue, expense,
}: {
  revenue: Array<{ category_name: string; forecast_value: number }>;
  expense: Array<{ category_name: string; forecast_value: number }>;
}) {
  const top = (rows: typeof revenue) => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.category_name, (map.get(r.category_name) ?? 0) + Number(r.forecast_value));
    return Array.from(map.entries())
      .map(([name, total]) => ({ name, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total).slice(0, 8);
  };
  const revTop = top(revenue);
  const expTop = top(expense);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <CategoryCard title="Revenue Forecast by Category" data={revTop} color="hsl(160, 84%, 39%)" />
      <CategoryCard title="Expense Forecast by Category" data={expTop} color="hsl(0, 84%, 60%)" />
    </div>
  );
}

function CategoryCard({ title, data, color }: { title: string; data: Array<{ name: string; total: number }>; color: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No category-level forecasts available.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={140} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="total" radius={[0, 6, 6, 0]}>
                {data.map((_, i) => <Cell key={i} fill={color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────  SCENARIOS  ───────────────────────────── */
function ScenariosTab({ tenantId }: { tenantId?: string }) {
  const { data: scenarios = [] } = useScenarios();
  const simulate = useSimulateScenario();
  const remove = useDeleteScenario();

  const [form, setForm] = useState({
    name: "",
    description: "",
    horizon_months: 12,
    revenue_uplift_pct: 0,
    expense_reduction_pct: 0,
    capital_injection: 0,
    one_time_investment: 0,
  });
  const [preview, setPreview] = useState<SimulateResult | null>(null);

  const runSim = async (persist: boolean) => {
    if (!tenantId) return toast.error("No tenant context");
    if (persist && !form.name.trim()) return toast.error("Name your scenario before saving");
    try {
      const result = await simulate.mutateAsync({ tenant_id: tenantId, persist, ...form });
      setPreview(result);
      toast.success(persist ? "Scenario saved" : "Simulation complete");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {/* Inputs */}
      <Card className="xl:col-span-1">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> What-if scenario
          </CardTitle>
          <CardDescription>Adjust assumptions and simulate ROI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Scenario name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q3 Marketing Push" />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label={`Horizon: ${form.horizon_months} months`}>
            <Slider min={1} max={24} step={1} value={[form.horizon_months]} onValueChange={([v]) => setForm({ ...form, horizon_months: v })} />
          </Field>
          <Field label={`Revenue uplift: ${form.revenue_uplift_pct}%`}>
            <Slider min={-50} max={100} step={1} value={[form.revenue_uplift_pct]} onValueChange={([v]) => setForm({ ...form, revenue_uplift_pct: v })} />
          </Field>
          <Field label={`Expense reduction: ${form.expense_reduction_pct}%`}>
            <Slider min={-50} max={50} step={1} value={[form.expense_reduction_pct]} onValueChange={([v]) => setForm({ ...form, expense_reduction_pct: v })} />
          </Field>
          <Field label="Capital injection (LKR)">
            <Input type="number" value={form.capital_injection} onChange={(e) => setForm({ ...form, capital_injection: Number(e.target.value) })} />
          </Field>
          <Field label="One-time investment (LKR)">
            <Input type="number" value={form.one_time_investment} onChange={(e) => setForm({ ...form, one_time_investment: Number(e.target.value) })} />
          </Field>
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => runSim(false)} disabled={simulate.isPending}>
              {simulate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simulate"}
            </Button>
            <Button size="sm" className="flex-1 gap-1.5" onClick={() => runSim(true)} disabled={simulate.isPending}>
              <Plus className="w-3.5 h-3.5" /> Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Result preview + saved list */}
      <div className="xl:col-span-2 space-y-5">
        {preview && <ScenarioResult result={preview} />}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved scenarios</CardTitle>
            <CardDescription>Compare outcomes of stored what-if models.</CardDescription>
          </CardHeader>
          <CardContent>
            {scenarios.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No scenarios yet. Build and save one on the left.</p>
            ) : (
              <div className="space-y-2">
                {scenarios.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{s.name}</div>
                      <div className="text-xs text-muted-foreground flex gap-3 flex-wrap mt-0.5">
                        <span>+{s.revenue_uplift_pct}% rev</span>
                        <span>-{s.expense_reduction_pct}% exp</span>
                        <span>{s.horizon_months}mo</span>
                        <span>ROI {Number(s.roi_pct).toFixed(1)}%</span>
                        {s.payback_months != null && <span>Payback {s.payback_months}mo</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={Number(s.projected_profit) >= 0 ? "default" : "destructive"}>
                        {formatCurrencyShort(Number(s.projected_profit))}
                      </Badge>
                      <Button size="icon" variant="ghost" onClick={() => remove.mutate(s.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ScenarioResult({ result }: { result: SimulateResult }) {
  const data = result.series.map((s) => ({
    month: s.month,
    "Baseline cash": s.baseline_cash,
    "Projected cash": s.projected_cash,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Simulation result</CardTitle>
        <CardDescription>Baseline vs projected cash over {result.horizon_months} months.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricBox icon={<DollarSign className="w-4 h-4" />} label="Projected profit" value={formatCurrencyShort(result.projected_profit)} positive={result.projected_profit >= 0} />
          <MetricBox icon={<TrendingUp className="w-4 h-4" />} label="Profit delta" value={formatCurrencyShort(result.profit_delta)} positive={result.profit_delta >= 0} />
          <MetricBox icon={<Sparkles className="w-4 h-4" />} label="ROI" value={`${result.roi_pct.toFixed(1)}%`} positive={result.roi_pct >= 0} />
          <MetricBox icon={<Clock className="w-4 h-4" />} label="Payback" value={result.payback_months != null ? `${result.payback_months} mo` : "—"} positive={!!result.payback_months} />
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="Baseline cash" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            <Line type="monotone" dataKey="Projected cash" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────  QUALITY (Validation + Backtest)  ───────────────────────────── */
function QualityTab({ tenantId }: { tenantId?: string }) {
  const validation = useRunValidation(tenantId);
  const backtest = useRunBacktest(tenantId);
  const [checks, setChecks] = useState<ForecastValidation[]>([]);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [accuracy, setAccuracy] = useState<ForecastAccuracy[]>([]);
  const [overall, setOverall] = useState<{ mape: number | null; rmse: number | null } | null>(null);

  const runValidation = async () => {
    try {
      const res = await validation.mutateAsync();
      setChecks(res.checks);
      setSummary(res.summary);
      toast.success(`${res.summary.pass}/${res.summary.total} checks passed`);
    } catch (e) { toast.error((e as Error).message); }
  };
  const runBacktest = async () => {
    try {
      const res = await backtest.mutateAsync();
      setAccuracy(res.results);
      setOverall({ mape: res.overall_mape, rmse: res.overall_rmse });
      toast.success(`Backtested ${res.categories_evaluated} categories`);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">Financial Validation</CardTitle>
            <CardDescription>Accounting integrity & sanity checks for the latest forecast run.</CardDescription>
          </div>
          <Button size="sm" onClick={runValidation} disabled={validation.isPending} className="gap-1.5">
            {validation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            Run
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {summary && (
            <div className="flex gap-2 text-xs">
              <Badge variant="outline">Total {summary.total}</Badge>
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Pass {summary.pass}</Badge>
              {summary.warning > 0 && <Badge variant="secondary">Warn {summary.warning}</Badge>}
              {summary.fail > 0 && <Badge variant="destructive">Fail {summary.fail}</Badge>}
            </div>
          )}
          {checks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No validation results yet. Click Run.</p>
          ) : (
            <div className="space-y-2">
              {checks.map((c, i) => (
                <div key={i} className="p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2">
                    <Badge variant={c.status === "pass" ? "outline" : c.status === "fail" ? "destructive" : "secondary"} className="text-[10px]">
                      {c.status}
                    </Badge>
                    <span className="text-sm font-medium">{c.check_name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{c.message}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">Backtest Accuracy</CardTitle>
            <CardDescription>Walk-forward MAPE & RMSE on a 14-day holdout window.</CardDescription>
          </div>
          <Button size="sm" onClick={runBacktest} disabled={backtest.isPending} className="gap-1.5">
            {backtest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
            Run
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {overall && (
            <div className="grid grid-cols-2 gap-2">
              <MetricBox icon={<Activity className="w-4 h-4" />} label="Overall MAPE" value={overall.mape != null ? `${overall.mape.toFixed(1)}%` : "—"} positive={(overall.mape ?? 100) < 25} />
              <MetricBox icon={<Activity className="w-4 h-4" />} label="Overall RMSE" value={overall.rmse != null ? formatCurrencyShort(overall.rmse) : "—"} positive={true} />
            </div>
          )}
          {accuracy.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No backtest yet. Click Run.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {accuracy.map((a) => (
                <div key={a.id ?? `${a.category_name}-${a.stream}`} className="flex items-center justify-between p-2 rounded border bg-card text-xs">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.category_name}</div>
                    <div className="text-muted-foreground">{a.stream} · n={a.data_points}</div>
                  </div>
                  <div className="flex gap-3 text-right">
                    <span>MAPE <span className="font-semibold">{Number(a.mape).toFixed(1)}%</span></span>
                    <span>RMSE <span className="font-semibold">{formatCurrencyShort(Number(a.rmse))}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────────  AI INSIGHTS (structured)  ───────────────────────────── */
function InsightsTab({ tenantId }: { tenantId?: string }) {
  const insights = useForecastInsights(tenantId);
  const [data, setData] = useState<StructuredInsights | null>(null);

  const generate = async () => {
    try {
      const res = await insights.mutateAsync();
      setData(res);
      const total = res.risks.length + res.opportunities.length + res.recommended_actions.length;
      toast.success(`Generated ${total} insights`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" /> AI Forecast Insights
          </CardTitle>
          <CardDescription>Lovable AI analyzes your forecasts and surfaces actionable findings.</CardDescription>
        </div>
        <Button size="sm" onClick={generate} disabled={insights.isPending} className="gap-1.5">
          {insights.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Generate
        </Button>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Click <span className="font-medium">Generate</span> to analyze your forecast data.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <InsightColumn title="Risks" icon={<AlertTriangle className="w-4 h-4 text-red-600" />} items={data.risks} tone="risk" />
            <InsightColumn title="Opportunities" icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} items={data.opportunities} tone="opp" />
            <InsightColumn title="Recommended Actions" icon={<Lightbulb className="w-4 h-4 text-primary" />} items={data.recommended_actions} tone="action" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InsightColumn({ title, icon, items, tone }: { title: string; icon: React.ReactNode; items: StructuredInsightItem[]; tone: "risk" | "opp" | "action" }) {
  const toneClass =
    tone === "risk" ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900" :
    tone === "opp" ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" :
    "bg-primary/5 border-primary/20";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None identified.</p>
      ) : items.map((i, idx) => (
        <div key={idx} className={`p-3 rounded-lg border ${toneClass}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold">{i.title}</h4>
            {(i.severity || i.impact) && (
              <Badge variant="outline" className="text-[10px]">{i.severity ?? i.impact}</Badge>
            )}
            {i.owner && <Badge variant="secondary" className="text-[10px]">{i.owner}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{i.detail}</p>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────  PRIMITIVES  ───────────────────────────── */
function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">{icon}{label}</div>
        <div className="text-xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function MetricBox({ icon, label, value, positive }: { icon: React.ReactNode; label: string; value: string; positive: boolean }) {
  return (
    <div className="p-3 rounded-lg border bg-card">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{label}</div>
      <div className={`text-base font-bold ${positive ? "text-emerald-600" : "text-red-600"}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
