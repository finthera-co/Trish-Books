import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { HOME_MODULES } from "@/config/modules";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Plus, Search, ArrowRight } from "lucide-react";
import { useMyPermissions } from "@/hooks/usePermissions";

// Map module IDs to permission keys
const MODULE_PERMISSION_MAP: Record<string, string> = {
  accounting: "accounts",
  banking: "banking",
  sales: "sales",
  expenses: "expenses",
  payroll: "payroll",
  reports: "reports",
  admin: "settings",
};

export default function Home() {
  const { appUser } = useAuth();
  const { canView } = useMyPermissions();
  const navigate = useNavigate();

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Welcome back, {appUser?.first_name || "User"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {format(new Date(), "EEEE, MMMM d, yyyy")} · Select a module to get started.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => navigate("/accounting/journals")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Journal Entry
        </button>
        <button
          onClick={() => navigate("/sales/invoices")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-card border border-border text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Invoice
        </button>
        <button
          onClick={() => navigate("/expenses/tracker")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-card border border-border text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Log Expense
        </button>
      </div>

      {/* Module Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {HOME_MODULES.map((mod) => (
          <button
            key={mod.id}
            onClick={() => navigate(mod.path)}
            className="group text-left bg-card border border-border rounded-xl p-5 hover:shadow-lg hover:border-primary/30 transition-all duration-200 hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", mod.color)}>
                <mod.icon className="w-5 h-5 text-primary-foreground" />
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{mod.label}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">{mod.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
