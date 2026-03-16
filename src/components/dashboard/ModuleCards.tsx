import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ArrowRight, BookOpen, Landmark, ShoppingCart, Receipt, DollarSign, BarChart3, FileText, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const MODULES = [
  { id: "customers", label: "Customers", desc: "Manage customer records", icon: Users, path: "/sales/invoices", gradient: "from-[hsl(200,98%,39%)] to-[hsl(210,80%,50%)]" },
  { id: "suppliers", label: "Suppliers", desc: "Vendor & supplier management", icon: Receipt, path: "/expenses/tracker", gradient: "from-[hsl(38,92%,50%)] to-[hsl(28,90%,48%)]" },
  { id: "invoices", label: "Invoices", desc: "Create & track invoices", icon: FileText, path: "/sales/invoices", gradient: "from-[hsl(142,71%,35%)] to-[hsl(152,60%,40%)]" },
  { id: "bills", label: "Bills", desc: "Bills & payment vouchers", icon: Landmark, path: "/banking/payment-vouchers", gradient: "from-[hsl(270,60%,50%)] to-[hsl(280,50%,55%)]" },
  { id: "payroll", label: "Payroll", desc: "Process payroll runs", icon: DollarSign, path: "/payroll/runs", gradient: "from-[hsl(199,89%,48%)] to-[hsl(209,80%,55%)]" },
  { id: "bank", label: "Bank Accounts", desc: "Reconciliation & banking", icon: Landmark, path: "/banking/reconciliation", gradient: "from-[hsl(215,24%,26%)] to-[hsl(225,20%,35%)]" },
  { id: "reports", label: "Reports", desc: "Financial reports & analytics", icon: BarChart3, path: "/reports/financial", gradient: "from-[hsl(0,72%,50%)] to-[hsl(350,65%,55%)]" },
  { id: "journals", label: "Journal Entries", desc: "Double-entry bookkeeping", icon: BookOpen, path: "/accounting/journals", gradient: "from-[hsl(198,93%,59%)] to-[hsl(215,60%,55%)]" },
];

export default function ModuleCards() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      {MODULES.map((mod) => (
        <Tooltip key={mod.id}>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate(mod.path)}
              className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-1 hover:border-primary/30 active:scale-95"
            >
              <div className={cn("w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center shadow-sm transition-transform duration-200 group-hover:scale-110", mod.gradient)}>
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
