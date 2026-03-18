import { useState, useMemo } from "react";
import {
  TrendingUp, TrendingDown, DollarSign, Percent, BarChart3,
  Wallet, ShieldCheck, Activity, ArrowUpRight, ArrowDownRight,
  Layers, Gauge, PiggyBank, Target, Clock, Zap,
  Settings2, X, Plus, Pin, PinOff, Check,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";
import { useKpiPreferences } from "@/hooks/useKpiPreferences";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const fmt = (n: number) => `LKR ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const ratio = (n: number) => n.toFixed(2);
const days = (n: number) => `${Math.round(n)} days`;

export interface KPIItem {
  key: string;
  label: string;
  value: string;
  formula: string;
  icon: React.ElementType;
  positive: boolean;
  category: string;
  color: string;
}

const KPI_COLORS: Record<string, string> = {
  "Profitability": "hsl(160, 84%, 39%)",
  "Liquidity": "hsl(217, 91%, 60%)",
  "Investment": "hsl(280, 65%, 60%)",
  "Efficiency": "hsl(38, 92%, 50%)",
  "Cash Flow": "hsl(199, 89%, 48%)",
};

function buildAllKPIs(m: DashboardMetrics): KPIItem[] {
  return [
    { key: "gross_profit", label: "Gross Profit", value: fmt(m.grossProfit), formula: "Revenue − COGS", icon: TrendingUp, positive: m.grossProfit >= 0, category: "Profitability", color: KPI_COLORS["Profitability"] },
    { key: "gross_margin", label: "Gross Margin", value: pct(m.grossProfitMargin), formula: "(Gross Profit ÷ Revenue) × 100", icon: Percent, positive: m.grossProfitMargin >= 0, category: "Profitability", color: KPI_COLORS["Profitability"] },
    { key: "operating_profit", label: "Operating Profit", value: fmt(m.operatingProfit), formula: "Gross Profit − Operating Expenses", icon: Activity, positive: m.operatingProfit >= 0, category: "Profitability", color: KPI_COLORS["Profitability"] },
    { key: "operating_margin", label: "Operating Margin", value: pct(m.operatingMargin), formula: "(Operating Profit ÷ Revenue) × 100", icon: Percent, positive: m.operatingMargin >= 0, category: "Profitability", color: KPI_COLORS["Profitability"] },
    { key: "net_profit", label: "Net Profit", value: fmt(m.netProfit), formula: "Revenue − COGS − Expenses", icon: DollarSign, positive: m.netProfit >= 0, category: "Profitability", color: KPI_COLORS["Profitability"] },
    { key: "net_profit_margin", label: "Net Profit Margin", value: pct(m.netProfitMargin), formula: "(Net Profit ÷ Revenue) × 100", icon: Percent, positive: m.netProfitMargin >= 0, category: "Profitability", color: KPI_COLORS["Profitability"] },
    { key: "current_ratio", label: "Current Ratio", value: ratio(m.currentRatio), formula: "Current Assets ÷ Current Liabilities", icon: Gauge, positive: m.currentRatio >= 1, category: "Liquidity", color: KPI_COLORS["Liquidity"] },
    { key: "quick_ratio", label: "Quick Ratio", value: ratio(m.quickRatio), formula: "(Current Assets − Inventory) ÷ Current Liabilities", icon: Zap, positive: m.quickRatio >= 1, category: "Liquidity", color: KPI_COLORS["Liquidity"] },
    { key: "cash_ratio", label: "Cash Ratio", value: ratio(m.cashRatio), formula: "Cash ÷ Current Liabilities", icon: PiggyBank, positive: m.cashRatio >= 0.5, category: "Liquidity", color: KPI_COLORS["Liquidity"] },
    { key: "working_capital", label: "Working Capital", value: fmt(m.workingCapital), formula: "Current Assets − Current Liabilities", icon: Wallet, positive: m.workingCapital >= 0, category: "Liquidity", color: KPI_COLORS["Liquidity"] },
    { key: "roa", label: "ROA", value: pct(m.roa), formula: "(Net Profit ÷ Total Assets) × 100", icon: BarChart3, positive: m.roa >= 0, category: "Investment", color: KPI_COLORS["Investment"] },
    { key: "roe", label: "ROE", value: pct(m.roe), formula: "(Net Profit ÷ Equity) × 100", icon: ShieldCheck, positive: m.roe >= 0, category: "Investment", color: KPI_COLORS["Investment"] },
    { key: "asset_turnover", label: "Asset Turnover", value: ratio(m.assetTurnover), formula: "Revenue ÷ Total Assets", icon: Layers, positive: m.assetTurnover > 0, category: "Efficiency", color: KPI_COLORS["Efficiency"] },
    { key: "ar_turnover", label: "AR Turnover", value: ratio(m.arTurnover), formula: "Revenue ÷ Avg Accounts Receivable", icon: Target, positive: m.arTurnover > 0, category: "Efficiency", color: KPI_COLORS["Efficiency"] },
    { key: "collection_period", label: "Collection Period", value: days(m.collectionPeriod), formula: "365 ÷ AR Turnover", icon: Clock, positive: m.collectionPeriod < 60, category: "Efficiency", color: KPI_COLORS["Efficiency"] },
    { key: "total_inflows", label: "Total Inflows", value: fmt(m.totalInflows), formula: "Sum of cash debits", icon: ArrowUpRight, positive: true, category: "Cash Flow", color: KPI_COLORS["Cash Flow"] },
    { key: "total_outflows", label: "Total Outflows", value: fmt(m.totalOutflows), formula: "Sum of cash credits", icon: ArrowDownRight, positive: false, category: "Cash Flow", color: KPI_COLORS["Cash Flow"] },
    { key: "net_cash_flow", label: "Net Cash Flow", value: fmt(m.totalInflows - m.totalOutflows), formula: "Inflows − Outflows", icon: DollarSign, positive: m.totalInflows - m.totalOutflows >= 0, category: "Cash Flow", color: KPI_COLORS["Cash Flow"] },
  ];
}

const ALL_KPI_KEYS = [
  "gross_profit", "gross_margin", "operating_profit", "operating_margin", "net_profit", "net_profit_margin",
  "current_ratio", "quick_ratio", "cash_ratio", "working_capital",
  "roa", "roe",
  "asset_turnover", "ar_turnover", "collection_period",
  "total_inflows", "total_outflows", "net_cash_flow",
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
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">{cat}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {items.map((kpi, i) => (
                  <Tooltip key={kpi.key}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "group relative bg-card rounded-xl border p-5 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 cursor-default",
                          pinnedKeys.includes(kpi.key) ? "border-primary/30 shadow-sm" : "border-border"
                        )}
                        style={{ animationDelay: `${i * 0.05}s` }}
                      >
                        {/* Quick actions */}
                        <div className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
                          <button onClick={(e) => { e.stopPropagation(); handleTogglePin(kpi.key); }} className="p-1 rounded-md hover:bg-muted transition-colors">
                            {pinnedKeys.includes(kpi.key) ? <PinOff className="w-3 h-3 text-primary" /> : <Pin className="w-3 h-3 text-muted-foreground" />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleRemoveKpi(kpi.key); }} className="p-1 rounded-md hover:bg-destructive/10 transition-colors">
                            <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between mb-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${kpi.color}15` }}>
                            <kpi.icon className="w-4.5 h-4.5" style={{ color: kpi.color }} />
                          </div>
                          {kpi.positive
                            ? <ArrowUpRight className="w-4 h-4 text-[hsl(var(--success))]" />
                            : <ArrowDownRight className="w-4 h-4 text-destructive" />
                          }
                        </div>
                        <p className={cn("text-xl font-bold tabular-nums leading-none", kpi.positive ? "text-foreground" : "text-destructive")}>
                          {kpi.value}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2 leading-tight">{kpi.label}</p>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[200px] text-xs">
                      <p className="font-semibold">{kpi.label}</p>
                      <p className="text-muted-foreground mt-0.5">Formula: {kpi.formula}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
