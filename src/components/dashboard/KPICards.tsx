import { useState, useMemo } from "react";
import {
  TrendingUp, TrendingDown, DollarSign, Percent, BarChart3,
  Wallet, ShieldCheck, Activity, ArrowUpRight, ArrowDownRight,
  Layers, Gauge, Coins, Target, Clock, Zap,
  Settings2, X, Pin, PinOff, Check, CheckCircle2, AlertTriangle,
  Users, Repeat, Banknote, Scale, PieChart, Receipt, Fuel,
} from "lucide-react";
import { formatCurrencyShort } from "@/lib/currency";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";
import { useKpiPreferences } from "@/hooks/useKpiPreferences";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Accounting presentation: a negative amount is parenthesised, never stripped of
// its sign — `formatCurrencyShort` is shared with the rest of the app.
const fmt = (n: number) => formatCurrencyShort(n);
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const ratio = (n: number) => n.toFixed(2);
const days = (n: number) => `${Math.round(n)} days`;
const months = (n: number) => (!isFinite(n) ? "∞" : `${n.toFixed(1)} mo`);
const safeDiv = (n: number, d: number) => (d !== 0 ? n / d : 0);

/**
 * Whether the figure is measured against a target at all.
 *
 * "neutral" is the honest answer for descriptive magnitudes — total inflows,
 * turnover ratios — where there is no such thing as a good or bad reading, so
 * they get no success/danger cue rather than a decorative one.
 */
export type KpiStatus = "good" | "bad" | "neutral";

const bySign = (n: number): KpiStatus => (n >= 0 ? "good" : "bad");
const byTarget = (ok: boolean): KpiStatus => (ok ? "good" : "bad");

export interface KPIItem {
  key: string;
  label: string;
  value: string;
  formula: string;
  icon: React.ElementType;
  status: KpiStatus;
  /** The target the status was judged against, shown next to the cue. */
  benchmark?: string;
  category: string;
  color: string;
}

const KPI_COLORS: Record<string, string> = {
  "Profitability": "hsl(160, 84%, 39%)",
  "Liquidity": "hsl(217, 91%, 60%)",
  "Investment": "hsl(280, 65%, 60%)",
  "Efficiency": "hsl(38, 92%, 50%)",
  "Cash Flow": "hsl(199, 89%, 48%)",
  "Solvency": "hsl(347, 77%, 50%)",
  "Budget": "hsl(24, 95%, 53%)",
};

function buildAllKPIs(m: DashboardMetrics): KPIItem[] {
  // Turnover ratios are annualized & use average balances (computed in the hook).
  const payablePeriod = m.apTurnover ? 365 / m.apTurnover : 0;
  const debtToEquity = safeDiv(m.totalLiabilities, m.equity);
  const debtRatio = safeDiv(m.totalLiabilities, m.totalAssets);
  const equityRatio = safeDiv(m.equity, m.totalAssets);
  const C = KPI_COLORS;
  return [
    { key: "total_revenue", label: "Total Revenue", value: fmt(m.totalRevenue), formula: "Sum of revenue accounts", icon: Coins, status: "neutral", category: "Profitability", color: C["Profitability"] },
    { key: "gross_profit", label: "Gross Profit", value: fmt(m.grossProfit), formula: "Revenue \u2212 COGS", icon: TrendingUp, status: bySign(m.grossProfit), benchmark: "positive", category: "Profitability", color: C["Profitability"] },
    { key: "gross_margin", label: "Gross Margin", value: pct(m.grossProfitMargin), formula: "(Gross Profit \u00f7 Revenue) \u00d7 100", icon: Percent, status: bySign(m.grossProfitMargin), benchmark: "positive", category: "Profitability", color: C["Profitability"] },
    { key: "operating_profit", label: "Operating Profit", value: fmt(m.operatingProfit), formula: "Gross Profit \u2212 Operating Expenses", icon: Activity, status: bySign(m.operatingProfit), benchmark: "positive", category: "Profitability", color: C["Profitability"] },
    { key: "operating_margin", label: "Operating Margin", value: pct(m.operatingMargin), formula: "(Operating Profit \u00f7 Revenue) \u00d7 100", icon: Percent, status: bySign(m.operatingMargin), benchmark: "positive", category: "Profitability", color: C["Profitability"] },
    { key: "net_profit", label: "Net Profit", value: fmt(m.netProfit), formula: "Revenue \u2212 COGS \u2212 Expenses", icon: DollarSign, status: bySign(m.netProfit), benchmark: "positive", category: "Profitability", color: C["Profitability"] },
    { key: "net_profit_margin", label: "Net Profit Margin", value: pct(m.netProfitMargin), formula: "(Net Profit \u00f7 Revenue) \u00d7 100", icon: Percent, status: bySign(m.netProfitMargin), benchmark: "positive", category: "Profitability", color: C["Profitability"] },
    { key: "revenue_growth", label: "Revenue Growth", value: signedPct(m.revenueGrowth), formula: "vs previous period of equal length", icon: TrendingUp, status: bySign(m.revenueGrowth), benchmark: "vs. prior period", category: "Profitability", color: C["Profitability"] },
    { key: "profit_per_employee", label: "Profit / Employee", value: fmt(m.profitPerEmployee), formula: "Net Profit \u00f7 active headcount", icon: Users, status: bySign(m.profitPerEmployee), benchmark: "positive", category: "Profitability", color: C["Profitability"] },
    { key: "current_ratio", label: "Current Ratio", value: ratio(m.currentRatio), formula: "Current Assets \u00f7 Current Liabilities", icon: Gauge, status: byTarget(m.currentRatio >= 1), benchmark: "\u2265 1.00", category: "Liquidity", color: C["Liquidity"] },
    { key: "quick_ratio", label: "Quick Ratio", value: ratio(m.quickRatio), formula: "(Current Assets \u2212 Inventory) \u00f7 Current Liabilities", icon: Zap, status: byTarget(m.quickRatio >= 1), benchmark: "\u2265 1.00", category: "Liquidity", color: C["Liquidity"] },
    { key: "cash_ratio", label: "Cash Ratio", value: ratio(m.cashRatio), formula: "Cash \u00f7 Current Liabilities", icon: Coins, status: byTarget(m.cashRatio >= 0.5), benchmark: "\u2265 0.50", category: "Liquidity", color: C["Liquidity"] },
    { key: "working_capital", label: "Working Capital", value: fmt(m.workingCapital), formula: "Current Assets \u2212 Current Liabilities", icon: Wallet, status: bySign(m.workingCapital), benchmark: "positive", category: "Liquidity", color: C["Liquidity"] },
    { key: "net_cash", label: "Cash on Hand", value: fmt(m.cash), formula: "Balance of cash & bank accounts", icon: Banknote, status: bySign(m.cash), benchmark: "positive", category: "Liquidity", color: C["Liquidity"] },
    { key: "roa", label: "ROA", value: pct(m.roa), formula: "(Net Profit \u00f7 Total Assets) \u00d7 100", icon: BarChart3, status: bySign(m.roa), benchmark: "positive", category: "Investment", color: C["Investment"] },
    { key: "roe", label: "ROE", value: pct(m.roe), formula: "(Net Profit \u00f7 Equity) \u00d7 100", icon: ShieldCheck, status: bySign(m.roe), benchmark: "positive", category: "Investment", color: C["Investment"] },
    { key: "asset_turnover", label: "Asset Turnover", value: ratio(m.assetTurnover), formula: "Revenue \u00f7 Total Assets", icon: Layers, status: "neutral", category: "Efficiency", color: C["Efficiency"] },
    { key: "ar_turnover", label: "AR Turnover", value: ratio(m.arTurnover), formula: "Revenue \u00f7 Avg Accounts Receivable", icon: Target, status: "neutral", category: "Efficiency", color: C["Efficiency"] },
    { key: "collection_period", label: "Collection Period", value: days(m.collectionPeriod), formula: "365 \u00f7 AR Turnover", icon: Clock, status: m.collectionPeriod > 0 ? byTarget(m.collectionPeriod < 60) : "neutral", benchmark: "< 60 days", category: "Efficiency", color: C["Efficiency"] },
    { key: "ap_turnover", label: "AP Turnover", value: ratio(m.apTurnover), formula: "COGS \u00f7 Avg Accounts Payable", icon: Repeat, status: "neutral", category: "Efficiency", color: C["Efficiency"] },
    { key: "payable_period", label: "Payable Period", value: days(payablePeriod), formula: "365 \u00f7 AP Turnover", icon: Clock, status: "neutral", category: "Efficiency", color: C["Efficiency"] },
    { key: "total_inflows", label: "Total Inflows", value: fmt(m.totalInflows), formula: "Sum of cash debits", icon: ArrowUpRight, status: "neutral", category: "Cash Flow", color: C["Cash Flow"] },
    { key: "total_outflows", label: "Total Outflows", value: fmt(m.totalOutflows), formula: "Sum of cash credits", icon: ArrowDownRight, status: "neutral", category: "Cash Flow", color: C["Cash Flow"] },
    { key: "net_cash_flow", label: "Net Cash Flow", value: fmt(m.totalInflows - m.totalOutflows), formula: "Inflows \u2212 Outflows", icon: DollarSign, status: bySign(m.totalInflows - m.totalOutflows), benchmark: "positive", category: "Cash Flow", color: C["Cash Flow"] },
    { key: "cash_runway", label: "Cash Runway", value: months(m.cashRunwayMonths), formula: "Cash on Hand \u00f7 avg monthly net burn", icon: Fuel, status: byTarget(!isFinite(m.cashRunwayMonths) || m.cashRunwayMonths >= 6), benchmark: "\u2265 6 months", category: "Cash Flow", color: C["Cash Flow"] },
    { key: "debt_to_equity", label: "Debt-to-Equity", value: ratio(debtToEquity), formula: "Total Liabilities \u00f7 Equity", icon: Scale, status: byTarget(debtToEquity < 2), benchmark: "< 2.00", category: "Solvency", color: C["Solvency"] },
    { key: "debt_ratio", label: "Debt Ratio", value: ratio(debtRatio), formula: "Total Liabilities \u00f7 Total Assets", icon: Scale, status: byTarget(debtRatio < 0.6), benchmark: "< 0.60", category: "Solvency", color: C["Solvency"] },
    { key: "equity_ratio", label: "Equity Ratio", value: ratio(equityRatio), formula: "Equity \u00f7 Total Assets", icon: PieChart, status: byTarget(equityRatio > 0.4), benchmark: "> 0.40", category: "Solvency", color: C["Solvency"] },
    { key: "budget_variance", label: "Budget Variance", value: fmt(m.budgetVariance), formula: "Actual Spend \u2212 Budget", icon: Receipt, status: byTarget(m.budgetVariance <= 0), benchmark: "at or under budget", category: "Budget", color: C["Budget"] },
    { key: "budget_variance_pct", label: "Budget Variance %", value: signedPct(m.budgetVariancePct), formula: "(Variance \u00f7 Budget) \u00d7 100", icon: Percent, status: byTarget(m.budgetVariancePct <= 0), benchmark: "at or under budget", category: "Budget", color: C["Budget"] },
  ];
}

const ALL_KPI_KEYS = [
  "total_revenue", "gross_profit", "gross_margin", "operating_profit", "operating_margin", "net_profit", "net_profit_margin", "revenue_growth", "profit_per_employee",
  "current_ratio", "quick_ratio", "cash_ratio", "working_capital", "net_cash",
  "roa", "roe",
  "asset_turnover", "ar_turnover", "collection_period", "ap_turnover", "payable_period",
  "total_inflows", "total_outflows", "net_cash_flow", "cash_runway",
  "debt_to_equity", "debt_ratio", "equity_ratio",
  "budget_variance", "budget_variance_pct",
];

interface Props {
  metrics: DashboardMetrics;
}

export default function KPICards({ metrics }: Props) {
  const { preferences, isLoading: prefsLoading, savePreferences, isSaving } = useKpiPreferences();
  const [manageOpen, setManageOpen] = useState(false);
  const [editVisible, setEditVisible] = useState<string[]>([]);
  const [editPinned, setEditPinned] = useState<string[]>([]);

  const allKpis = useMemo(() => buildAllKPIs(metrics), [metrics]);

  const visibleKeys = useMemo(() => {
    if (prefsLoading) return ALL_KPI_KEYS;
    if (!preferences || preferences.visible_kpis.length === 0) return ALL_KPI_KEYS;
    return preferences.visible_kpis;
  }, [preferences, prefsLoading]);

  const pinnedKeys = useMemo(() => preferences?.pinned_kpis || [], [preferences]);

  const visibleKpis = useMemo(() => {
    const visible = allKpis.filter(k => visibleKeys.includes(k.key));
    const pinned = visible.filter(k => pinnedKeys.includes(k.key));
    const unpinned = visible.filter(k => !pinnedKeys.includes(k.key));
    return [...pinned, ...unpinned];
  }, [allKpis, visibleKeys, pinnedKeys]);

  const categories = useMemo(() => {
    const cats: string[] = [];
    if (visibleKpis.some(k => pinnedKeys.includes(k.key))) cats.push("⭐ Pinned");
    const otherCats = [...new Set(visibleKpis.filter(k => !pinnedKeys.includes(k.key)).map(k => k.category))];
    return [...cats, ...otherCats];
  }, [visibleKpis, pinnedKeys]);

  const getKpisForCategory = (cat: string) => {
    if (cat === "⭐ Pinned") return visibleKpis.filter(k => pinnedKeys.includes(k.key));
    return visibleKpis.filter(k => k.category === cat && !pinnedKeys.includes(k.key));
  };

  const handleTogglePin = (key: string) => {
    const newPinned = pinnedKeys.includes(key) ? pinnedKeys.filter(k => k !== key) : [...pinnedKeys, key];
    savePreferences({ visible_kpis: visibleKeys, pinned_kpis: newPinned });
    toast.success(pinnedKeys.includes(key) ? "KPI unpinned" : "KPI pinned to top");
  };

  const handleRemoveKpi = (key: string) => {
    const newVisible = visibleKeys.filter(k => k !== key);
    const newPinned = pinnedKeys.filter(k => k !== key);
    savePreferences({ visible_kpis: newVisible, pinned_kpis: newPinned });
    toast.success("KPI removed from dashboard");
  };

  const openManageDialog = () => {
    setEditVisible([...visibleKeys]);
    setEditPinned([...pinnedKeys]);
    setManageOpen(true);
  };

  const handleSaveManage = () => {
    savePreferences({ visible_kpis: editVisible, pinned_kpis: editPinned.filter(k => editVisible.includes(k)) });
    setManageOpen(false);
    toast.success("KPI preferences saved");
  };

  const toggleEditVisible = (key: string) => {
    setEditVisible(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const toggleEditPinned = (key: string) => {
    setEditPinned(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground">Key Performance Indicators</h2>
        <Dialog open={manageOpen} onOpenChange={setManageOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 rounded-lg" onClick={openManageDialog}>
              <Settings2 className="w-3.5 h-3.5" />
              Manage KPIs
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Manage KPI Cards</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground mb-4">
              Select which KPIs to display on your dashboard. Pin favorites to show them at the top.
            </p>
            <div className="space-y-4">
              {[...new Set(allKpis.map(k => k.category))].map(cat => (
                <div key={cat}>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{cat}</h4>
                  <div className="space-y-1.5">
                    {allKpis.filter(k => k.category === cat).map(kpi => (
                      <div key={kpi.key} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-muted/50 transition-all duration-200">
                        <Checkbox checked={editVisible.includes(kpi.key)} onCheckedChange={() => toggleEditVisible(kpi.key)} />
                        <kpi.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{kpi.label}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{kpi.formula}</p>
                        </div>
                        <button
                          onClick={() => toggleEditPinned(kpi.key)}
                          className={cn("p-1 rounded transition-colors", editPinned.includes(kpi.key) ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                        >
                          {editPinned.includes(kpi.key) ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
              <div className="text-xs text-muted-foreground">{editVisible.length} of {allKpis.length} selected</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setEditVisible([...ALL_KPI_KEYS]); setEditPinned([]); }}>Reset All</Button>
                <Button size="sm" onClick={handleSaveManage} disabled={isSaving}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Grid */}
      {visibleKpis.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          <p>No KPIs selected. Click "Manage KPIs" to add some.</p>
        </div>
      ) : (
        categories.map(cat => {
          const items = getKpisForCategory(cat);
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="premium-label">{cat}</h3>
                <div className="flex-1 premium-divider" />
                <span className="text-[10px] text-muted-foreground font-mono">{items.length}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {items.map((kpi, i) => {
                  const isPinned = pinnedKeys.includes(kpi.key);
                  return (
                  <Tooltip key={kpi.key}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "premium-card group p-5 cursor-default",
                          isPinned && "premium-card-accent ring-1 ring-primary/20"
                        )}
                        style={{ animationDelay: `${i * 0.05}s` }}
                      >
                        {/* Quick actions */}
                        <div className="absolute top-2.5 right-2.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10">
                          <button onClick={(e) => { e.stopPropagation(); handleTogglePin(kpi.key); }} className="p-1 rounded-md hover:bg-muted transition-colors">
                            {isPinned ? <PinOff className="w-3 h-3 text-primary" /> : <Pin className="w-3 h-3 text-muted-foreground" />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleRemoveKpi(kpi.key); }} className="p-1 rounded-md hover:bg-destructive/10 transition-colors">
                            <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between mb-4 relative">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center ring-1 ring-inset"
                            style={{
                              backgroundColor: `${kpi.color}12`,
                              boxShadow: `0 6px 16px -8px ${kpi.color}55`,
                              // @ts-ignore custom var for ring color
                              "--tw-ring-color": `${kpi.color}25`,
                            } as React.CSSProperties}
                          >
                            <kpi.icon className="w-[18px] h-[18px]" style={{ color: kpi.color }} />
                          </div>
                          {/* Identity only — the category never implies a direction. */}
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground tracking-wide">
                            {kpi.category}
                          </span>
                        </div>

                        <p className="premium-label mb-2">{kpi.label}</p>
                        <p className={cn(
                          "premium-number text-[26px] font-semibold tabular-nums leading-none",
                          kpi.status === "bad" ? "text-[hsl(var(--danger-ink))]" : "text-foreground"
                        )}>
                          {kpi.value}
                        </p>
                        <div className="mt-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                        {kpi.status === "neutral" ? (
                          <p className="text-[10px] text-muted-foreground mt-2 truncate font-mono">{kpi.formula}</p>
                        ) : (
                          <p className={cn(
                            "text-[10px] mt-2 truncate flex items-center gap-1 font-medium",
                            kpi.status === "good" ? "text-[hsl(var(--success-ink))]" : "text-[hsl(var(--danger-ink))]"
                          )}>
                            {kpi.status === "good"
                              ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                              : <AlertTriangle className="w-3 h-3 shrink-0" />}
                            <span className="truncate">
                              {kpi.status === "good" ? "On target" : "Off target"}
                              {kpi.benchmark ? ` \u00b7 ${kpi.benchmark}` : ""}
                            </span>
                          </p>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                      <p className="font-semibold">{kpi.label}</p>
                      <p className="text-muted-foreground mt-0.5">Formula: {kpi.formula}</p>
                      {kpi.status === "neutral"
                        ? <p className="text-muted-foreground mt-0.5">Reference figure — no good/bad target.</p>
                        : <p className="text-muted-foreground mt-0.5">Target: {kpi.benchmark}</p>}
                    </TooltipContent>
                  </Tooltip>
                  );
                })}
              </div>
            </div>

          );
        })
      )}
    </div>
  );
}
