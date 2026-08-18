import { useMemo } from "react";
import { useDailyBalances } from "@/hooks/useTransactions";
import { useCashflowForecast } from "@/hooks/useCashflowForecast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { format, subDays } from "date-fns";
import { TrendingUp, Loader2 } from "lucide-react";
import { formatDateTick } from "@/lib/format";

export default function CashFlowChart() {
  const from = format(subDays(new Date(), 90), "yyyy-MM-dd");
  const { data: actuals, isLoading: loadingActuals } = useDailyBalances(from);
  const { data: forecast, isLoading: loadingForecast } = useCashflowForecast();

  const chartData = useMemo(() => {
    const combined: {
      date: string;
      label: string;
      actual?: number;
      forecast?: number;
    }[] = [];

    // Add actuals
    for (const b of actuals || []) {
      combined.push({
        date: b.date,
        label: formatDateTick(b.date),
        actual: Number(b.closing_balance),
      });
    }

    // Add forecast points
    for (const f of forecast || []) {
      const existing = combined.find((c) => c.date === f.date);
      if (existing) {
        existing.forecast = f.predicted_balance;
      } else {
        combined.push({
          date: f.date,
          label: formatDateTick(f.date),
          forecast: f.predicted_balance,
        });
      }
    }

    // Bridge: set forecast start = last actual
    if (actuals?.length && forecast?.length) {
      const lastActual = actuals[actuals.length - 1];
      const bridgeDate = lastActual.date;
      const existing = combined.find((c) => c.date === bridgeDate);
      if (existing) {
        existing.forecast = Number(lastActual.closing_balance);
      }
    }

    combined.sort((a, b) => a.date.localeCompare(b.date));
    return combined;
  }, [actuals, forecast]);

  const isLoading = loadingActuals || loadingForecast;

  const latestActual = actuals?.length
    ? Number(actuals[actuals.length - 1].closing_balance)
    : 0;
  const lastForecast = forecast?.length
    ? forecast[forecast.length - 1].predicted_balance
    : 0;
  const trendDirection = lastForecast >= latestActual ? "up" : "down";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Cash Flow Forecast
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] gap-1">
              <span
                className={`w-2 h-2 rounded-full inline-block ${
                  trendDirection === "up" ? "bg-green-500" : "bg-red-500"
                }`}
              />
              {trendDirection === "up" ? "Trending Up" : "Trending Down"}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              30-day forecast
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            No balance data yet. Forecasts will appear once daily balances are
            recorded.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-muted/30"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                className="text-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                className="text-muted-foreground"
                tickFormatter={(v) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
                }
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  backgroundColor: "hsl(var(--popover))",
                  color: "hsl(var(--popover-foreground))",
                }}
                formatter={(value: number) => [
                  value.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  }),
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                iconType="line"
              />
              {actuals?.length && (
                <ReferenceLine
                  x={formatDateTick(actuals[actuals.length - 1].date)}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="3 3"
                  label={{
                    value: "Today",
                    position: "top",
                    style: { fontSize: 10 },
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual Balance"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                name="Forecast"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                connectNulls={false}
                opacity={0.6}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
