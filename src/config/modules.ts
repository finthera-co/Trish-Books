import {
  BookOpen,
  FileText,
  Receipt,
  Calendar,
  Banknote,
  Wallet,
  Package,
  Coins,
  RefreshCw,
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
  Activity,
  AlertTriangle,
} from "lucide-react";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";

export const MODULE_CONFIGS: Record<string, ModuleConfig> = {
  /* ═══════════════════════════════════════════
     SUPER ADMIN — Control Plane
     ═══════════════════════════════════════════ */
  superadmin: {
    id: "superadmin",
    label: "Control Plane",
    icon: Shield,
    color: "bg-muted-foreground",
    basePath: "/admin",
    sidebarItems: [
      { label: "Companies", path: "/admin/tenants", icon: Building2 },
      { label: "Company Admins", path: "/admin/company-admins", icon: UserCheck },
      { label: "Users (Read-only)", path: "/admin/users", icon: Users },
      { label: "System Analytics", path: "/admin/analytics", icon: Activity },
      { label: "Audit Logs", path: "/admin/audit-logs", icon: Shield },
      { label: "Error Logs", path: "/admin/error-logs", icon: AlertTriangle },
      { label: "Subscriptions", path: "/admin/subscriptions", icon: CreditCard },
    ],
  },

  /* ═══════════════════════════════════════════
     TENANT MODULES — Business Operations
     ═══════════════════════════════════════════ */
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
      { label: "Customers", path: "/accounting/customers", icon: Contact },
      { label: "Receive Payment", path: "/accounting/receive-payment", icon: CreditCard },
      { label: "Credit Notes", path: "/accounting/credit-notes", icon: Receipt },
      { label: "AR Aging", path: "/accounting/ar-aging", icon: Calendar },
      { label: "Vendors", path: "/accounting/vendors", icon: Store },
      { label: "Inventory", path: "/accounting/inventory", icon: Package },
      { label: "Bank & Cards", path: "/accounting/bank-accounts", icon: Landmark },
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
      { label: "Petty Cash", path: "/banking/petty-cash", icon: Coins },
      { label: "Replenishments", path: "/banking/petty-cash/replenishments", icon: RefreshCw },
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
      { label: "Forecasting", path: "/reports/forecasting", icon: TrendingUp },
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
      { label: "Asset Categories", path: "/assets/categories", icon: Box },
      { label: "Run Depreciation", path: "/assets/depreciation", icon: Calculator },
    ],
  },
  tenantAdmin: {
    id: "tenantAdmin",
    label: "Settings",
    icon: Settings,
    color: "bg-muted-foreground",
    basePath: "/settings",
    sidebarItems: [
      { label: "General Settings", path: "/settings/general", icon: Settings },
      { label: "Users", path: "/settings/users", icon: Users },
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

/** Module cards shown on the tenant home page */
export const HOME_MODULES: ModuleCard[] = [
  { id: "accounting", label: "Accounting", description: "Chart of accounts, journal entries, ledger & trial balance", icon: BookOpen, color: "bg-primary", path: "/accounting" },
  { id: "banking", label: "Banking", description: "Bank reconciliation, payment vouchers & petty cash", icon: Landmark, color: "bg-secondary", path: "/banking" },
  { id: "sales", label: "Sales", description: "Invoices, products, taxes & customer billing", icon: ShoppingCart, color: "bg-[hsl(var(--success))]", path: "/sales" },
  { id: "expenses", label: "Expenses", description: "Track and manage business expenses", icon: Receipt, color: "bg-[hsl(var(--warning))]", path: "/expenses" },
  { id: "payroll", label: "Payroll", description: "Process payroll, manage employees & pay schedules", icon: DollarSign, color: "bg-[hsl(var(--info))]", path: "/payroll" },
  { id: "reports", label: "Reports", description: "Financial reports, budgets & data exports", icon: BarChart3, color: "bg-[hsl(var(--chart-5))]", path: "/reports" },
  { id: "assets", label: "Fixed Assets", description: "Asset tracking, depreciation & disposal management", icon: Warehouse, color: "bg-[hsl(var(--chart-4))]", path: "/assets" },
  { id: "tenantAdmin", label: "Settings", description: "Users & system configuration", icon: Settings, color: "bg-muted-foreground", path: "/settings" },
];

/** Module cards shown on the Super Admin home page */
export const SUPER_ADMIN_MODULES: ModuleCard[] = [
  { id: "tenants", label: "Companies", description: "Manage SaaS tenants and company provisioning", icon: Building2, color: "bg-primary", path: "/admin/tenants" },
  { id: "admins", label: "Company Admins", description: "Manage company administrator accounts", icon: UserCheck, color: "bg-secondary", path: "/admin/company-admins" },
  { id: "users", label: "Users", description: "Read-only overview of all system users", icon: Users, color: "bg-[hsl(var(--info))]", path: "/admin/users" },
  { id: "analytics", label: "System Analytics", description: "SaaS-level metrics and usage trends", icon: Activity, color: "bg-[hsl(var(--success))]", path: "/admin/analytics" },
  { id: "audit", label: "Audit Logs", description: "Track all system actions and changes", icon: Shield, color: "bg-[hsl(var(--warning))]", path: "/admin/audit-logs" },
  { id: "errors", label: "Error Logs", description: "System error monitoring and resolution", icon: AlertTriangle, color: "bg-destructive", path: "/admin/error-logs" },
  { id: "subscriptions", label: "Subscriptions", description: "Manage subscription plans", icon: CreditCard, color: "bg-muted-foreground", path: "/admin/subscriptions" },
];
