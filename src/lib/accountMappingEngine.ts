/**
 * Dynamic Account Mapping Engine
 * 
 * Centralizes all account mapping, routing, inheritance, validation,
 * and enforcement logic. Never depends on account names — only on
 * type, parent, subledger flags, and metadata.
 */

// ─── Subledger Type Enum ──────────────────────────────────
export type SubledgerType =
  | "customer"
  | "vendor"
  | "inventory"
  | "fixed_asset"
  | "asset_depreciation"
  | "none";

// ─── Account Shape (minimal interface) ────────────────────
export interface MappableAccount {
  id: string;
  account_type: string;
  account_subtype?: string | null;
  parent_account_id?: string | null;
  is_control_account?: boolean;
  subledger_type?: string | null;
  requires_subledger?: boolean;
  is_system?: boolean;
  is_locked?: boolean;
}

// ─── Route Map (no hardcoded names) ───────────────────────
const SUBLEDGER_ROUTES: Record<string, string> = {
  customer: "/sales/customers",
  vendor: "/accounting/vendors",
  inventory: "/accounting/inventory",
  fixed_asset: "/assets/register",
  asset_depreciation: "/assets/depreciation",
};

const SUBLEDGER_MODULE_LABELS: Record<string, string> = {
  customer: "Customers",
  vendor: "Vendors",
  inventory: "Inventory Items",
  fixed_asset: "Fixed Assets",
  asset_depreciation: "Depreciation Schedule",
};

const SUBLEDGER_JE_HINTS: Record<string, string> = {
  customer: "Use an invoice or receive payment instead",
  vendor: "Use a bill or payment voucher instead",
  inventory: "Use an inventory adjustment instead",
  fixed_asset: "Use the asset module instead",
  asset_depreciation: "Use the depreciation run instead",
};

// ─── Subtype → Subledger Type Detection ───────────────────
// Works for default accounts, imported accounts, renamed accounts.
// Never relies on account_name.
export function detectSubledgerType(subtype: string | null | undefined): SubledgerType {
  if (!subtype) return "none";
  const lower = subtype.toLowerCase();
  if (lower.includes("accounts receivable") || lower === "receivable") return "customer";
  if (lower.includes("accounts payable") || lower === "payable") return "vendor";
  if (lower.includes("inventory")) return "inventory";
  if (lower.includes("accumulated depreciation")) return "asset_depreciation";
  if (
    lower.includes("fixed asset") ||
    lower.includes("furniture") ||
    lower.includes("vehicle") ||
    lower.includes("building")
  ) return "fixed_asset";
  return "none";
}

// ─── Derive Full Subledger Metadata ───────────────────────
export function deriveAccountFlags(subtype: string | null | undefined): {
  is_control_account: boolean;
  requires_subledger: boolean;
  subledger_type: SubledgerType;
  allow_sub_accounts: boolean;
  allow_manual_posting: boolean;
  allow_opening_balance: boolean;
  managed_by_subledger: boolean;
} {
  const stype = detectSubledgerType(subtype);
  const isControl = stype !== "none";
  // AR, AP, Inventory cannot have GL sub-accounts
  const noSubAccounts = ["customer", "vendor", "inventory"].includes(stype);
  return {
    is_control_account: isControl,
    requires_subledger: isControl,
    subledger_type: stype,
    allow_sub_accounts: !noSubAccounts,
    allow_manual_posting: !isControl,
    allow_opening_balance: !isControl,
    managed_by_subledger: isControl,
  };
}

// ─── Resolve Effective Subledger Type (with inheritance) ──
export function resolveSubledgerType(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>
): SubledgerType {
  // Priority 1: own subledger type
  const own = effectiveSubledgerType(account);
  if (own !== "none") return own;

  // Priority 2: walk up parent chain
  let current = account;
  while (current.parent_account_id) {
    const parent = accountsMap.get(current.parent_account_id);
    if (!parent) break;
    const parentType = effectiveSubledgerType(parent);
    if (parentType !== "none") return parentType;
    current = parent;
  }

  return "none";
}

function effectiveSubledgerType(account: MappableAccount): SubledgerType {
  if (account.subledger_type && account.subledger_type !== "none") {
    return account.subledger_type as SubledgerType;
  }
  return detectSubledgerType(account.account_subtype);
}

// ─── Priority-Based Route Resolution ──────────────────────
export function mapAccountRoute(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>
): string {
  const stype = resolveSubledgerType(account, accountsMap);

  if (stype === "none") {
    return `/accounting/ledger?account=${account.id}`;
  }

  const baseRoute = SUBLEDGER_ROUTES[stype];
  if (!baseRoute) return `/accounting/ledger?account=${account.id}`;

  // If this is a child of a control account (e.g., asset category),
  // route with account filter
  const ownType = effectiveSubledgerType(account);
  if (ownType === "none") {
    // inherited — pass account filter
    return `${baseRoute}?account_id=${account.id}`;
  }

  return baseRoute;
}

// ─── Module Label Resolution ──────────────────────────────
export function getModuleLabel(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>
): string | null {
  const stype = resolveSubledgerType(account, accountsMap);
  return SUBLEDGER_MODULE_LABELS[stype] || null;
}

// ─── Journal Entry Hint ───────────────────────────────────
export function getJournalEntryHint(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>
): string | null {
  const stype = resolveSubledgerType(account, accountsMap);
  return SUBLEDGER_JE_HINTS[stype] || null;
}

// ─── Is Account a Control Account ─────────────────────────
export function isAccountControlled(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>
): boolean {
  return resolveSubledgerType(account, accountsMap) !== "none";
}

// ─── Is Direct Control (not inherited) ────────────────────
export function isDirectControl(account: MappableAccount): boolean {
  return effectiveSubledgerType(account) !== "none";
}

// ─── Validation: Can Create Child ─────────────────────────
export function canCreateChildUnder(
  parent: MappableAccount,
  _accountsMap: Map<string, MappableAccount>
): { allowed: boolean; reason?: string } {
  const stype = effectiveSubledgerType(parent);
  if (["customer", "vendor", "inventory"].includes(stype)) {
    return {
      allowed: false,
      reason: `Sub-accounts are not allowed under ${SUBLEDGER_MODULE_LABELS[stype] || "this"} control accounts. Use the subledger module instead.`,
    };
  }
  return { allowed: true };
}

// ─── Validation: Can Post Journal Entry ───────────────────
export function canPostJournalTo(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>,
  entityIds?: { customer_id?: string; vendor_id?: string; item_id?: string; asset_id?: string }
): { allowed: boolean; reason?: string } {
  const stype = resolveSubledgerType(account, accountsMap);
  if (stype === "none") return { allowed: true };

  // Control account requires entity reference
  const entityMap: Record<string, string> = {
    customer: "customer_id",
    vendor: "vendor_id",
    inventory: "item_id",
    fixed_asset: "asset_id",
    asset_depreciation: "asset_id",
  };

  const requiredKey = entityMap[stype];
  if (!requiredKey) return { allowed: true };

  if (!entityIds || !(entityIds as any)[requiredKey]) {
    const hint = SUBLEDGER_JE_HINTS[stype] || "Use the appropriate transaction form";
    return {
      allowed: false,
      reason: `Subledger required for this control account. ${hint}.`,
    };
  }

  return { allowed: true };
}

// ─── Validation: Can Set Opening Balance ──────────────────
export function canSetOpeningBalance(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>
): { allowed: boolean; reason?: string } {
  const stype = resolveSubledgerType(account, accountsMap);
  if (stype === "none") return { allowed: true };

  const entityLabel: Record<string, string> = {
    customer: "customer",
    vendor: "vendor",
    inventory: "inventory item",
    fixed_asset: "asset",
    asset_depreciation: "asset",
  };

  return {
    allowed: false,
    reason: `Opening balance must be set through the ${entityLabel[stype] || "entity"} module, not directly on the control account.`,
  };
}

// ─── Validation: Can Delete Account ───────────────────────
export function canDeleteAccount(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>,
  context?: { hasChildren?: boolean; hasTransactions?: boolean; hasSubledgerEntries?: boolean }
): { allowed: boolean; reason?: string } {
  if (account.is_system) {
    return { allowed: false, reason: "System accounts cannot be deleted." };
  }
  if (context?.hasChildren) {
    return { allowed: false, reason: "Account has sub-accounts. Remove them first." };
  }
  if (context?.hasTransactions) {
    return { allowed: false, reason: "Account has posted transactions." };
  }
  if (context?.hasSubledgerEntries) {
    return { allowed: false, reason: "Account has subledger entries." };
  }
  return { allowed: true };
}

// ─── Validation: Can Edit Account Type ────────────────────
export function canEditAccountType(
  account: MappableAccount,
  accountsMap: Map<string, MappableAccount>
): { allowed: boolean; reason?: string } {
  if (isDirectControl(account)) {
    return {
      allowed: false,
      reason: "Cannot change the type of a control account.",
    };
  }
  return { allowed: true };
}

// ─── Validation: Can Reclassify Parent ────────────────────
export function canReclassifyParent(
  account: MappableAccount,
  newParent: MappableAccount | null,
  accountsMap: Map<string, MappableAccount>
): { allowed: boolean; reason?: string } {
  if (!newParent) return { allowed: true }; // moving to top-level is fine

  // Can't move under a no-sub-accounts control
  const check = canCreateChildUnder(newParent, accountsMap);
  if (!check.allowed) return check;

  // Type must match
  if (newParent.account_type !== account.account_type) {
    return {
      allowed: false,
      reason: "Cannot move an account under a parent of a different account type.",
    };
  }

  return { allowed: true };
}

// ─── Inheritance Propagation ──────────────────────────────
export function inheritParentFlags(
  parent: MappableAccount,
  accountsMap: Map<string, MappableAccount>
): Partial<{
  subledger_type: SubledgerType;
  managed_by_subledger: boolean;
  requires_subledger: boolean;
}> {
  const stype = resolveSubledgerType(parent, accountsMap);
  if (stype === "none") return {};
  return {
    subledger_type: stype,
    managed_by_subledger: true,
    requires_subledger: true,
  };
}

// ─── Import Detection ─────────────────────────────────────
// Auto-detect subledger from imported account type strings
export function detectSubledgerFromImportType(importType: string): SubledgerType {
  const lower = importType.toLowerCase().trim();
  if (lower.includes("receivable") || lower === "ar") return "customer";
  if (lower.includes("payable") || lower === "ap") return "vendor";
  if (lower.includes("inventory") || lower === "stock") return "inventory";
  if (lower.includes("depreciation") || lower.includes("accum")) return "asset_depreciation";
  if (lower.includes("fixed asset") || lower.includes("property") || lower.includes("equipment")) return "fixed_asset";
  return "none";
}

// ─── Build Account Map Utility ────────────────────────────
export function buildAccountsMap(accounts: MappableAccount[]): Map<string, MappableAccount> {
  const map = new Map<string, MappableAccount>();
  for (const a of accounts) {
    map.set(a.id, a);
  }
  return map;
}

// ─── Cache Invalidation Keys ──────────────────────────────
export const GLOBAL_INVALIDATION_KEYS = [
  "accounts",
  "chart_of_accounts",
  "trial_balance",
  "balance_sheet",
  "profit_loss",
  "general_ledger",
] as const;

export const SUBLEDGER_INVALIDATION_MAP: Record<string, string[]> = {
  customer: ["customers", "customers_with_balance", "ar_subledger", "ar_aging"],
  vendor: ["vendors", "vendors_with_balance", "ap_subledger", "ap_aging"],
  inventory: ["inventory_items", "inventory_items_enhanced", "inventory_subledger"],
  fixed_asset: ["fixed_assets", "asset_subledger"],
  asset_depreciation: ["fixed_assets", "asset_depreciation", "asset_subledger"],
};

/** Get all query keys that should be invalidated when an account's subledger changes */
export function getInvalidationKeys(subledgerType: SubledgerType): string[] {
  return [
    ...GLOBAL_INVALIDATION_KEYS,
    ...(SUBLEDGER_INVALIDATION_MAP[subledgerType] || []),
  ];
}
