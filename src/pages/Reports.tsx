import { useState, useEffect, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, TrendingUp, DollarSign, BarChart3, Printer, ArrowLeft, Activity, Warehouse, Download, FileSpreadsheet, Scale, Link2, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { downloadReportPdf } from "@/lib/reportPdf";
import { downloadReportExcel } from "@/lib/reportExcel";
import { Button } from "@/components/ui/button";
import { useExpenses } from "@/hooks/useData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { buildScheduleBlocks, deriveFYWindow, fyLabel, type AssetMeta } from "@/lib/ppeSchedule";
import TrialBalance from "@/pages/TrialBalance";
import StatementOfComprehensiveIncome from "@/components/reports/StatementOfComprehensiveIncome";
import StatementOfFinancialPosition from "@/components/reports/StatementOfFinancialPosition";
import CashFlowStatement from "@/components/reports/CashFlowStatement";
import StatementOfChangesInEquity from "@/pages/reports/StatementOfChangesInEquity";
import { ReportMasthead, useReportCompany } from "@/components/reports/ReportMasthead";
import { formatDate } from "@/lib/format";

type ReportType = "trial-balance" | "pnl" | "balance-sheet" | "cash-flow" | "changes-in-equity" | "expense-summary" | "fixed-asset-schedule" | "ppe-schedule" | null;

const COLORS = ["hsl(215, 60%, 42%)", "hsl(142, 71%, 35%)", "hsl(38, 92%, 50%)", "hsl(199, 89%, 48%)", "hsl(0, 72%, 51%)", "hsl(270, 60%, 50%)"];

export default function Reports() {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reportParam = searchParams.get("report") as ReportType | null;

  const [activeReport, setActiveReport] = useState<ReportType>(null);
  const [periodFrom, setPeriodFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 12); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [periodTo, setPeriodTo] = useState(() => new Date().toISOString().slice(0, 10));

  // The five IFRS statements (Trial Balance, Income Statement, Balance Sheet,
  // Cash Flow, Changes in Equity) are self-contained pages with their own
  // date range, export, and print controls.
  const SELF_CONTAINED_REPORTS: ReportType[] = ["trial-balance", "pnl", "balance-sheet", "cash-flow", "changes-in-equity"];
  const isSelfContainedReport = activeReport != null && SELF_CONTAINED_REPORTS.includes(activeReport);

  useEffect(() => {
    if (reportParam && !activeReport) setActiveReport(reportParam);
  }, [reportParam]);

  const { data: expenses } = useExpenses();

  // Company identity for the masthead and the export headings — shared with
  // every other report so they cannot disagree.
  const { data: company } = useReportCompany();

  // Fixed Asset Schedule data
  const { data: assetScheduleData } = useQuery({
    queryKey: ["fixed_asset_schedule", appUser?.tenant_id, periodTo, periodFrom],
    enabled: !!appUser?.tenant_id && activeReport === "fixed-asset-schedule",
    queryFn: async () => {
      const { data: assets, error: aErr } = await supabase
        .from("fixed_assets")
        .select("id, asset_name, category_id, acquisition_date, cost, salvage_value, useful_life_months, status, accumulated_depreciation, asset_account_id")
        .eq("tenant_id", appUser!.tenant_id)
        .order("acquisition_date", { ascending: true });
      if (aErr) throw aErr;

      const periodYYYYMM = periodTo.slice(0, 7);
      const { data: depRows, error: dErr } = await supabase
        .from("asset_depreciation")
        .select("asset_id, period, depreciation_amount, accumulated_depreciation")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("status", "posted")
        .lte("period", periodYYYYMM)
        .order("period", { ascending: true });
      if (dErr) throw dErr;

      const { data: categories } = await supabase
        .from("asset_categories")
        .select("id, name")
        .eq("tenant_id", appUser!.tenant_id);

      const categoryMap = new Map((categories ?? []).map((c: any) => [c.id, c.name]));

      // Latest accumulated_depreciation per asset as at period end
      const depByAsset = new Map<string, number>();
      (depRows ?? []).forEach((row: any) => {
        if ((row.accumulated_depreciation ?? 0) > (depByAsset.get(row.asset_id) ?? 0)) {
          depByAsset.set(row.asset_id, row.accumulated_depreciation);
        }
      });

      // Depreciation charge within the selected period window
      const periodFromYYYYMM = periodFrom.slice(0, 7);
      const depInPeriodByAsset = new Map<string, number>();
      (depRows ?? []).forEach((row: any) => {
        if (row.period >= periodFromYYYYMM && row.period <= periodYYYYMM) {
          depInPeriodByAsset.set(row.asset_id, (depInPeriodByAsset.get(row.asset_id) ?? 0) + row.depreciation_amount);
        }
      });

      return (assets ?? []).map((asset: any) => {
        const accumDep = depByAsset.get(asset.id) ?? asset.accumulated_depreciation ?? 0;
        return {
          id: asset.id,
          asset_name: asset.asset_name,
          category: categoryMap.get(asset.category_id) ?? "—",
          acquisition_date: asset.acquisition_date,
          cost: asset.cost,
          salvage_value: asset.salvage_value ?? 0,
          useful_life_months: asset.useful_life_months ?? 0,
          accumulated_depreciation: accumDep,
          depreciation_in_period: depInPeriodByAsset.get(asset.id) ?? 0,
          net_book_value: asset.cost - accumDep,
          status: asset.status,
          depreciation_pct: asset.cost > 0 ? (accumDep / asset.cost) * 100 : 0,
        };
      });
    },
  });

  // PPE Schedule (Excel-style, per-fiscal-year depreciation) data
  const { data: ppeScheduleData } = useQuery({
    queryKey: ["ppe_schedule", appUser?.tenant_id, periodTo],
    enabled: !!appUser?.tenant_id && activeReport === "ppe-schedule",
    queryFn: async () => {
      const asOf = periodTo.slice(0, 7);

      const { data: assets, error: aErr } = await supabase
        .from("fixed_assets")
        // NB: no `supplier` column on fixed_assets — Supplier renders as "-".
        .select("id, asset_name, category_id, cost, salvage_value, acquisition_date, start_date, status, accumulated_depreciation, useful_life_months")
        .eq("tenant_id", appUser!.tenant_id)
        .order("acquisition_date", { ascending: true });
      if (aErr) throw aErr;

      const { data: depRows, error: dErr } = await supabase
        .from("asset_depreciation")
        .select("asset_id, period, depreciation_amount, accumulated_depreciation")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("status", "posted")
        .lte("period", asOf)
        .order("period", { ascending: true });
      if (dErr) throw dErr;

      const { data: categories } = await supabase
        .from("asset_categories")
        .select("id, name")
        .eq("tenant_id", appUser!.tenant_id);

      const { data: disposals } = await supabase
        .from("asset_disposals")
        .select("asset_id, disposal_date")
        .eq("tenant_id", appUser!.tenant_id);

      const postedRows = (depRows ?? []).map((r) => ({
        asset_id: r.asset_id,
        period: r.period,
        depreciation_amount: Number(r.depreciation_amount) || 0,
        accumulated_depreciation: Number(r.accumulated_depreciation) || 0,
      }));

      const fyStartYears = deriveFYWindow(postedRows.map((r) => r.period), asOf);

      const assetMeta: AssetMeta[] = (assets ?? []).map((a) => ({
        id: a.id,
        asset_name: a.asset_name,
        category_id: a.category_id,
        supplier: null,
        cost: Number(a.cost) || 0,
        salvage_value: Number(a.salvage_value) || 0,
        acquisition_date: a.acquisition_date,
        start_date: a.start_date,
        status: a.status,
        accumulated_depreciation: Number(a.accumulated_depreciation) || 0,
      }));

      const blocks = buildScheduleBlocks({
        assets: assetMeta,
        postedRows,
        categories: (categories ?? []).map((c) => ({ id: c.id, name: c.name })),
        disposals: (disposals ?? []).map((d) => ({ asset_id: d.asset_id, disposal_date: d.disposal_date })),
        fyStartYears,
      });

      // Effective depreciation rate for display only (12 / useful life) — never charge math.
      const rateMap = new Map<string, number>();
      (assets ?? []).forEach((a) => rateMap.set(a.id, Number(a.useful_life_months) || 0));

      const fyLabels = fyStartYears.map(fyLabel);
      const totals = {
        cost: blocks.reduce((s, b) => s + b.totals.cost, 0),
        fyCharges: fyLabels.map((_, i) => blocks.reduce((s, b) => s + (b.totals.fyCharges[i] ?? 0), 0)),
        accumulated: blocks.reduce((s, b) => s + b.totals.accumulated, 0),
        wdv: blocks.reduce((s, b) => s + b.totals.wdv, 0),
      };

      return {
        blocks,
        fyLabels,
        rateMap,
        hasAssets: (assets ?? []).length > 0,
        hasPosted: postedRows.length > 0,
        windowStartLabel: `${fyStartYears[0]}/04/01`,
        totals,
      };
    },
  });

  const reports: { id: ReportType; name: string; description: string; icon: any; category: string }[] = [
    { id: "trial-balance", name: "Trial Balance", description: "Verify total debits equal total credits across all accounts", icon: FileText, category: "Financial Statement" },
    { id: "pnl", name: "Income Statement", description: "Revenue, cost of goods sold, operating expenses, and net income", icon: TrendingUp, category: "Financial Statement" },
    { id: "balance-sheet", name: "Balance Sheet", description: "Statement of financial position — assets, liabilities, and equity, IAS 1 classified", icon: DollarSign, category: "Financial Statement" },
    { id: "changes-in-equity", name: "Changes in Equity", description: "Movement in stated capital and revenue reserves for the period", icon: Scale, category: "Financial Statement" },
    { id: "cash-flow", name: "Cash Flow Statement", description: "Operating, investing and financing cash flows — indirect method", icon: Activity, category: "Financial Statement" },
    { id: "expense-summary", name: "Expense Analysis", description: "Expense breakdown by category, status, and trends", icon: BarChart3, category: "Management" },
    { id: "fixed-asset-schedule", name: "Fixed Asset Schedule", description: "Property, plant & equipment — cost, accumulated depreciation and net book value by asset", icon: Warehouse, category: "Fixed Assets" },
    { id: "ppe-schedule", name: "PPE Schedule", description: "Property, plant & equipment by category with per-fiscal-year depreciation, accumulated depreciation and written-down value (IAS 16)", icon: Warehouse, category: "Fixed Assets" },
  ];

  // Reports that already live on their own page elsewhere — link out to them
  // instead of re-implementing a second, divergent version here.
  const externalReports = [
    { href: "/accounting/ar-aging", name: "Aged Receivables", description: "Outstanding customer invoices by aging bucket", icon: FileText, category: "Receivables & Payables" },
    { href: "/accounting/ap-aging", name: "Aged Payables", description: "Outstanding vendor bills by aging bucket", icon: FileText, category: "Receivables & Payables" },
    { href: "/reports/budget-vs-actual", name: "Budget vs Actual", description: "Variance analysis by account against the approved budget", icon: ClipboardList, category: "Management" },
    { href: "/accounting/statement-mapping", name: "Statement Mapping", description: "Map chart-of-accounts accounts onto Income Statement, Balance Sheet and Cash Flow lines", icon: Link2, category: "Setup" },
  ];

  const fmt = (n: number) => {
    const abs = Math.abs(n);
    const str = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `(LKR ${str})` : `LKR ${str}`;
  };

  // Every statement on this page uses the shared masthead, so the schedules
  // carry the same heading as the Trial Balance, General Ledger and account
  // registers.
  const StatementHeader = ({ title, subtitle, asAt }: { title: string; subtitle?: string; asAt?: boolean }) => (
    <ReportMasthead
      title={title}
      subtitle={subtitle}
      asAt={asAt ? periodTo : undefined}
      dateFrom={asAt ? undefined : periodFrom}
      dateTo={asAt ? undefined : periodTo}
      currency="LKR"
    />
  );

  const renderExpenseSummary = () => {
    const categorySummary = new Map<string, number>();
    const filteredExpenses = expenses?.filter(e => e.expense_date >= periodFrom && e.expense_date <= periodTo) || [];
    filteredExpenses.forEach(e => {
      const cat = (e.expense_categories as any)?.name || "Uncategorized";
      categorySummary.set(cat, (categorySummary.get(cat) || 0) + Number(e.amount));
    });
    const chartData = Array.from(categorySummary.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    const total = filteredExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const approved = filteredExpenses.filter(e => e.status === "approved").reduce((s, e) => s + Number(e.amount), 0);
    const pending = filteredExpenses.filter(e => e.status === "pending").reduce((s, e) => s + Number(e.amount), 0);
    const rejected = filteredExpenses.filter(e => e.status === "rejected").reduce((s, e) => s + Number(e.amount), 0);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:hidden">
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p><p className="text-xl font-bold text-foreground mt-1">{fmt(total)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Approved</p><p className="text-xl font-bold text-success mt-1">{fmt(approved)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Pending</p><p className="text-xl font-bold text-warning mt-1">{fmt(pending)}</p></div>
          <div className="stat-card"><p className="text-xs text-muted-foreground uppercase tracking-wide">Rejected</p><p className="text-xl font-bold text-destructive mt-1">{fmt(rejected)}</p></div>
        </div>
        {chartData.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print:hidden">
            <div className="stat-card">
              <h3 className="text-sm font-medium text-foreground mb-4">By Category</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `LKR ${v.toLocaleString()}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={120} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="stat-card">
              <h3 className="text-sm font-medium text-foreground mb-4">Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={chartData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="amount" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="stat-card print:hidden"><p className="text-center py-12 text-muted-foreground">No expenses found for this period.</p></div>
        )}

        <div className="stat-card print:shadow-none">
          <StatementHeader title="Expense Analysis" subtitle="Expenses by category" />
          {chartData.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No expenses found for this period.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="text-right w-40">Amount</th>
                  <th className="text-right w-28">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((d) => (
                  <tr key={d.name}>
                    <td className="font-medium text-foreground">{d.name}</td>
                    <td className="text-right font-mono">{fmt(d.amount)}</td>
                    <td className="text-right font-mono text-muted-foreground">{total > 0 ? ((d.amount / total) * 100).toFixed(1) : "0.0"}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-foreground/20">
                  <td>Total Expenses</td>
                  <td className="text-right font-mono">{fmt(total)}</td>
                  <td className="text-right font-mono">100.0%</td>
                </tr>
                <tr className="text-sm">
                  <td className="text-muted-foreground italic" colSpan={3}>
                    Approved {fmt(approved)} · Pending {fmt(pending)} · Rejected {fmt(rejected)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderFixedAssetSchedule = () => {
    const rows = assetScheduleData ?? [];
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalAccumDep = rows.reduce((s, r) => s + r.accumulated_depreciation, 0);
    const totalDepInPeriod = rows.reduce((s, r) => s + r.depreciation_in_period, 0);
    const totalNBV = rows.reduce((s, r) => s + r.net_book_value, 0);

    const grouped = new Map<string, typeof rows>();
    rows.forEach(r => {
      if (!grouped.has(r.category)) grouped.set(r.category, []);
      grouped.get(r.category)!.push(r);
    });

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:hidden">
          {[
            { label: "Total Cost", value: totalCost, cls: "text-foreground" },
            { label: "Accum. Depreciation", value: totalAccumDep, cls: "text-destructive" },
            { label: "Period Charge", value: totalDepInPeriod, cls: "text-muted-foreground" },
            { label: "Net Book Value", value: totalNBV, cls: "text-primary" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-xl font-bold mt-1 ${cls}`}>{fmt(value)}</p>
            </div>
          ))}
        </div>

        <div className="stat-card print:shadow-none">
          <StatementHeader title="Fixed Asset Schedule" subtitle="Property, Plant & Equipment" />

          {rows.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">
              No assets found. Add assets and run depreciation to populate this report.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset Name</th>
                  <th>Category</th>
                  <th className="text-right w-28">Acq. Date</th>
                  <th className="text-right w-32">Cost</th>
                  <th className="text-right w-36">Accum. Depr.</th>
                  <th className="text-right w-32">Period Charge</th>
                  <th className="text-right w-32">Net Book Value</th>
                  <th className="w-24">% Depr.</th>
                  <th className="w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(grouped.entries()).map(([category, assets]) => {
                  const catCost = assets.reduce((s, a) => s + a.cost, 0);
                  const catAccum = assets.reduce((s, a) => s + a.accumulated_depreciation, 0);
                  const catPeriod = assets.reduce((s, a) => s + a.depreciation_in_period, 0);
                  const catNBV = assets.reduce((s, a) => s + a.net_book_value, 0);
                  return (
                    <Fragment key={category}>
                      <tr className="bg-muted/40">
                        <td colSpan={9} className="font-semibold text-foreground pl-2 py-1.5 text-sm">
                          {category}
                        </td>
                      </tr>
                      {assets.map(asset => (
                        <tr key={asset.id}>
                          <td className="pl-6 font-medium text-foreground">{asset.asset_name}</td>
                          <td className="text-muted-foreground text-xs">{asset.category}</td>
                          <td className="text-right font-mono text-xs text-muted-foreground">
                            {asset.acquisition_date ? formatDate(asset.acquisition_date) : "—"}
                          </td>
                          <td className="text-right font-mono">{fmt(asset.cost)}</td>
                          <td className="text-right font-mono text-destructive/80">{fmt(asset.accumulated_depreciation)}</td>
                          <td className="text-right font-mono text-muted-foreground">
                            {asset.depreciation_in_period > 0 ? fmt(asset.depreciation_in_period) : "—"}
                          </td>
                          <td className="text-right font-mono font-semibold">{fmt(asset.net_book_value)}</td>
                          <td>
                            <div className="flex items-center gap-1 justify-end">
                              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${Math.min(asset.depreciation_pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">{asset.depreciation_pct.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              asset.status === "active"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-muted text-muted-foreground"
                            }`}>
                              {asset.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      <tr key={`subtotal-${category}`} className="border-t border-border/50 bg-muted/20">
                        <td colSpan={3} className="pl-6 text-sm text-muted-foreground italic">Subtotal — {category}</td>
                        <td className="text-right font-mono font-semibold">{fmt(catCost)}</td>
                        <td className="text-right font-mono font-semibold text-destructive/80">{fmt(catAccum)}</td>
                        <td className="text-right font-mono font-semibold text-muted-foreground">{fmt(catPeriod)}</td>
                        <td className="text-right font-mono font-semibold">{fmt(catNBV)}</td>
                        <td colSpan={2} />
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-foreground/30 bg-primary/5">
                  <td colSpan={3} className="text-foreground">Grand Total</td>
                  <td className="text-right font-mono">{fmt(totalCost)}</td>
                  <td className="text-right font-mono text-destructive">{fmt(totalAccumDep)}</td>
                  <td className="text-right font-mono text-muted-foreground">{fmt(totalDepInPeriod)}</td>
                  <td className="text-right font-mono">{fmt(totalNBV)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderPpeSchedule = () => {
    const data = ppeScheduleData;
    if (!data) {
      return (
        <div className="stat-card print:shadow-none">
          <StatementHeader title="PPE Schedule" subtitle="Property, Plant & Equipment (IAS 16)" />
          <p className="text-center py-12 text-muted-foreground">Loading…</p>
        </div>
      );
    }
    const { blocks, fyLabels, rateMap, hasAssets, hasPosted, windowStartLabel, totals } = data;
    const colCount = 6 + fyLabels.length;
    const num = (v: number) => (v === 0 ? "-" : fmt(v));
    const rateOf = (id: string) => {
      const m = rateMap.get(id);
      return m && m > 0 ? `${((12 / m) * 100).toFixed(1)}%` : "-";
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:hidden">
          {[
            { label: "Total Cost", value: totals.cost, cls: "text-foreground" },
            { label: "Accumulated Depreciation", value: totals.accumulated, cls: "text-destructive" },
            { label: "Net Book Value", value: totals.wdv, cls: "text-primary" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="stat-card">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-xl font-bold mt-1 ${cls}`}>{fmt(value)}</p>
            </div>
          ))}
        </div>

        <div className="stat-card print:shadow-none">
          <StatementHeader title="PPE Schedule" subtitle="Property, Plant & Equipment (IAS 16)" />

          {!hasAssets ? (
            <p className="text-center py-12 text-muted-foreground">
              No assets found. Add assets and run depreciation to populate this schedule.
            </p>
          ) : (
            <>
              {!hasPosted && (
                <p className="text-xs text-muted-foreground italic text-center mb-3">
                  No posted depreciation in this period yet.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-card text-left">Category / item</th>
                      <th className="text-left">Supplier</th>
                      <th className="text-right w-32">Cost</th>
                      <th className="text-right w-20">Dep. rate</th>
                      {fyLabels.map((l) => (
                        <th key={l} className="text-right w-28">{l}</th>
                      ))}
                      <th className="text-right w-36">Acc. depreciation</th>
                      <th className="text-right w-32">W D V</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocks.map((block) => (
                      <Fragment key={block.category}>
                        <tr className="bg-secondary">
                          <td colSpan={colCount} className="sticky left-0 bg-secondary font-medium text-secondary-foreground py-1.5 px-2 text-sm">
                            {block.category}
                          </td>
                        </tr>

                        {block.openingRow && (
                          <tr className="italic text-muted-foreground">
                            <td className="sticky left-0 bg-card pl-6">
                              Opening value as at {windowStartLabel}
                              {block.openingRow.openingEstimated && (
                                <span
                                  title="Opening accumulated depreciation taken from asset record; no posted history before this period"
                                  className="ml-2 not-italic inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground"
                                >
                                  estimated
                                </span>
                              )}
                            </td>
                            <td className="bg-card">-</td>
                            <td className="text-right font-mono bg-card">{num(block.openingRow.cost)}</td>
                            <td className="text-right font-mono bg-card">-</td>
                            {block.openingRow.fyCharges.map((c, i) => (
                              <td key={i} className="text-right font-mono bg-card">{num(c)}</td>
                            ))}
                            <td className="text-right font-mono bg-card">{num(block.openingRow.accumulated)}</td>
                            <td className="text-right font-mono bg-card">{num(block.openingRow.wdv)}</td>
                          </tr>
                        )}

                        {block.rows.map((r) => (
                          <tr key={r.id}>
                            <td className="sticky left-0 bg-card pl-6 font-medium text-foreground">
                              {r.asset_name}
                              {r.disposed && (
                                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                                  Disposed{r.disposalDate ? ` (${r.disposalDate})` : ""}
                                </span>
                              )}
                            </td>
                            <td className="text-muted-foreground text-xs">{r.supplier ?? "-"}</td>
                            <td className="text-right font-mono">{num(r.cost)}</td>
                            <td className="text-right font-mono text-muted-foreground">{rateOf(r.id)}</td>
                            {r.fyCharges.map((c, i) => (
                              <td key={i} className="text-right font-mono text-muted-foreground">{num(c)}</td>
                            ))}
                            <td className="text-right font-mono text-destructive/80">{num(r.accumulated)}</td>
                            <td className={`text-right font-mono font-semibold ${r.disposed ? "text-muted-foreground line-through" : ""}`}>
                              {r.disposed ? "-" : num(r.wdv)}
                            </td>
                          </tr>
                        ))}

                        <tr className="font-bold bg-muted border-t border-border/50">
                          <td className="sticky left-0 bg-muted text-foreground pl-2">Total — {block.category}</td>
                          <td className="bg-muted" />
                          <td className="text-right font-mono">{num(block.totals.cost)}</td>
                          <td className="bg-muted" />
                          {block.totals.fyCharges.map((c, i) => (
                            <td key={i} className="text-right font-mono">{num(c)}</td>
                          ))}
                          <td className="text-right font-mono text-destructive">{num(block.totals.accumulated)}</td>
                          <td className="text-right font-mono">{num(block.totals.wdv)}</td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t-2 border-foreground/30 bg-muted">
                      <td className="sticky left-0 bg-muted text-foreground">Grand total</td>
                      <td className="bg-muted" />
                      <td className="text-right font-mono">{num(totals.cost)}</td>
                      <td className="bg-muted" />
                      {totals.fyCharges.map((c, i) => (
                        <td key={i} className="text-right font-mono">{num(c)}</td>
                      ))}
                      <td className="text-right font-mono text-destructive">{num(totals.accumulated)}</td>
                      <td className="text-right font-mono">{num(totals.wdv)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderReport = () => {
    switch (activeReport) {
      case "trial-balance": return <TrialBalance />;
      case "pnl": return <StatementOfComprehensiveIncome />;
      case "balance-sheet": return <StatementOfFinancialPosition />;
      case "cash-flow": return <CashFlowStatement />;
      case "changes-in-equity": return <StatementOfChangesInEquity />;
      case "expense-summary": return renderExpenseSummary();
      case "fixed-asset-schedule": return renderFixedAssetSchedule();
      case "ppe-schedule": return renderPpeSchedule();
      default: return null;
    }
  };

  // Print with a document title that becomes the suggested PDF filename,
  // e.g. "Acme (Pvt) Ltd — Expense Analysis 2026-07-05".
  const handlePrint = () => {
    const reportName = reports.find(r => r.id === activeReport)?.name ?? "Report";
    const previousTitle = document.title;
    document.title = `${company?.company_name ? `${company.company_name} — ` : ""}${reportName} ${periodTo}`;
    window.print();
    document.title = previousTitle;
  };

  // The remaining reports on the generic export path (Expense Analysis, the
  // fixed-asset schedules) are all period-range, not "as at" — the five IFRS
  // statements carry their own export controls via SELF_CONTAINED_REPORTS.
  const REPORT_SUBTITLES: Partial<Record<Exclude<ReportType, null>, string>> = {
    "expense-summary": "Expenses by category",
    "fixed-asset-schedule": "Property, Plant & Equipment",
    "ppe-schedule": "Property, Plant & Equipment (IAS 16)",
  };

  // Shared heading/identity metadata for the PDF and Excel exports.
  const exportMeta = (extension: "pdf" | "xlsx") => {
    if (!activeReport) return null;
    const reportName = reports.find(r => r.id === activeReport)?.name ?? "Report";
    const dateLine = `For the period ${formatDate(periodFrom)} — ${formatDate(periodTo)}`;
    return {
      companyName: company?.company_name,
      address: company?.address,
      phone: company?.phone,
      taxId: company?.tax_id,
      registrationNumber: company?.registration_number,
      title: reportName,
      subtitle: REPORT_SUBTITLES[activeReport],
      dateLine,
      preparedBy: [appUser?.first_name, appUser?.last_name].filter(Boolean).join(" "),
      fileName: `${company?.company_name ? `${company.company_name} — ` : ""}${reportName} ${periodTo}.${extension}`,
    };
  };

  const NO_DATA = "Nothing to download — this report has no data for the selected period.";

  // Vector PDF built from the rendered statement table(s).
  const handleDownloadPdf = () => {
    const container = document.getElementById("financial-report-doc");
    const meta = exportMeta("pdf");
    if (!container || !meta) return;
    if (!downloadReportPdf(container, meta)) toast.error(NO_DATA);
  };

  // Workbook built from the same rendered table(s), with amounts as numbers.
  const handleDownloadExcel = () => {
    const container = document.getElementById("financial-report-doc");
    const meta = exportMeta("xlsx");
    if (!container || !meta) return;
    if (!downloadReportExcel(container, { ...meta, sheetName: meta.title }, "table.data-table")) {
      toast.error(NO_DATA);
    }
  };

  const categories = Array.from(new Set([...reports.map(r => r.category), ...externalReports.map(r => r.category)]));

  return (
    <div className="space-y-6">
      <div className="page-header print:hidden">
        <div>
          <h1 className="page-title">Financial Reports</h1>
          <p className="page-description">Generate and analyze financial statements and management reports</p>
        </div>
        <div className="flex items-center gap-2">
          {activeReport && (
            <>
              {/* Self-contained reports (the five IFRS statements) bring their
                  own date range, export, and print controls — the generic
                  ones here would duplicate and could disagree with them. */}
              {!isSelfContainedReport && (
                <>
                  <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="print:hidden">
                    <Download className="w-4 h-4 mr-1" /> Download PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownloadExcel} className="print:hidden">
                    <FileSpreadsheet className="w-4 h-4 mr-1" /> Download Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={handlePrint} className="print:hidden">
                    <Printer className="w-4 h-4 mr-1" /> Print
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => setActiveReport(null)} className="print:hidden">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Period selector */}
      {!isSelfContainedReport && activeReport && (
      <div className="flex items-center gap-3 print:hidden">
        <label className="text-sm text-muted-foreground">Period:</label>
        <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} className="text-sm border rounded-md px-3 py-1.5 bg-card text-foreground" />
        <span className="text-muted-foreground">to</span>
        <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} className="text-sm border rounded-md px-3 py-1.5 bg-card text-foreground" />
      </div>
      )}

      {!activeReport ? (
        <div className="space-y-8">
          {categories.map((category) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{category}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {reports.filter(r => r.category === category).map((report) => (
                  <div
                    key={report.id}
                    className="stat-card flex flex-col gap-3 cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all group"
                    onClick={() => setActiveReport(report.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                        <report.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground">{report.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{report.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end">
                      <Button variant="ghost" size="sm" className="text-xs">Generate →</Button>
                    </div>
                  </div>
                ))}
                {externalReports.filter(r => r.category === category).map((report) => (
                  <div
                    key={report.href}
                    className="stat-card flex flex-col gap-3 cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all group"
                    onClick={() => navigate(report.href)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0 group-hover:bg-secondary/80 transition-colors">
                        <report.icon className="w-5 h-5 text-secondary-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground">{report.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{report.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end">
                      <Button variant="ghost" size="sm" className="text-xs">Open →</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div id="financial-report-doc">{renderReport()}</div>
      )}
    </div>
  );
}
