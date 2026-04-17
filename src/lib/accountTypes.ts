// QuickBooks-style account type definitions
// These define the 8 primary account types used throughout the system

export const ACCOUNT_TYPES = [
  "Asset",
  "Liability",
  "Equity",
  "Income",
  "Cost of Goods Sold",
  "Expense",
  "Other Income",
  "Other Expense",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Account types that carry a normal debit balance
export const DEBIT_NORMAL_TYPES: AccountType[] = [
  "Asset",
  "Cost of Goods Sold",
  "Expense",
  "Other Expense",
];

export function isDebitNormal(accountType: string): boolean {
  return DEBIT_NORMAL_TYPES.includes(accountType as AccountType);
}

/**
 * Subtypes that represent contra accounts. A contra account inverts the
 * normal balance of its parent type (e.g. Accumulated Depreciation is a
 * contra-asset and therefore has a Credit normal balance).
 */
export const CONTRA_SUBTYPES = [
  "Accumulated Depreciation",
];

export function isContraSubtype(subtype: string | null | undefined): boolean {
  if (!subtype) return false;
  return CONTRA_SUBTYPES.some(s => subtype.toLowerCase().includes(s.toLowerCase()));
}

/** Detects contra accounts from either an explicit flag, name or subtype. */
export function isContraAccount(account?: {
  is_contra?: boolean | null;
  account_name?: string | null;
  account_subtype?: string | null;
} | null): boolean {
  if (!account) return false;
  if (account.is_contra) return true;
  if (isContraSubtype(account.account_subtype)) return true;
  if (account.account_name && account.account_name.toLowerCase().includes("accumulated depreciation")) return true;
  return false;
}

export function getNormalBalance(accountType: string, isContra = false): "Debit" | "Credit" {
  const debit = isDebitNormal(accountType);
  const effective = isContra ? !debit : debit;
  return effective ? "Debit" : "Credit";
}

/** Display label for an account type, accounting for contra classification. */
export function getAccountTypeLabel(accountType: string, isContra = false): string {
  if (!isContra) return accountType;
  if (accountType === "Asset") return "Contra Asset";
  if (accountType === "Liability") return "Contra Liability";
  if (accountType === "Equity") return "Contra Equity";
  if (accountType === "Income" || accountType === "Other Income") return "Contra Income";
  if (accountType === "Expense" || accountType === "Other Expense" || accountType === "Cost of Goods Sold") return "Contra Expense";
  return accountType;
}

// Financial statement placement
export function getStatementPlacement(accountType: string): "Balance Sheet" | "Profit & Loss" {
  if (["Asset", "Liability", "Equity"].includes(accountType)) return "Balance Sheet";
  return "Profit & Loss";
}

/**
 * Reporting behavior:
 * - Balance Sheet accounts (Asset, Liability, Equity) are CUMULATIVE — they carry
 *   forward across periods and have meaningful opening/closing balances.
 * - Income Statement accounts (Income, Expense, COGS, Other Income, Other Expense)
 *   are PERIOD-BASED — they reset each fiscal year via closing entries and should
 *   NOT display "Opening Balance" semantics in P&L-style reports.
 *
 * This helper is used by the Reporting Layer (AccountReport, Ledger, P&L) to
 * decide whether to show cumulative or period-only views. The underlying ledger
 * (journal_entries / journal_lines) is unchanged — this is presentation only.
 */
export function isPeriodBasedAccount(accountType: string): boolean {
  return getStatementPlacement(accountType) === "Profit & Loss";
}

// Opening balance eligibility — only Balance Sheet accounts may have opening balances
export const OPENING_BALANCE_ELIGIBLE_TYPES: AccountType[] = [
  "Asset",
  "Liability",
  "Equity",
];

export function isOpeningBalanceEligible(accountType: string): boolean {
  return OPENING_BALANCE_ELIGIBLE_TYPES.includes(accountType as AccountType);
}

export const OPENING_BALANCE_INELIGIBLE_REASON =
  "Opening balances are not allowed for Income or Expense accounts. These accounts start from zero for the selected accounting period.";

// Account type → badge color (uses semantic tokens)
export const typeColors: Record<string, string> = {
  Asset: "bg-info/10 text-info",
  Liability: "bg-warning/10 text-warning",
  Equity: "bg-primary/10 text-primary",
  Income: "bg-success/10 text-success",
  "Cost of Goods Sold": "bg-accent/80 text-accent-foreground",
  Expense: "bg-destructive/10 text-destructive",
  "Other Income": "bg-success/5 text-success/80",
  "Other Expense": "bg-destructive/5 text-destructive/80",
};

// Short labels for UI display
export const typeShortLabels: Record<string, string> = {
  "Cost of Goods Sold": "COGS",
  "Other Income": "Other Inc.",
  "Other Expense": "Other Exp.",
};

export function getTypeLabel(accountType: string): string {
  return typeShortLabels[accountType] || accountType;
}

export interface AccountIdentity {
  account_code?: string | null;
  account_name?: string | null;
  account_subtype?: string | null;
  is_system?: boolean | null;
}

export function isOpeningBalanceEquityAccount(account?: AccountIdentity | null): boolean {
  if (!account) return false;

  const code = account.account_code?.trim();
  const name = account.account_name?.trim().toLowerCase();
  const subtype = account.account_subtype?.trim().toLowerCase();

  return code === "3900" || name === "opening balance equity" || subtype === "opening balance equity";
}

// QuickBooks-style detail types (subtypes) per account type
export const ACCOUNT_SUBTYPES: Record<string, string[]> = {
  Asset: [
    "Cash on Hand",
    "Checking",
    "Savings",
    "Bank",
    "Accounts Receivable",
    "Other Current Assets",
    "Fixed Assets",
    "Furniture & Equipment",
    "Vehicles",
    "Buildings",
    "Inventory",
    "Prepaid Expenses",
    "Intangible Assets",
    "Accumulated Depreciation",
  ],
  Liability: [
    "Accounts Payable",
    "Credit Card",
    "Other Current Liability",
    "Long-term Liability",
    "Long-Term Loan",
    "Payroll Liability",
    "Sales Tax Payable",
  ],
  Equity: [
    "Owner's Equity",
    "Retained Earnings",
    "Opening Balance Equity",
    "Partner's Equity",
    "Dividends",
  ],
  Income: [
    "Sales of Product",
    "Sales Revenue",
    "Service Income",
    "Service Revenue",
    "Discount",
    "Other Revenue",
  ],
  "Cost of Goods Sold": [
    "Cost of Materials",
    "Cost of Labour",
    "Shipping & Delivery",
    "Other COGS",
  ],
  Expense: [
    "Advertising",
    "Bank Charges",
    "Rent",
    "Utilities",
    "Supplies",
    "Insurance",
    "Payroll Expenses",
    "Office Supplies",
    "Professional Fees",
    "Travel & Transport",
    "Depreciation",
    "Repairs & Maintenance",
    "Taxes & Licences",
    "Meals & Entertainment",
    "Other Expense",
  ],
  "Other Income": [
    "Interest Earned",
    "Dividend Income",
    "Gain on Sale of Assets",
    "Miscellaneous Income",
  ],
  "Other Expense": [
    "Interest Expense",
    "Loss on Sale of Assets",
    "Penalties & Fines",
    "Miscellaneous Expense",
  ],
};

// Recommended account number ranges
export const ACCOUNT_NUMBER_RANGES: Record<string, { min: number; max: number }> = {
  Asset: { min: 1000, max: 1999 },
  Liability: { min: 2000, max: 2999 },
  Equity: { min: 3000, max: 3999 },
  Income: { min: 4000, max: 4999 },
  "Cost of Goods Sold": { min: 5000, max: 5999 },
  Expense: { min: 6000, max: 7999 },
  "Other Income": { min: 8000, max: 8999 },
  "Other Expense": { min: 9000, max: 9999 },
};

// Control accounts that cannot be posted to directly
export const CONTROL_ACCOUNT_SUBTYPES = [
  "Accounts Receivable",
  "Accounts Payable",
  "Inventory",
  "Fixed Assets",
  "Furniture & Equipment",
  "Vehicles",
  "Buildings",
  "Accumulated Depreciation",
];

// Control account subtypes that do NOT allow sub-accounts (must use subledger only)
export const NO_SUB_ACCOUNTS_SUBTYPES = [
  "Accounts Receivable",
  "Accounts Payable",
  "Inventory",
];

/** Check if an account subtype allows sub-accounts underneath it */
export function allowsSubAccounts(subtype: string | null | undefined): boolean {
  if (!subtype) return true;
  return !NO_SUB_ACCOUNTS_SUBTYPES.some(s => subtype.toLowerCase().includes(s.toLowerCase()));
}

export function isControlSubtype(subtype: string | null | undefined): boolean {
  if (!subtype) return false;
  return CONTROL_ACCOUNT_SUBTYPES.some(c => subtype.toLowerCase().includes(c.toLowerCase()));
}

/** Check if an account is a control account based on its subtype */
export function isControlAccount(accountSubtype: string | null | undefined): boolean {
  return isControlSubtype(accountSubtype);
}

/** Get the subledger module label for a control account */
export function getControlAccountModule(subledgerType: string | null | undefined): string | null {
  if (!subledgerType) return null;
  switch (subledgerType) {
    case "customer": return "Customers";
    case "vendor": return "Vendors";
    case "inventory": return "Inventory Items";
    case "fixed_asset": return "Fixed Assets";
    case "asset_depreciation": return "Depreciation Schedule";
    default: return null;
  }
}

/** Get the route for a control account's subledger module */
export function getControlAccountRoute(subledgerType: string | null | undefined): string | null {
  if (!subledgerType) return null;
  switch (subledgerType) {
    case "customer": return "/accounting/customers";
    case "vendor": return "/accounting/vendors";
    case "inventory": return "/accounting/inventory";
    case "fixed_asset": return "/accounting/assets";
    case "asset_depreciation": return "/accounting/assets/depreciation";
    default: return null;
  }
}

// Subtypes that require sub-ledger breakdown for opening balances
export const SUBLEDGER_SUBTYPES = [
  "Accounts Receivable",
  "Accounts Payable",
  "Inventory",
  "Fixed Assets",
  "Accumulated Depreciation",
];

export function requiresSubledger(subtype: string | null | undefined): boolean {
  if (!subtype) return false;
  return SUBLEDGER_SUBTYPES.some(s => subtype.toLowerCase().includes(s.toLowerCase()));
}

/** Derive requires_subledger and subledger_type from account_subtype */
export function deriveSubledgerFields(accountSubtype: string | null | undefined): {
  requires_subledger: boolean;
  subledger_type: string;
} {
  if (!accountSubtype) return { requires_subledger: false, subledger_type: "none" };
  const lower = accountSubtype.toLowerCase();
  if (lower.includes("accounts receivable") || lower === "receivable") {
    return { requires_subledger: true, subledger_type: "customer" };
  }
  if (lower.includes("accounts payable") || lower === "payable") {
    return { requires_subledger: true, subledger_type: "vendor" };
  }
  if (lower.includes("inventory")) {
    return { requires_subledger: true, subledger_type: "inventory" };
  }
  if (lower.includes("fixed asset") || lower.includes("furniture") || lower.includes("vehicle") || lower.includes("building")) {
    return { requires_subledger: true, subledger_type: "fixed_asset" };
  }
  if (lower.includes("accumulated depreciation")) {
    return { requires_subledger: true, subledger_type: "asset_depreciation" };
  }
  return { requires_subledger: false, subledger_type: "none" };
}
