import { NavLink, useLocation, useNavigate } from "react-router-dom";
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
  ChevronDown,
  Package,
  DollarSign,
  FileArchive,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

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
      { label: "Fiscal Periods", path: "/fiscal-periods", icon: Calendar },
    ],
  },
  {
    label: "Billing",
    items: [
      { label: "Invoices", path: "/invoices", icon: Wallet },
      { label: "Products & Taxes", path: "/products-taxes", icon: Package },
      { label: "Expenses", path: "/expenses", icon: Banknote },
      { label: "Petty Cash", path: "/petty-cash", icon: PiggyBank },
    ],
  },
  {
    label: "Planning",
    items: [
      { label: "Budgeting", path: "/budgets", icon: TrendingUp },
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const toggleGroup = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <aside className="w-64 min-h-screen bg-sidebar flex flex-col border-r border-sidebar-border">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          <span className="text-lg font-semibold text-sidebar-foreground">AccuBooks</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-2">
            <button
              onClick={() => toggleGroup(group.label)}
              className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/70"
            >
              {group.label}
              <ChevronDown
                className={`w-3 h-3 transition-transform ${
                  collapsed[group.label] ? "-rotate-90" : ""
                }`}
              />
            </button>
            {!collapsed[group.label] && (
              <div className="mt-1 space-y-0.5">
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={`sidebar-item ${
                        isActive ? "sidebar-item-active" : "sidebar-item-inactive"
                      }`}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <button onClick={handleSignOut} className="sidebar-item sidebar-item-inactive w-full">
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
