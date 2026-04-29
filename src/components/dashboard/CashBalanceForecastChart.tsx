import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { useFinancialForecasts } from "@/hooks/useCashflowForecast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Loader2, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

export default function CashBalanceForecastChart() {
  const { data = [], isLoading } = useFinancialForecasts("cash");

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        label: format(parseISO(d.period), "MMM d"),
        forecast: Number(d.forecast_value),
        lower: Number(d.lower_bound),
        upper: Number(d.upper_bound),
      })),
    [data]
  );

  const first = data[0];
  const last = data[data.length - 1];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Cash Balance Forecast with Confidence Bands
        </CardTitle>
        <CardDescription>
          {first && last
            ? `${format(parseISO(first.period), "MMM d")} → ${format(parseISO(last.period), "MMM d, yyyy")}`
            : "Statistical 95% confidence interval"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            No forecast data yet. The forecasting engine runs daily at 02:00 UTC.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={chartData}>
              <defs>
                <linearGradient id="ciHome" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  fontSize: 12,
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                }}
                formatter={(v: number) => formatCurrency(v)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="lower" stroke="none" fill="url(#ciHome)" name="Lower bound" />
              <Area type="monotone" dataKey="upper" stroke="none" fill="url(#ciHome)" name="Upper bound" />
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={false}
                name="Forecast"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
