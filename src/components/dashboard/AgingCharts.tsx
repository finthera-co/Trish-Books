import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import { useARAging, type AgingTotals } from "@/hooks/useARModule";
import { useAPAging, type APAgingTotals } from "@/hooks/useAPModule";

const fmt = (v: number) => `LKR ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const kFmt = (v: number) => `${(v / 1000).toFixed(0)}k`;

type BucketKey = "current" | "days_1_30" | "days_31_60" | "days_61_90" | "days_91_120" | "over_120";

const BUCKETS: { key: BucketKey; label: string; color: string }[] = [
  { key: "current",     label: "Current", color: "hsl(160, 84%, 39%)" },
  { key: "days_1_30",   label: "1–30",    color: "hsl(38, 92%, 50%)" },
  { key: "days_31_60",  label: "31–60",   color: "hsl(25, 90%, 52%)" },
  { key: "days_61_90",  label: "61–90",   color: "hsl(0, 84%, 60%)" },
  { key: "days_91_120", label: "91–120",  color: "hsl(0, 72%, 45%)" },
  { key: "over_120",    label: "120+",    color: "hsl(0, 65%, 32%)" },
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
  const { data: ar, isLoading: arLoading } = useARAging();
  const { data: ap, isLoading: apLoading } = useAPAging();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-fade-in">
      <AgingCard
        title="Receivables Aging"
        subtitle="What customers owe, by age"
        totals={ar?.totals}
        isLoading={arLoading}
        emptyText="No outstanding receivables."
      />
      <AgingCard
        title="Payables Aging"
        subtitle="What we owe vendors, by age"
        totals={ap?.totals}
        isLoading={apLoading}
        emptyText="No outstanding payables."
        destructiveTotal
      />
    </div>
  );
}

interface AgingCardProps {
  title: string;
  subtitle: string;
  totals: AnyAgingTotals | undefined;
  isLoading: boolean;
  emptyText: string;
  destructiveTotal?: boolean;
}

function AgingCard({ title, subtitle, totals, isLoading, emptyText, destructiveTotal }: AgingCardProps) {
  const grandTotal = totals?.grand_total ?? 0;

  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>

      {isLoading ? (
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
            <p className={`text-2xl font-bold tabular-nums ${destructiveTotal && grandTotal > 0 ? "text-destructive" : "text-foreground"}`}>
              {fmt(grandTotal)}
            </p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={buildData(totals)} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(220, 9%, 46%)" tickFormatter={kFmt} />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip
                formatter={(value: number, name: string) => [fmt(value), name]}
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(220, 13%, 91%)', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {BUCKETS.map((b, i) => (
                <Bar
                  key={b.key}
                  dataKey={b.key}
                  stackId="age"
                  fill={b.color}
                  name={b.label}
                  radius={
                    i === 0 ? [6, 0, 0, 6]
                    : i === BUCKETS.length - 1 ? [0, 6, 6, 0]
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
