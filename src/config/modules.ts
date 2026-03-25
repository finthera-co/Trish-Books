import {
  BookOpen,
  FileText,
  Receipt,
  Calendar,
  Banknote,
  Wallet,
  Package,
  PiggyBank,
  DollarSign,
  TrendingUp,
  BarChart3,
  Shield,
  Users,
  UserCheck,
  Building2,
  Settings,
  CreditCard,
  FileArchive,
  Landmark,
  ShoppingCart,
  Briefcase,
  Box,
  Contact,
  Store,
  Lock,
  Warehouse,
  Calculator,
  ClipboardList,
  Layout,
} from "lucide-react";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";

export const MODULE_CONFIGS: Record<string, ModuleConfig> = {
  accounting: {
    id: "accounting",
    label: "Accounting",
    icon: BookOpen,
    color: "bg-primary",
    basePath: "/accounting",
    sidebarItems: [
      { label: "Chart of Accounts", path: "/accounting/accounts", icon: BookOpen },
      { label: "Journal Entries", path: "/accounting/journals", icon: FileText },
      { label: "General Ledger", path: "/accounting/ledger", icon: Receipt },
      { label: "Trial Balance", path: "/accounting/trial-balance", icon: FileText },
      { label: "Opening Balances", path: "/accounting/opening-balances", icon: Wallet },
      { label: "Close OBE", path: "/accounting/close-obe", icon: Lock },
      { label: "Fiscal Periods", path: "/accounting/fiscal-periods", icon: Calendar },
      { label: "GL Verification", path: "/accounting/gl-verify", icon: Shield },
    ],
  },
  banking: {
    id: "banking",
    label: "Banking",
    icon: Landmark,
    color: "bg-secondary",
    basePath: "/banking",
    sidebarItems: [
      { label: "Bank Reconciliation", path: "/banking/reconciliation", icon: Banknote },
      { label: "Payment Vouchers", path: "/banking/payment-vouchers", icon: FileText },
      { label: "Petty Cash", path: "/banking/petty-cash", icon: PiggyBank },
      { label: "Replenishments", path: "/banking/petty-cash/replenishments", icon: PiggyBank },
    ],
  },
  sales: {
    id: "sales",
    label: "Sales",
    icon: ShoppingCart,
    color: "bg-[hsl(var(--success))]",
    basePath: "/sales",
    sidebarItems: [
      { label: "Invoices", path: "/sales/invoices", icon: Wallet },
      { label: "Invoice Templates", path: "/sales/invoices/templates", icon: Layout },
      { label: "Products & Taxes", path: "/sales/products-taxes", icon: Package },
    ],
  },
  expenses: {
    id: "expenses",
    label: "Expenses",
    icon: Receipt,
    color: "bg-[hsl(var(--warning))]",
    basePath: "/expenses",
    sidebarItems: [
      { label: "Expense Tracker", path: "/expenses/tracker", icon: Banknote },
    ],
  },
  payroll: {
    id: "payroll",
    label: "Payroll",
    icon: DollarSign,
    color: "bg-[hsl(var(--info))]",
    basePath: "/payroll",
    sidebarItems: [
      { label: "Payroll Runs", path: "/payroll/runs", icon: DollarSign },
      { label: "Employees", path: "/payroll/employees", icon: UserCheck },
    ],
  },
  reports: {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    color: "bg-[hsl(var(--chart-5))]",
    basePath: "/reports",
    sidebarItems: [
      { label: "Financial Reports", path: "/reports/financial", icon: BarChart3 },
      { label: "Budgets", path: "/reports/budgets", icon: TrendingUp },
      { label: "Data Exports", path: "/reports/exports", icon: FileArchive },
      { label: "Intelligence Hub", path: "/reports/intelligence", icon: TrendingUp },
    ],
  },
  assets: {
    id: "assets",
    label: "Fixed Assets",
    icon: Warehouse,
    color: "bg-[hsl(var(--chart-4))]",
    basePath: "/assets",
    sidebarItems: [
      { label: "Asset Register", path: "/assets/register", icon: ClipboardList },
      { label: "Add Asset", path: "/assets/new", icon: Warehouse },
      { label: "Run Depreciation", path: "/assets/depreciation", icon: Calculator },
    ],
  },
  admin: {
    id: "admin",
    label: "Settings",
    icon: Settings,
    color: "bg-muted-foreground",
    basePath: "/admin",
    sidebarItems: [
      { label: "General Settings", path: "/admin/settings", icon: Settings },
      { label: "Users", path: "/admin/users", icon: Users },
      { label: "Tenants", path: "/admin/tenants", icon: Building2 },
      { label: "Subscriptions", path: "/admin/subscriptions", icon: CreditCard },
      { label: "Audit Logs", path: "/admin/audit-logs", icon: Shield },
    ],
  },
};

export interface ModuleCard {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  path: string;
}

export const HOME_MODULES: ModuleCard[] = [
  { id: "accounting", label: "Accounting", description: "Chart of accounts, journal entries, ledger & trial balance", icon: BookOpen, color: "bg-primary", path: "/accounting" },
  { id: "banking", label: "Banking", description: "Bank reconciliation, payment vouchers & petty cash", icon: Landmark, color: "bg-secondary", path: "/banking" },
  { id: "sales", label: "Sales", description: "Invoices, products, taxes & customer billing", icon: ShoppingCart, color: "bg-[hsl(var(--success))]", path: "/sales" },
  { id: "expenses", label: "Expenses", description: "Track and manage business expenses", icon: Receipt, color: "bg-[hsl(var(--warning))]", path: "/expenses" },
  { id: "payroll", label: "Payroll", description: "Process payroll, manage employees & pay schedules", icon: DollarSign, color: "bg-[hsl(var(--info))]", path: "/payroll" },
  { id: "reports", label: "Reports", description: "Financial reports, budgets & data exports", icon: BarChart3, color: "bg-[hsl(var(--chart-5))]", path: "/reports" },
  { id: "assets", label: "Fixed Assets", description: "Asset tracking, depreciation & disposal management", icon: Warehouse, color: "bg-[hsl(var(--chart-4))]", path: "/assets" },
  { id: "admin", label: "Settings", description: "Users, tenants, subscriptions & system config", icon: Settings, color: "bg-muted-foreground", path: "/admin" },
];
