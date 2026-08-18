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
import { AlertCircle, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { formatCurrency, formatCompactAmount } from "@/lib/currency";
import { useChartTheme } from "@/lib/chartTokens";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTick } from "@/lib/format";

export default function CashBalanceForecastChart() {
  const { data = [], isLoading, isError, refetch } = useFinancialForecasts("cash");
  const theme = useChartTheme();

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        label: formatDateTick(d.period),
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
            ? `${formatDateTick(first.period)} → ${formatDate(last.period)}`
            : "Statistical 95% confidence interval"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm font-medium text-foreground">Couldn’t load the forecast</p>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => void refetch()}>
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </Button>
          </div>
        ) : isLoading ? (
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
                  <stop offset="0%" stopColor={theme.primary} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={theme.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: theme.axis }} stroke={theme.axis} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 10, fill: theme.axis }}
                stroke={theme.axis}
                tickFormatter={formatCompactAmount}
              />
              <Tooltip
                contentStyle={theme.tooltip.contentStyle}
                labelStyle={theme.tooltip.labelStyle}
                itemStyle={theme.tooltip.itemStyle}
                formatter={(v: number) => formatCurrency(v)}
              />
              <Legend wrapperStyle={theme.legendStyle} />
              <Area type="monotone" dataKey="lower" stroke="none" fill="url(#ciHome)" name="Lower bound" />
              <Area type="monotone" dataKey="upper" stroke="none" fill="url(#ciHome)" name="Upper bound" />
              <Line
                type="monotone"
                dataKey="forecast"
                stroke={theme.primary}
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
