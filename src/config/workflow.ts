import {
  type LucideIcon,
  Store,
  FileText,
  CreditCard,
  Package,
  Calendar,
  Contact,
  ClipboardList,
  Wallet,
  Receipt,
  RefreshCw,
  Box,
  UserCheck,
  Clock,
  DollarSign,
  AlertTriangle,
  BookOpen,
  Warehouse,
  Settings,
  Landmark,
  Banknote,
  Coins,
} from "lucide-react";

export interface WorkflowNode {
  id: string; // stable, unique across the whole map
  label: string; // 1–2 words, sentence case
  icon: LucideIcon;
  path: string | null; // null => "Soon" tile, not clickable
  moduleId: string; // passed directly to isModuleAllowed() — see note below
  col: number; // 1-based grid column within its band
  emphasis?: boolean; // primary action in the band (e.g. Create Invoice)
}

export interface WorkflowEdge {
  from: string; // node id
  to: string; // node id
  fromSide: "right" | "bottom";
  toSide: "left" | "top";
}

export interface WorkflowBand {
  id: string;
  label: string; // band header pill text
  accentVar: string; // bare CSS var ref, e.g. "var(--warning)" — composed as hsl(var) at use sites
  nodes: WorkflowNode[];
  edges: WorkflowEdge[]; // intra-band edges only
}

export interface RailItem {
  label: string;
  icon: LucideIcon;
  path: string;
  moduleId: string;
}
export interface RailGroup {
  id: string;
  label: string;
  items: RailItem[];
}

// ─────────────────────────────────────────────────────────────────────────
// moduleId note (CONFIRM 1): useSubscriptionLimits().isModuleAllowed(module)
// is called elsewhere in the app (AppSidebar, NavRail) with a ROUTE PATH, not
// a module-config key — it looks the path up in PATH_TO_MODULE and falls
// back to matching the raw string against the tenant's plan features. So
// every moduleId below is simply that node's own `path`, which makes
// `isModuleAllowed(node.moduleId)` behave exactly like the existing call
// sites. Soon-tile nodes (path: null) carry the path they would have if the
// route existed; it's inert since path === null already disables the tile.
// ─────────────────────────────────────────────────────────────────────────

export const WORKFLOW_BANDS: WorkflowBand[] = [
  {
    id: "purchases",
    label: "PURCHASES",
    accentVar: "var(--warning)",
    nodes: [
      { id: "vendors", label: "Vendors", icon: Store, path: "/accounting/vendors", moduleId: "/accounting/vendors", col: 1 },
      { id: "enter-bills", label: "Enter Bills", icon: FileText, path: "/accounting/bills", moduleId: "/accounting/bills", col: 2 },
      { id: "pay-bills", label: "Pay Bills", icon: CreditCard, path: "/accounting/bills?filter=unpaid", moduleId: "/accounting/bills", col: 3 },
      // CONFIRM 2: /accounting/procurement no longer exists (Inventory feature
      // removed this session) — rendered as a "Soon" tile rather than an
      // invented route.
      { id: "procurement", label: "Purchase Orders", icon: Package, path: null, moduleId: "/accounting/procurement", col: 4 },
      { id: "ap-aging", label: "AP Aging", icon: Calendar, path: "/accounting/ap-aging", moduleId: "/accounting/ap-aging", col: 5 },
    ],
    edges: [
      { from: "vendors", to: "enter-bills", fromSide: "right", toSide: "left" },
      { from: "enter-bills", to: "pay-bills", fromSide: "right", toSide: "left" },
      { from: "procurement", to: "enter-bills", fromSide: "right", toSide: "left" },
    ],
  },
  {
    id: "sales",
    label: "SALES",
    accentVar: "var(--success)",
    nodes: [
      // CONFIRM 2: /accounting/customers doesn't exist — the real customers
      // route is /sales/customers, so moduleId follows suit (was specified
      // as "accounting" in the brief; corrected to match the real path).
      { id: "customers", label: "Customers", icon: Contact, path: "/sales/customers", moduleId: "/sales/customers", col: 1 },
      { id: "quotations", label: "Quotations", icon: ClipboardList, path: "/sales/quotes", moduleId: "/sales/quotes", col: 2 },
      { id: "create-invoice", label: "Create Invoice", icon: Wallet, path: "/sales/invoices/new", moduleId: "/sales/invoices/new", col: 3, emphasis: true },
      { id: "receive-payment", label: "Receive Payment", icon: CreditCard, path: "/accounting/receive-payment", moduleId: "/accounting/receive-payment", col: 4 },
      { id: "invoices", label: "Invoices", icon: Receipt, path: "/sales/invoices", moduleId: "/sales/invoices", col: 5 },
      { id: "credit-notes", label: "Credit Notes", icon: RefreshCw, path: "/accounting/credit-notes", moduleId: "/accounting/credit-notes", col: 6 },
      { id: "ar-aging", label: "AR Aging", icon: Calendar, path: "/accounting/ar-aging", moduleId: "/accounting/ar-aging", col: 7 },
      { id: "products-taxes", label: "Items & Taxes", icon: Box, path: "/sales/products-taxes", moduleId: "/sales/products-taxes", col: 8 },
    ],
    edges: [
      { from: "customers", to: "quotations", fromSide: "right", toSide: "left" },
      { from: "quotations", to: "create-invoice", fromSide: "right", toSide: "left" },
      { from: "create-invoice", to: "receive-payment", fromSide: "right", toSide: "left" },
      { from: "invoices", to: "credit-notes", fromSide: "right", toSide: "left" },
    ],
  },
  {
    id: "employees",
    label: "EMPLOYEES",
    accentVar: "var(--info)",
    nodes: [
      { id: "employees", label: "Employees", icon: UserCheck, path: "/payroll/employees", moduleId: "/payroll/employees", col: 1 },
      { id: "enter-time", label: "Enter Time", icon: Clock, path: null, moduleId: "/payroll/enter-time", col: 2 },
      { id: "run-payroll", label: "Run Payroll", icon: DollarSign, path: "/payroll/runs", moduleId: "/payroll/runs", col: 3 },
      { id: "payroll-liabilities", label: "EPF / ETF / APIT", icon: AlertTriangle, path: "/payroll/liabilities", moduleId: "/payroll/liabilities", col: 4 },
    ],
    edges: [
      { from: "employees", to: "enter-time", fromSide: "right", toSide: "left" },
      { from: "enter-time", to: "run-payroll", fromSide: "right", toSide: "left" },
      { from: "run-payroll", to: "payroll-liabilities", fromSide: "right", toSide: "left" },
    ],
  },
];

export const CROSS_BAND_EDGES: WorkflowEdge[] = [
  { from: "pay-bills", to: "customers", fromSide: "bottom", toSide: "top" },
  // Omitted: run-payroll -> receive-payment (top->bottom). Employees is the
  // bottom-most band and Sales sits above it, so this edge would have to
  // travel back up past the Employees band header and across the Purchases/
  // Sales boundary — a long, crossing line with no real process meaning
  // (payroll and AR collection aren't a workflow step into one another). It
  // adds visual noise without adding information, so it stays out.
];

export const WORKFLOW_RAILS: RailGroup[] = [
  {
    id: "company",
    label: "Company",
    items: [
      { label: "Chart of Accounts", icon: BookOpen, path: "/accounting/accounts", moduleId: "/accounting/accounts" },
      { label: "Journal Entries", icon: FileText, path: "/accounting/journals", moduleId: "/accounting/journals" },
      { label: "General Ledger", icon: Receipt, path: "/accounting/ledger", moduleId: "/accounting/ledger" },
      { label: "Trial Balance", icon: FileText, path: "/accounting/trial-balance", moduleId: "/accounting/trial-balance" },
      { label: "Fiscal Periods", icon: Calendar, path: "/accounting/fiscal-periods", moduleId: "/accounting/fiscal-periods" },
      // CONFIRM 2: /accounting/inventory no longer exists — the Inventory
      // feature was removed this session, not just this one route, so the
      // item is dropped from the rail rather than rendered disabled.
      { label: "Fixed Assets", icon: Warehouse, path: "/assets/register", moduleId: "/assets/register" },
      { label: "Settings", icon: Settings, path: "/settings/general", moduleId: "/settings/general" },
    ],
  },
  {
    id: "banking",
    label: "Banking",
    items: [
      { label: "Bank & Cards", icon: Landmark, path: "/accounting/bank-accounts", moduleId: "/accounting/bank-accounts" },
      { label: "Reconcile", icon: Banknote, path: "/banking/reconciliation", moduleId: "/banking/reconciliation" },
      { label: "Write Checks", icon: FileText, path: "/banking/write-checks", moduleId: "/banking/write-checks" },
      { label: "Petty Cash", icon: Coins, path: "/banking/petty-cash", moduleId: "/banking/petty-cash" },
      { label: "Replenishments", icon: RefreshCw, path: "/banking/petty-cash/replenishments", moduleId: "/banking/petty-cash/replenishments" },
    ],
  },
];
