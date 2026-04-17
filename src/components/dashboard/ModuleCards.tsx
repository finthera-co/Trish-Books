import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, BookOpen, Landmark, ShoppingCart, Receipt, DollarSign, BarChart3, FileText, Users, Warehouse, Settings, Building2, UserCheck, Activity, Shield, AlertTriangle, CreditCard } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TENANT_MODULES = [
  { id: "invoices", label: "Invoices", desc: "Create & track invoices", icon: FileText, path: "/sales/invoices", bg: "bg-[hsl(160,84%,39%)]/10", iconBg: "bg-[hsl(160,84%,39%)]" },
  { id: "bills", label: "Bills", desc: "Bills & payment vouchers", icon: Landmark, path: "/banking/payment-vouchers", bg: "bg-[hsl(280,65%,60%)]/10", iconBg: "bg-[hsl(280,65%,60%)]" },
  { id: "payroll", label: "Payroll", desc: "Process payroll runs", icon: DollarSign, path: "/payroll/runs", bg: "bg-[hsl(199,89%,48%)]/10", iconBg: "bg-[hsl(199,89%,48%)]" },
  { id: "bank", label: "Banking", desc: "Reconciliation & banking", icon: Landmark, path: "/banking/reconciliation", bg: "bg-[hsl(228,25%,18%)]/10", iconBg: "bg-[hsl(228,25%,30%)]" },
  { id: "assets", label: "Assets", desc: "Asset tracking & depreciation", icon: Warehouse, path: "/assets/register", bg: "bg-[hsl(160,60%,40%)]/10", iconBg: "bg-[hsl(160,60%,40%)]" },
  { id: "reports", label: "Reports", desc: "Financial reports & analytics", icon: BarChart3, path: "/reports/financial", bg: "bg-[hsl(0,84%,60%)]/10", iconBg: "bg-[hsl(0,84%,60%)]" },
  { id: "journals", label: "Journals", desc: "Double-entry bookkeeping", icon: BookOpen, path: "/accounting/journals", bg: "bg-[hsl(217,91%,60%)]/10", iconBg: "bg-[hsl(217,91%,60%)]" },
];

const SUPER_ADMIN_MODULES = [
  { id: "companies", label: "Companies", desc: "Manage SaaS tenants", icon: Building2, path: "/admin/tenants", bg: "bg-primary/10", iconBg: "bg-primary" },
  { id: "admins", label: "Admins", desc: "Company administrators", icon: UserCheck, path: "/admin/company-admins", bg: "bg-secondary/10", iconBg: "bg-secondary" },
  { id: "users", label: "Users", desc: "All users (read-only)", icon: Users, path: "/admin/users", bg: "bg-[hsl(199,89%,48%)]/10", iconBg: "bg-[hsl(199,89%,48%)]" },
  { id: "analytics", label: "Analytics", desc: "System-wide metrics", icon: Activity, path: "/admin/analytics", bg: "bg-[hsl(160,84%,39%)]/10", iconBg: "bg-[hsl(160,84%,39%)]" },
  { id: "audit", label: "Audit Logs", desc: "System activity tracking", icon: Shield, path: "/admin/audit-logs", bg: "bg-[hsl(38,92%,50%)]/10", iconBg: "bg-[hsl(38,92%,50%)]" },
  { id: "errors", label: "Error Logs", desc: "System error monitoring", icon: AlertTriangle, path: "/admin/error-logs", bg: "bg-destructive/10", iconBg: "bg-destructive" },
  { id: "subs", label: "Subscriptions", desc: "Manage plans", icon: CreditCard, path: "/admin/subscriptions", bg: "bg-[hsl(280,65%,60%)]/10", iconBg: "bg-[hsl(280,65%,60%)]" },
];

export default function ModuleCards() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();

  const modules = isSuperAdmin ? SUPER_ADMIN_MODULES : TENANT_MODULES;

  return (
    <div className={cn("grid gap-3 animate-fade-in", isSuperAdmin ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-7" : "grid-cols-3 sm:grid-cols-5 lg:grid-cols-9")}>
      {modules.map((mod, i) => (
        <Tooltip key={mod.id}>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate(mod.path)}
              className="group flex flex-col items-center gap-2.5 rounded-xl bg-card border border-border p-4 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-primary/20 active:scale-[0.97]"
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:shadow-md", mod.iconBg)}>
                <mod.icon className="w-5 h-5 text-white" />
              </div>
              <span className="text-xs font-semibold text-foreground text-center leading-tight">{mod.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">{mod.desc}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
