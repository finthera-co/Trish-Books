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
  /** "trunk" = the backbone connecting one band's process into the next; renders
   *  bolder so the page reads as one continuous flow instead of separate bands.
   *  "reveal" = hidden by default, drawn only while one of its two endpoints is
   *  hovered — used for rail links, which would otherwise clutter the default
   *  view. Defaults to "branch" (the ordinary lighter intra-band line). */
  weight?: "trunk" | "branch" | "reveal";
}

export interface WorkflowBand {
  id: string;
  label: string; // band header pill text
  accentVar: string; // bare CSS var ref, e.g. "var(--warning)" — composed as hsl(var) at use sites
  nodes: WorkflowNode[];
  edges: WorkflowEdge[]; // intra-band edges only
}

export interface RailItem {
  id: string; // stable, unique across the whole map — same id-space as WorkflowNode
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
      // Closes the loop so AP Aging isn't a disconnected tile off to the side.
      { from: "pay-bills", to: "ap-aging", fromSide: "right", toSide: "left" },
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
      // Bridges the "sell" chain into the "collect / adjust / report" chain so
      // the whole band is one continuous line instead of two separate islands.
      { from: "receive-payment", to: "invoices", fromSide: "right", toSide: "left" },
      { from: "invoices", to: "credit-notes", fromSide: "right", toSide: "left" },
      { from: "credit-notes", to: "ar-aging", fromSide: "right", toSide: "left" },
      { from: "ar-aging", to: "products-taxes", fromSide: "right", toSide: "left" },
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

// The backbone of the whole canvas: each band's primary process chain feeds
// into the next band's, so Purchases -> Sales -> Employees reads as one
// continuous flow top-to-bottom rather than three separate diagrams. Source
// nodes are each band's natural terminus (the end of its core chain), not
// necessarily its rightmost column — e.g. AP Aging is a side report off
// Purchases, so the trunk still leaves from Pay Bills.
export const CROSS_BAND_EDGES: WorkflowEdge[] = [
  { from: "pay-bills", to: "customers", fromSide: "bottom", toSide: "top", weight: "trunk" },
  // Cash collected from customers is what funds payroll — the natural link
  // from the end of the core Sales chain into the start of Employees.
  { from: "receive-payment", to: "employees", fromSide: "bottom", toSide: "top", weight: "trunk" },
];

export const WORKFLOW_RAILS: RailGroup[] = [
  {
    id: "company",
    label: "Company",
    items: [
      { id: "coa", label: "Chart of Accounts", icon: BookOpen, path: "/accounting/accounts", moduleId: "/accounting/accounts" },
      { id: "journal-entries", label: "Journal Entries", icon: FileText, path: "/accounting/journals", moduleId: "/accounting/journals" },
      { id: "general-ledger", label: "General Ledger", icon: Receipt, path: "/accounting/ledger", moduleId: "/accounting/ledger" },
      { id: "trial-balance", label: "Trial Balance", icon: FileText, path: "/accounting/trial-balance", moduleId: "/accounting/trial-balance" },
      { id: "fiscal-periods", label: "Fiscal Periods", icon: Calendar, path: "/accounting/fiscal-periods", moduleId: "/accounting/fiscal-periods" },
      // CONFIRM 2: /accounting/inventory no longer exists — the Inventory
      // feature was removed this session, not just this one route, so the
      // item is dropped from the rail rather than rendered disabled.
      { id: "fixed-assets", label: "Fixed Assets", icon: Warehouse, path: "/assets/register", moduleId: "/assets/register" },
      { id: "rail-settings", label: "Settings", icon: Settings, path: "/settings/general", moduleId: "/settings/general" },
    ],
  },
  {
    id: "banking",
    label: "Banking",
    items: [
      { id: "bank-cards", label: "Bank & Cards", icon: Landmark, path: "/accounting/bank-accounts", moduleId: "/accounting/bank-accounts" },
      { id: "reconcile", label: "Reconcile", icon: Banknote, path: "/banking/reconciliation", moduleId: "/banking/reconciliation" },
      { id: "write-checks", label: "Write Checks", icon: FileText, path: "/banking/write-checks", moduleId: "/banking/write-checks" },
      { id: "petty-cash", label: "Petty Cash", icon: Coins, path: "/banking/petty-cash", moduleId: "/banking/petty-cash" },
      { id: "replenishments", label: "Replenishments", icon: RefreshCw, path: "/banking/petty-cash/replenishments", moduleId: "/banking/petty-cash/replenishments" },
    ],
  },
];

// Ties the utility rail into the same graph as the process bands — invisible
// by default (weight: "reveal"), drawn only when hovering one of the two
// endpoints, so the page shows "this step also touches the ledger/bank" on
// demand without cluttering the default view with a dozen permanent lines.
export const RAIL_EDGES: WorkflowEdge[] = [
  { from: "enter-bills", to: "journal-entries", fromSide: "right", toSide: "left", weight: "reveal" },
  { from: "create-invoice", to: "journal-entries", fromSide: "right", toSide: "left", weight: "reveal" },
  { from: "run-payroll", to: "journal-entries", fromSide: "right", toSide: "left", weight: "reveal" },
  { from: "pay-bills", to: "reconcile", fromSide: "right", toSide: "left", weight: "reveal" },
  { from: "receive-payment", to: "reconcile", fromSide: "right", toSide: "left", weight: "reveal" },
];
