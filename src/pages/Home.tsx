import { useState, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { format, subMonths, startOfMonth } from "date-fns";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import ModuleCards from "@/components/dashboard/ModuleCards";
import OBEBanner from "@/components/dashboard/OBEBanner";
import PeriodFilter from "@/components/dashboard/PeriodFilter";
import DashboardCharts from "@/components/dashboard/DashboardCharts";
import AgingCharts from "@/components/dashboard/AgingCharts";
import KPICards from "@/components/dashboard/KPICards";
import SystemHealthCheck from "@/components/dashboard/SystemHealthCheck";
import CashBalanceForecastChart from "@/components/dashboard/CashBalanceForecastChart";
import { Loader2, Filter, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateWithWeekday } from "@/lib/format";

export default function Home() {
  const { appUser, isSuperAdmin, isEmployee, loading } = useAuth();

  // Wait for user data to resolve before deciding which dashboard to show
  if (loading || !appUser) {
    return (
      <div className="flex items-center justify-center flex-1 py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      </div>
    );
  }

  // Super Admin should always land inside the control-plane module shell
  if (isSuperAdmin) {
    return <Navigate to="/admin" replace />;
  }

  // Self-service employees get their own portal
  if (isEmployee) {
    return <Navigate to="/me" replace />;
  }

  return <TenantDashboard />;
}

function TenantDashboard() {
  const { appUser } = useAuth();

  const [fromDate, setFromDate] = useState(() => startOfMonth(subMonths(new Date(), 5)));
  const [toDate, setToDate] = useState(() => new Date());

  const period = useMemo(() => ({
    from: format(fromDate, "yyyy-MM-dd"),
    to: format(toDate, "yyyy-MM-dd"),
  }), [fromDate, toDate]);

  const { metrics, isLoading, isError, error, isFetching, refetch } = useDashboardMetrics(period);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6 overflow-y-auto flex-1">
      {/* Premium Header */}
      <div className="premium-hero rounded-3xl border border-border/60 px-6 sm:px-8 py-7 animate-fade-in relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[radial-gradient(circle_at_1px_1px,_hsl(var(--foreground))_1px,_transparent_0)] [background-size:24px_24px]" />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="premium-label mb-2 flex items-center gap-2">
              <span className="inline-block w-6 h-px bg-primary" />
              Dashboard · Overview
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight premium-number">
              Financial Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Welcome back, <span className="text-foreground font-medium">{appUser?.first_name || "User"}</span>. {formatDateWithWeekday(new Date())}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PeriodFilter from={fromDate} to={toDate} onFromChange={setFromDate} onToChange={setToDate} />
            <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 rounded-xl bg-card/60 backdrop-blur">
              <Filter className="w-3.5 h-3.5" /> Filter
            </Button>
          </div>
        </div>
      </div>

      {/* OBE Warning Banner */}
      <OBEBanner />

      {/* Module Navigation */}
      <ModuleCards />


      {isError ? (
        /* Never render the derived figures on a failed fetch: every metric
           defaults to zero, so a broken query is indistinguishable from a
           company with no activity. */
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center animate-fade-in">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
          <h2 className="mt-3 text-base font-semibold text-foreground">Financial data couldn’t be loaded</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            The figures for this period are unavailable, so nothing is shown rather than
            showing zeros that look like real balances.
          </p>
          {error?.message && (
            <p className="mt-2 text-xs text-muted-foreground/80 font-mono break-words max-w-md mx-auto">
              {error.message}
            </p>
          )}
          <Button variant="outline" size="sm" className="mt-4 h-9 text-xs gap-1.5" onClick={refetch} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Retry
          </Button>
        </div>
      ) : isLoading ? (
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

          {/* AR/AP Aging */}
          <AgingCharts />

          {/* KPI Cards */}
          <KPICards metrics={metrics} />
        </>
      )}

      {/* Cash Balance Forecast with Confidence Bands */}
      <CashBalanceForecastChart />

      {/* System Health */}
      <SystemHealthCheck />
    </div>
  );
}
