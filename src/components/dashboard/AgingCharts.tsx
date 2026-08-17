import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useARAging, type AgingTotals } from "@/hooks/useARModule";
import { useAPAging, type APAgingTotals } from "@/hooks/useAPModule";
import { useChartTheme } from "@/lib/chartTokens";
import { formatCurrencyShort, formatCompactAmount } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const fmt = (v: number) => formatCurrencyShort(v);

type BucketKey = "current" | "days_1_30" | "days_31_60" | "days_61_90" | "days_91_120" | "over_120";

/**
 * Buckets are ordered oldest-last. Colour comes from the ordinal ramp in
 * `chartTokens`, so age is encoded by lightness within a single hue rather than
 * a green→red rainbow, and the oldest bucket always carries the most contrast
 * against the surface in both themes.
 */
const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: "current",     label: "Current" },
  { key: "days_1_30",   label: "1–30" },
  { key: "days_31_60",  label: "31–60" },
  { key: "days_61_90",  label: "61–90" },
  { key: "days_91_120", label: "91–120" },
  { key: "over_120",    label: "120+" },
];

type AnyAgingTotals = AgingTotals | APAgingTotals;

function buildData(totals: AnyAgingTotals) {
  return [{
    name: "Outstanding",
    current: totals.current,
    days_1_30: totals.days_1_30,
    days_31_60: totals.days_31_60,
    days_61_90: totals.days_61_90,
    days_91_120: totals.days_91_120,
    over_120: totals.over_120,
  }];
}

export default function AgingCharts() {
  const { data: ar, isLoading: arLoading, isError: arError, refetch: refetchAr } = useARAging();
  const { data: ap, isLoading: apLoading, isError: apError, refetch: refetchAp } = useAPAging();
  const theme = useChartTheme();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-fade-in">
      <AgingCard
        title="Receivables Aging"
        subtitle="What customers owe, by age · as of today"
        totals={ar?.totals}
        isLoading={arLoading}
        isError={arError}
        onRetry={() => void refetchAr()}
        emptyText="No outstanding receivables."
        ramp={theme.aging.receivable}
      />
      <AgingCard
        title="Payables Aging"
        subtitle="What we owe vendors, by age · as of today"
        totals={ap?.totals}
        isLoading={apLoading}
        isError={apError}
        onRetry={() => void refetchAp()}
        emptyText="No outstanding payables."
        ramp={theme.aging.payable}
      />
    </div>
  );
}

interface AgingCardProps {
  title: string;
  subtitle: string;
  totals: AnyAgingTotals | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyText: string;
  ramp: string[];
}

function AgingCard({ title, subtitle, totals, isLoading, isError, onRetry, emptyText, ramp }: AgingCardProps) {
  const theme = useChartTheme();
  const grandTotal = totals?.grand_total ?? 0;

  // The alarm signal the ordinal ramp deliberately does not carry: how much of
  // the balance has aged past 90 days.
  const seriouslyOverdue = totals ? totals.days_91_120 + totals.over_120 : 0;
  const overdueShare = grandTotal > 0 ? (seriouslyOverdue / grandTotal) * 100 : 0;

  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {seriouslyOverdue > 0 && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[hsl(var(--warning))]/12 text-[hsl(var(--warning-ink))] shrink-0">
            <AlertCircle className="w-3 h-3" />
            {overdueShare.toFixed(0)}% over 90 days
          </span>
        )}
      </div>

      {isError ? (
        <AgingError onRetry={onRetry} />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : !totals || grandTotal === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-muted-foreground text-sm">{emptyText}</p>
        </div>
      ) : (
        <>
          <div className="mb-3">
            <p className="text-xs text-muted-foreground">Total outstanding</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{fmt(grandTotal)}</p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={buildData(totals)} layout="vertical">
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: theme.axis }}
                stroke={theme.axis}
                tickFormatter={formatCompactAmount}
              />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip
                formatter={(value: number, name: string) => [fmt(value), name]}
                contentStyle={theme.tooltip.contentStyle}
                labelStyle={theme.tooltip.labelStyle}
                itemStyle={theme.tooltip.itemStyle}
                cursor={{ fill: theme.cursorFill }}
              />
              <Legend wrapperStyle={theme.legendStyle} />
              {BUCKETS.map((b, i) => (
                <Bar
                  key={b.key}
                  dataKey={b.key}
                  stackId="age"
                  fill={ramp[i]}
                  name={b.label}
                  /* 2px surface spacer so touching segments stay separable. */
                  stroke={theme.surface}
                  strokeWidth={2}
                  radius={
                    i === 0 ? [4, 0, 0, 4]
                    : i === BUCKETS.length - 1 ? [0, 4, 4, 0]
                    : [0, 0, 0, 0]
                  }
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

function AgingError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-14 text-center")}>
      <AlertCircle className="w-6 h-6 text-destructive" />
      <div>
        <p className="text-sm font-medium text-foreground">Couldn’t load aging data</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          The figures below are unavailable — this is not a zero balance.
        </p>
      </div>
      <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onRetry}>
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </Button>
    </div>
  );
}
