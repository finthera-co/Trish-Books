import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Users, Activity, TrendingUp, BarChart3, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function SystemAnalytics() {
  const { isSuperAdmin } = useAuth();

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["system_analytics"],
    queryFn: async () => {
      const [tenantsRes, usersRes, logsRes, errorsRes] = await Promise.all([
        supabase.from("tenants").select("id, status, created_at, subscription_plans(name)"),
        supabase.from("users").select("id, created_at, tenant_id, status, login_count, last_login_at"),
        supabase.from("audit_logs").select("id, action, created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("system_error_logs").select("id, severity, resolved, created_at"),
      ]);

      const tenants = tenantsRes.data || [];
      const users = usersRes.data || [];
      const logs = logsRes.data || [];
      const errors = errorsRes.data || [];

      // Tenant distribution by plan
      const planCounts: Record<string, number> = {};
      tenants.forEach(t => {
        const plan = (t.subscription_plans as any)?.name || "No Plan";
        planCounts[plan] = (planCounts[plan] || 0) + 1;
      });

      // Users per tenant
      const avgUsersPerTenant = tenants.length ? (users.length / tenants.length).toFixed(1) : "0";

      // Action distribution
      const actionCounts: Record<string, number> = {};
      logs.forEach(l => {
        actionCounts[l.action] = (actionCounts[l.action] || 0) + 1;
      });

      // Login activity (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentLogins = users.filter(u => {
        const la = (u as any).last_login_at;
        return la && new Date(la) > sevenDaysAgo;
      }).length;

      const totalLogins = users.reduce((sum, u) => sum + ((u as any).login_count || 0), 0);

      // Active users (logged in last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const activeUsers = users.filter(u => {
        const la = (u as any).last_login_at;
        return la && new Date(la) > thirtyDaysAgo;
      }).length;

      return {
        totalTenants: tenants.length,
        activeTenants: tenants.filter(t => t.status === "active").length,
        suspendedTenants: tenants.filter(t => t.status === "suspended").length,
        totalUsers: users.length,
        activeUsers,
        avgUsersPerTenant,
        totalAuditEvents: logs.length,
        totalErrors: errors.length,
        unresolvedErrors: errors.filter(e => !e.resolved).length,
        criticalErrors: errors.filter(e => e.severity === "critical" && !e.resolved).length,
        planCounts,
        topActions: Object.entries(actionCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8),
        recentLogins,
        totalLogins,
      };
    },
  });

  if (!isSuperAdmin) {
    return <div className="text-center py-12"><p className="text-muted-foreground">Access denied.</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">System Analytics</h1>
          <p className="page-description">SaaS-level metrics and usage trends (non-financial)</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Companies" value={analytics?.totalTenants || 0} sub={`${analytics?.activeTenants || 0} active`} icon={Building2} />
            <StatCard label="Total Users" value={analytics?.totalUsers || 0} sub={`${analytics?.activeUsers || 0} active (30d)`} icon={Users} />
            <StatCard label="Avg Users/Company" value={analytics?.avgUsersPerTenant || "0"} sub="across all tenants" icon={TrendingUp} />
            <StatCard label="Audit Events" value={analytics?.totalAuditEvents || 0} sub={`${analytics?.unresolvedErrors || 0} unresolved errors`} icon={Activity} />
          </div>

          {/* Login Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <LogIn className="w-4 h-4 text-primary" />
                <p className="text-xs font-medium text-muted-foreground">Logins (7 days)</p>
              </div>
              <p className="text-3xl font-bold text-foreground tabular-nums">{analytics?.recentLogins || 0}</p>
              <p className="text-xs text-muted-foreground mt-1">unique users logged in</p>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-primary" />
                <p className="text-xs font-medium text-muted-foreground">Total Logins (All Time)</p>
              </div>
              <p className="text-3xl font-bold text-foreground tabular-nums">{analytics?.totalLogins || 0}</p>
              <p className="text-xs text-muted-foreground mt-1">cumulative login count</p>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-primary" />
                <p className="text-xs font-medium text-muted-foreground">Suspended Tenants</p>
              </div>
              <p className="text-3xl font-bold text-foreground tabular-nums">{analytics?.suspendedTenants || 0}</p>
              <p className="text-xs text-muted-foreground mt-1">companies suspended</p>
            </div>
          </div>

          {/* Plan distribution + Top actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="stat-card">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" /> Subscription Distribution
              </h3>
              <div className="space-y-3">
                {Object.entries(analytics?.planCounts || {}).map(([plan, count]) => (
                  <div key={plan} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{plan}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary"
                          style={{ width: `${((count as number) / (analytics?.totalTenants || 1)) * 100}%` }} />
                      </div>
                      <span className="text-sm font-medium text-foreground tabular-nums w-8 text-right">{count as number}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="stat-card">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Top System Actions
              </h3>
              <div className="space-y-2">
                {analytics?.topActions?.map(([action, count]) => (
                  <div key={action} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <span className="text-sm text-foreground">{action}</span>
                    <span className="text-xs font-medium text-muted-foreground tabular-nums">{count}</span>
                  </div>
                ))}
                {!analytics?.topActions?.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">No actions recorded</p>
                )}
              </div>
            </div>
          </div>

          {/* Error Summary */}
          <div className="stat-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">Error Summary</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Total Errors</p>
                <p className="text-xl font-bold text-foreground tabular-nums">{analytics?.totalErrors || 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Unresolved</p>
                <p className="text-xl font-bold text-destructive tabular-nums">{analytics?.unresolvedErrors || 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Critical</p>
                <p className="text-xl font-bold text-destructive tabular-nums">{analytics?.criticalErrors || 0}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: number | string; sub: string; icon: React.ElementType }) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
