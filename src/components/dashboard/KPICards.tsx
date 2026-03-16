import {
  TrendingUp, TrendingDown, DollarSign, Percent, BarChart3,
  Wallet, ShieldCheck, Activity, ArrowUpRight, ArrowDownRight,
  Layers, Gauge, PiggyBank, Target, Clock, Zap
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DashboardMetrics } from "@/hooks/useDashboardMetrics";
import { cn } from "@/lib/utils";

const fmt = (n: number) => `LKR ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const ratio = (n: number) => n.toFixed(2);
const days = (n: number) => `${Math.round(n)} days`;

interface KPIItem {
  label: string;
  value: string;
  formula: string;
  icon: React.ElementType;
  positive: boolean;
  category: string;
}

function buildKPIs(m: DashboardMetrics): KPIItem[] {
  return [
    // Profitability
    { label: "Gross Profit", value: fmt(m.grossProfit), formula: "Revenue − COGS", icon: TrendingUp, positive: m.grossProfit >= 0, category: "Profitability" },
    { label: "Gross Margin", value: pct(m.grossProfitMargin), formula: "(Gross Profit ÷ Revenue) × 100", icon: Percent, positive: m.grossProfitMargin >= 0, category: "Profitability" },
    { label: "Operating Profit", value: fmt(m.operatingProfit), formula: "Gross Profit − Operating Expenses", icon: Activity, positive: m.operatingProfit >= 0, category: "Profitability" },
    { label: "Operating Margin", value: pct(m.operatingMargin), formula: "(Operating Profit ÷ Revenue) × 100", icon: Percent, positive: m.operatingMargin >= 0, category: "Profitability" },
    { label: "Net Profit", value: fmt(m.netProfit), formula: "Revenue − COGS − Expenses", icon: DollarSign, positive: m.netProfit >= 0, category: "Profitability" },
    { label: "Net Profit Margin", value: pct(m.netProfitMargin), formula: "(Net Profit ÷ Revenue) × 100", icon: Percent, positive: m.netProfitMargin >= 0, category: "Profitability" },

    // Liquidity
    { label: "Current Ratio", value: ratio(m.currentRatio), formula: "Current Assets ÷ Current Liabilities", icon: Gauge, positive: m.currentRatio >= 1, category: "Liquidity" },
    { label: "Quick Ratio", value: ratio(m.quickRatio), formula: "(Current Assets − Inventory) ÷ Current Liabilities", icon: Zap, positive: m.quickRatio >= 1, category: "Liquidity" },
    { label: "Cash Ratio", value: ratio(m.cashRatio), formula: "Cash ÷ Current Liabilities", icon: PiggyBank, positive: m.cashRatio >= 0.5, category: "Liquidity" },
    { label: "Working Capital", value: fmt(m.workingCapital), formula: "Current Assets − Current Liabilities", icon: Wallet, positive: m.workingCapital >= 0, category: "Liquidity" },

    // Investment
    { label: "ROA", value: pct(m.roa), formula: "(Net Profit ÷ Total Assets) × 100", icon: BarChart3, positive: m.roa >= 0, category: "Investment" },
    { label: "ROE", value: pct(m.roe), formula: "(Net Profit ÷ Equity) × 100", icon: ShieldCheck, positive: m.roe >= 0, category: "Investment" },

    // Efficiency
    { label: "Asset Turnover", value: ratio(m.assetTurnover), formula: "Revenue ÷ Total Assets", icon: Layers, positive: m.assetTurnover > 0, category: "Efficiency" },
    { label: "AR Turnover", value: ratio(m.arTurnover), formula: "Revenue ÷ Avg Accounts Receivable", icon: Target, positive: m.arTurnover > 0, category: "Efficiency" },
    { label: "Collection Period", value: days(m.collectionPeriod), formula: "365 ÷ AR Turnover", icon: Clock, positive: m.collectionPeriod < 60, category: "Efficiency" },

    // Cash Flow
    { label: "Total Inflows", value: fmt(m.totalInflows), formula: "Sum of cash debits", icon: ArrowUpRight, positive: true, category: "Cash Flow" },
    { label: "Total Outflows", value: fmt(m.totalOutflows), formula: "Sum of cash credits", icon: ArrowDownRight, positive: false, category: "Cash Flow" },
    { label: "Net Cash Flow", value: fmt(m.totalInflows - m.totalOutflows), formula: "Inflows − Outflows", icon: DollarSign, positive: m.totalInflows - m.totalOutflows >= 0, category: "Cash Flow" },
  ];
}

interface Props {
  metrics: DashboardMetrics;
}

export default function KPICards({ metrics }: Props) {
  const kpis = buildKPIs(metrics);
  const categories = [...new Set(kpis.map(k => k.category))];

  return (
    <div className="space-y-5">
      {categories.map(cat => (
        <div key={cat}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">{cat}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpis.filter(k => k.category === cat).map(kpi => (
              <Tooltip key={kpi.label}>
                <TooltipTrigger asChild>
                  <div className="bg-card rounded-lg border border-border p-3.5 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 cursor-default">
                    <div className="flex items-center justify-between mb-2">
                      <kpi.icon className={cn("w-4 h-4", kpi.positive ? "text-[hsl(var(--success))]" : "text-destructive")} />
                      {kpi.positive
                        ? <ArrowUpRight className="w-3 h-3 text-[hsl(var(--success))]" />
                        : <ArrowDownRight className="w-3 h-3 text-destructive" />
                      }
                    </div>
                    <p className={cn("text-lg font-bold tabular-nums leading-none", kpi.positive ? "text-foreground" : "text-destructive")}>
                      {kpi.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1.5 leading-tight">{kpi.label}</p>
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
      ))}
    </div>
  );
}
