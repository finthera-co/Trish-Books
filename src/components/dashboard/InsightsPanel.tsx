import { useInsights, type Insight } from "@/hooks/useInsights";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
  Zap,
  DollarSign,
  Clock,
} from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  expense_change: TrendingUp,
  income_change: DollarSign,
  cash_runway: Clock,
  profit_margin: Zap,
};

const severityStyles: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-700 border-blue-200 dark:text-blue-400 dark:border-blue-800",
  warning:
    "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-800",
  critical:
    "bg-red-500/10 text-red-700 border-red-200 dark:text-red-400 dark:border-red-800",
};

const severityBadge: Record<string, string> = {
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  critical: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

function InsightCard({ insight }: { insight: Insight }) {
  const Icon = iconMap[insight.type] || Info;
  const isNegative =
    insight.message.includes("decreased") || insight.message.includes("critical");

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${severityStyles[insight.severity]}`}
    >
      <div className="mt-0.5">
        {isNegative ? (
          <TrendingDown className="w-5 h-5" />
        ) : insight.severity === "warning" || insight.severity === "critical" ? (
          <AlertTriangle className="w-5 h-5" />
        ) : (
          <Icon className="w-5 h-5" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{insight.message}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <Badge
            variant="secondary"
            className={`text-[10px] px-1.5 py-0 ${severityBadge[insight.severity]}`}
          >
            {insight.severity}
          </Badge>
          <span className="text-[10px] opacity-60">
            {formatDate(insight.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function InsightsPanel() {
  const { data: insights, isLoading } = useInsights();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-muted animate-pulse"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!insights?.length) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">
            No insights yet. Insights are generated daily from your transaction
            data.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          AI Insights
          <Badge variant="secondary" className="ml-auto text-[10px]">
            {insights.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
