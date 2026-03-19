import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Users,
  UserCheck,
  BookOpen,
  FileText,
  Receipt,
  Wallet,
  Banknote,
  PiggyBank,
  BarChart3,
  TrendingUp,
  Shield,
  CreditCard,
  Settings,
  LogOut,
  Package,
  DollarSign,
  FileArchive,
  Calendar,
  Lock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { NavLink } from "@/components/NavLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", path: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Tenants", path: "/tenants", icon: Building2 },
      { label: "Users", path: "/users", icon: Users },
      { label: "Employees", path: "/employees", icon: UserCheck },
    ],
  },
  {
    label: "Accounting",
    items: [
      { label: "Chart of Accounts", path: "/accounts", icon: BookOpen },
      { label: "Journal Entries", path: "/journals", icon: FileText },
      { label: "Ledger", path: "/ledger", icon: Receipt },
      { label: "Trial Balance", path: "/trial-balance", icon: FileText },
      { label: "Bank Reconciliation", path: "/bank-reconciliation", icon: Banknote },
      { label: "Fiscal Periods", path: "/fiscal-periods", icon: Calendar },
    ],
  },
  {
    label: "Billing",
    items: [
      { label: "Invoices", path: "/invoices", icon: Wallet },
      { label: "Products & Taxes", path: "/products-taxes", icon: Package },
      { label: "Expenses", path: "/expenses", icon: Banknote },
      { label: "Payment Vouchers", path: "/payment-vouchers", icon: FileText },
      { label: "Petty Cash", path: "/petty-cash", icon: PiggyBank },
    ],
  },
  {
    label: "Planning",
    items: [
      { label: "Budgeting", path: "/budgets", icon: TrendingUp },
      { label: "Anomaly Detection", path: "/reports/anomalies", icon: Shield },
      { label: "Payroll", path: "/payroll", icon: DollarSign },
      { label: "Reports", path: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Audit Logs", path: "/audit-logs", icon: Shield },
      { label: "Subscriptions", path: "/subscriptions", icon: CreditCard },
      { label: "Data Exports", path: "/exports", icon: FileArchive },
      { label: "Settings", path: "/settings", icon: Settings },
    ],
  },
];

export default function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { isModuleAllowed, planName } = useSubscriptionLimits();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-8 h-8 shrink-0 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="text-lg font-semibold text-sidebar-foreground truncate">
              AccuBooks
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group) => {
          const groupHasActive = group.items.some(
            (i) => location.pathname === i.path
          );
          return (
            <SidebarGroup key={group.label}>
              {!collapsed && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.path;
                    const allowed = isModuleAllowed(item.path);

                    if (!allowed) {
                      return (
                        <SidebarMenuItem key={item.path}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/40 cursor-not-allowed">
                                <item.icon className="w-[18px] h-[18px] shrink-0" />
                                {!collapsed && (
                                  <>
                                    <span className="truncate flex-1">{item.label}</span>
                                    <Lock className="w-3 h-3 shrink-0" />
                                  </>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <p className="text-xs">
                                Upgrade from <strong>{planName}</strong> to access
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </SidebarMenuItem>
                      );
                    }

                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <NavLink
                            to={item.path}
                            className="hover:bg-sidebar-accent/10"
                            activeClassName="bg-primary text-primary-foreground font-medium"
                          >
                            <item.icon className="w-[18px] h-[18px] shrink-0" />
                            {!collapsed && <span className="truncate">{item.label}</span>}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {planName && !collapsed && (
          <div className="px-3 py-2">
            <div className="rounded-lg bg-muted/20 border border-border/30 px-3 py-2 text-center">
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
                Current Plan
              </p>
              <p className="text-sm font-semibold text-sidebar-foreground">
                {planName}
              </p>
            </div>
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut}>
              <LogOut className="w-4 h-4 shrink-0" />
              {!collapsed && <span>Sign Out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
