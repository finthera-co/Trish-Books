import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Building2, Users, Activity, AlertTriangle, Shield, TrendingUp } from "lucide-react";
import { format } from "date-fns";

export default function SuperAdminDashboard() {
  const { appUser } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["super_admin_stats"],
    queryFn: async () => {
      const [tenantsRes, usersRes, errorsRes, logsRes] = await Promise.all([
        supabase.from("tenants").select("id, status", { count: "exact" }),
        supabase.from("users").select("id", { count: "exact" }),
        supabase.from("system_error_logs").select("id, severity", { count: "exact" }).eq("resolved", false),
        supabase.from("audit_logs").select("id", { count: "exact" }),
      ]);
      const tenants = tenantsRes.data || [];
      const users = usersRes.data || [];
      const errors = errorsRes.data || [];
      return {
        totalTenants: tenantsRes.count || 0,
        activeTenants: tenants.filter(t => t.status === "active").length,
        totalUsers: usersRes.count || 0,
        activeUsers: users.length,
        unresolvedErrors: errorsRes.count || 0,
        criticalErrors: errors.filter(e => e.severity === "critical").length,
        totalAuditLogs: logsRes.count || 0,
      };
    },
  });

  const cards = [
    { label: "Total Companies", value: stats?.totalTenants || 0, sub: `${stats?.activeTenants || 0} active`, icon: Building2, color: "text-primary" },
    { label: "Total Users", value: stats?.totalUsers || 0, sub: `${stats?.activeUsers || 0} active`, icon: Users, color: "text-[hsl(var(--info))]" },
    { label: "Unresolved Errors", value: stats?.unresolvedErrors || 0, sub: `${stats?.criticalErrors || 0} critical`, icon: AlertTriangle, color: "text-destructive" },
    { label: "Audit Events", value: stats?.totalAuditLogs || 0, sub: "all time", icon: Shield, color: "text-[hsl(var(--warning))]" },
  ];

  return (
    <div className="w-full px-4 sm:px-5 py-5 space-y-6 overflow-y-auto flex-1">
      <div className="animate-fade-in">
        <p className="text-xs font-medium text-primary mb-1">Super Admin → Control Plane</p>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">System Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Welcome back, {appUser?.first_name || "Admin"}. {format(new Date(), "EEEE, MMMM d, yyyy")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
              <c.icon className={`w-5 h-5 ${c.color}`} />
            </div>
            <p className="text-3xl font-bold text-foreground tabular-nums">{c.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RecentTenantsCard />
        <RecentErrorsCard />
      </div>
    </div>
  );
}

function RecentTenantsCard() {
  const { data: tenants } = useQuery({
    queryKey: ["recent_tenants"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id, company_name, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
  });

  return (
    <div className="stat-card">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-primary" /> Recent Companies
      </h3>
      {tenants?.length ? (
        <div className="space-y-2">
          {tenants.map(t => (
            <div key={t.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{t.company_name}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(t.created_at), "MMM d, yyyy")}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                t.status === "active" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
              }`}>{t.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-4 text-center">No companies yet</p>
      )}
    </div>
  );
}

function RecentErrorsCard() {
  const { data: errors } = useQuery({
    queryKey: ["recent_errors"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_error_logs")
        .select("id, severity, module, message, created_at")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
  });

  const severityColors: Record<string, string> = {
    critical: "bg-destructive/10 text-destructive",
    warning: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
    info: "bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]",
  };

  return (
    <div className="stat-card">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive" /> Unresolved Errors
      </h3>
      {errors?.length ? (
        <div className="space-y-2">
          {errors.map(e => (
            <div key={e.id} className="flex items-start justify-between py-2 border-b border-border last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{e.message}</p>
                <p className="text-xs text-muted-foreground">{e.module} · {format(new Date(e.created_at), "MMM d, HH:mm")}</p>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ml-2 ${severityColors[e.severity] || severityColors.info}`}>
                {e.severity}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-4 text-center">No unresolved errors 🎉</p>
      )}
    </div>
  );
}
