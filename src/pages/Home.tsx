import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { format, subMonths, startOfMonth } from "date-fns";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import ModuleCards from "@/components/dashboard/ModuleCards";
import OBEBanner from "@/components/dashboard/OBEBanner";
import PeriodFilter from "@/components/dashboard/PeriodFilter";
import DashboardCharts from "@/components/dashboard/DashboardCharts";
import KPICards from "@/components/dashboard/KPICards";
import { Loader2, Filter, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-6 overflow-y-auto flex-1">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 animate-fade-in">
        <div>
          <p className="text-xs font-medium text-primary mb-1">Dashboard → Overview</p>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Financial Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome back, {appUser?.first_name || "User"}. {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodFilter from={fromDate} to={toDate} onFromChange={setFromDate} onToChange={setToDate} />
          <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
            <Filter className="w-3.5 h-3.5" /> Filter
          </Button>
          <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
            <Share2 className="w-3.5 h-3.5" /> Share
          </Button>
        </div>
      </div>

      {/* OBE Warning Banner */}
      <OBEBanner />

      {/* Module Navigation */}
      <ModuleCards />

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Loading financial data…</span>
          </div>
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
