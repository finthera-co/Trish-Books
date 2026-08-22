import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import WorkflowCanvas from "@/components/dashboard/workflow/WorkflowCanvas";
import WorkflowRail from "@/components/dashboard/workflow/WorkflowRail";
import { Loader2, ArrowRight, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  return <TenantHome />;
}

function TenantHome() {
  const navigate = useNavigate();

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6 overflow-y-auto flex-1">
      {/* Premium Header */}
      <div className="premium-hero rounded-3xl border border-border/60 px-6 sm:px-8 py-7 animate-fade-in relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[radial-gradient(circle_at_1px_1px,_hsl(var(--foreground))_1px,_transparent_0)] [background-size:24px_24px]" />
        <div className="relative flex justify-end">
          <Button
            onClick={() => navigate("/dashboard")}
            size="sm"
            className="h-9 text-xs gap-1.5 rounded-xl"
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> View Dashboard <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Workflow Navigation */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <WorkflowCanvas />
        <WorkflowRail />
      </div>
    </div>
  );
}
