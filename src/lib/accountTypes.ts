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

export function getNormalBalance(accountType: string): "Debit" | "Credit" {
  return isDebitNormal(accountType) ? "Debit" : "Credit";
}

// Financial statement placement
export function getStatementPlacement(accountType: string): "Balance Sheet" | "Profit & Loss" {
  if (["Asset", "Liability", "Equity"].includes(accountType)) return "Balance Sheet";
  return "Profit & Loss";
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

// QuickBooks-style detail types (subtypes) per account type
export const ACCOUNT_SUBTYPES: Record<string, string[]> = {
  Asset: [
    "Bank",
    "Accounts Receivable",
    "Other Current Assets",
    "Fixed Assets",
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
    "Sales Revenue",
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
export const CONTROL_ACCOUNTS = [
  "Accounts Receivable",
  "Accounts Payable",
  "Inventory",
];

export function isControlSubtype(subtype: string | null | undefined): boolean {
  if (!subtype) return false;
  return CONTROL_ACCOUNTS.some(c => subtype.toLowerCase().includes(c.toLowerCase()));
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
