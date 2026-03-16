import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { format, subMonths, startOfMonth } from "date-fns";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import ModuleCards from "@/components/dashboard/ModuleCards";
import PeriodFilter from "@/components/dashboard/PeriodFilter";
import DashboardCharts from "@/components/dashboard/DashboardCharts";
import KPICards from "@/components/dashboard/KPICards";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { appUser } = useAuth();

  const [fromDate, setFromDate] = useState(() => startOfMonth(subMonths(new Date(), 5)));
  const [toDate, setToDate] = useState(() => new Date());

  const period = useMemo(() => ({
    from: format(fromDate, "yyyy-MM-dd"),
    to: format(toDate, "yyyy-MM-dd"),
  }), [fromDate, toDate]);

  const { metrics, isLoading } = useDashboardMetrics(period);

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Financial Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome back, {appUser?.first_name || "User"}. {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <PeriodFilter from={fromDate} to={toDate} onFromChange={setFromDate} onToChange={setToDate} />
      </div>

      {/* Module Navigation */}
      <ModuleCards />

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">Loading financial data…</span>
        </div>
      ) : (
        <>
          {/* Charts */}
          <DashboardCharts metrics={metrics} />

          {/* KPI Cards */}
          <KPICards metrics={metrics} />
        </>
      )}
    </div>
  );
}
