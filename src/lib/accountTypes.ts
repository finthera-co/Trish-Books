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

/**
 * Statement-of-financial-position classification. LKAS 1.60 splits assets and
 * liabilities into current and non-current on the face of the statement, and
 * the detail type is what decides which side an account lands on — an account
 * *type* of "Asset" says nothing about whether it is realised within the
 * operating cycle.
 *
 * Matching is case-insensitive and by substring, so both the canonical
 * ACCOUNT_SUBTYPES entries and the longer variants tenants type by hand
 * ("Fixed Assets", "Property, Plant & Equipment") resolve the same way.
 */
export const NON_CURRENT_ASSET_SUBTYPES = [
  "Fixed Asset",
  "Property, Plant",
  "Property Plant",
  "Furniture",
  "Vehicle",
  "Building",
  "Machinery",
  "Land",
  "Intangible",
  "Accumulated Depreciation",
  "Accumulated Amortisation",
  "Accumulated Amortization",
  "Investment",
];

export const NON_CURRENT_LIABILITY_SUBTYPES = [
  "Long-term",
  "Long Term",
  "Long-Term",
  "Non-current",
  "Noncurrent",
  "Lease Liability",
  "Deferred Tax",
];

const matchesAny = (value: string | null | undefined, needles: string[]): boolean => {
  if (!value) return false;
  const v = value.toLowerCase();
  return needles.some(n => v.includes(n.toLowerCase()));
};

/** True when an Asset account's detail type places it outside current assets. */
export function isNonCurrentAssetSubtype(subtype: string | null | undefined): boolean {
  return matchesAny(subtype, NON_CURRENT_ASSET_SUBTYPES);
}

/** True when a Liability account's detail type places it outside current liabilities. */
export function isNonCurrentLiabilitySubtype(subtype: string | null | undefined): boolean {
  return matchesAny(subtype, NON_CURRENT_LIABILITY_SUBTYPES);
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

  // Code is the one identifier that can't collide with anything else, so it
  // always wins outright. Name/subtype only count on a system-provisioned
  // account (the real OBE account is always is_system) — otherwise a user
  // naming or tagging their own account "Opening Balance Equity" (there's no
  // "Share Capital" subtype to pick instead) gets treated as THE tenant's
  // OBE account everywhere this helper is used: its own opening balance
  // display gets silently overwritten with the real OBE account's balance
  // (ChartOfAccounts.tsx), and it's excluded from the opening-balance form's
  // account list (OpeningBalances.tsx).
  if (code === "3900") return true;
  if (!account.is_system) return false;
  return name === "opening balance equity" || subtype === "opening balance equity";
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

// QuickBooks-style sub-bands WITHIN each account type, keyed by subtype.
// [min, max] inclusive. Top-level accounts step by 100, children by 10,
// so there is always room to insert a new account between two existing ones.
export const ACCOUNT_SUBTYPE_BANDS: Record<string, { min: number; max: number }> = {
  // ── Assets 1000–1999 ──────────────────────────────────────────────
  // Current assets 1000–1499
  "Cash on Hand":            { min: 1000, max: 1049 },
  "Checking":                { min: 1050, max: 1099 },
  "Savings":                 { min: 1100, max: 1149 },
  "Bank":                    { min: 1100, max: 1149 },
  "Accounts Receivable":     { min: 1200, max: 1249 },
  "Inventory":               { min: 1300, max: 1349 },
  "Prepaid Expenses":        { min: 1400, max: 1449 },
  "Other Current Assets":    { min: 1450, max: 1499 },
  // Long-term / fixed assets 1500–1999
  "Fixed Assets":            { min: 1500, max: 1549 },
  "Furniture & Equipment":   { min: 1550, max: 1599 },
  "Vehicles":                { min: 1600, max: 1649 },
  "Buildings":               { min: 1700, max: 1749 },
  "Accumulated Depreciation":{ min: 1800, max: 1849 },
  "Intangible Assets":       { min: 1900, max: 1949 },

  // ── Liabilities 2000–2999 ─────────────────────────────────────────
  // Current liabilities 2000–2499
  "Accounts Payable":        { min: 2000, max: 2049 },
  "Credit Card":             { min: 2100, max: 2149 },
  "Payroll Liability":       { min: 2200, max: 2299 },
  "Sales Tax Payable":       { min: 2300, max: 2349 },
  "Other Current Liability": { min: 2350, max: 2499 },
  // Long-term liabilities 2500–2999
  "Long-term Liability":     { min: 2500, max: 2699 },
  "Long-Term Loan":          { min: 2700, max: 2899 },

  // ── Equity 3000–3999 ──────────────────────────────────────────────
  "Owner's Equity":          { min: 3000, max: 3099 },
  "Partner's Equity":        { min: 3100, max: 3199 },
  "Retained Earnings":       { min: 3200, max: 3299 },
  "Dividends":               { min: 3300, max: 3399 },
  "Opening Balance Equity":  { min: 3900, max: 3900 }, // fixed, by convention

  // ── Income 4000–4999 ──────────────────────────────────────────────
  "Sales of Product":        { min: 4000, max: 4199 },
  "Sales Revenue":           { min: 4000, max: 4199 },
  "Service Income":          { min: 4200, max: 4399 },
  "Service Revenue":         { min: 4200, max: 4399 },
  "Discount":                { min: 4800, max: 4849 },
  "Other Revenue":           { min: 4850, max: 4999 },

  // ── Cost of Goods Sold 5000–5999 ──────────────────────────────────
  "Cost of Materials":       { min: 5000, max: 5199 },
  "Cost of Labour":          { min: 5200, max: 5399 },
  "Shipping & Delivery":     { min: 5400, max: 5499 },
  "Other COGS":              { min: 5500, max: 5999 },

  // ── Expenses 6000–7999 ────────────────────────────────────────────
  "Advertising":             { min: 6000, max: 6049 },
  "Bank Charges":            { min: 6050, max: 6099 },
  "Rent":                    { min: 6100, max: 6149 },
  "Utilities":               { min: 6150, max: 6199 },
  "Supplies":                { min: 6200, max: 6249 },
  "Office Supplies":         { min: 6200, max: 6249 },
  "Insurance":               { min: 6300, max: 6349 },
  "Payroll Expenses":        { min: 6400, max: 6599 },
  "Professional Fees":       { min: 6600, max: 6649 },
  "Travel & Transport":      { min: 6700, max: 6749 },
  "Depreciation":            { min: 6800, max: 6849 },
  "Repairs & Maintenance":   { min: 6900, max: 6949 },
  "Taxes & Licences":        { min: 7000, max: 7049 },
  "Meals & Entertainment":   { min: 7100, max: 7149 },
  "Other Expense":           { min: 7800, max: 7999 },

  // ── Other Income 8000–8999 ────────────────────────────────────────
  "Interest Earned":         { min: 8000, max: 8199 },
  "Dividend Income":         { min: 8200, max: 8399 },
  "Gain on Sale of Assets":  { min: 8400, max: 8599 },
  "Miscellaneous Income":    { min: 8600, max: 8999 },

  // ── Other Expense 9000–9999 ───────────────────────────────────────
  "Interest Expense":        { min: 9000, max: 9199 },
  "Loss on Sale of Assets":  { min: 9200, max: 9399 },
  "Penalties & Fines":       { min: 9400, max: 9599 },
  "Miscellaneous Expense":   { min: 9600, max: 9999 },
};

/**
 * Detail types available for an account type: the built-in master list plus
 * any custom detail type the tenant has already used on an account of that
 * type. Custom entries are listed after the built-ins so the standard
 * QuickBooks-style options stay on top.
 */
export function getSubtypesForType(
  accountType: string,
  accounts?: { account_type: string; account_subtype?: string | null }[] | null,
): string[] {
  const master = ACCOUNT_SUBTYPES[accountType] || [];
  if (!accounts?.length) return master;

  const seen = new Set(master.map(s => s.toLowerCase()));
  const custom: string[] = [];
  for (const a of accounts) {
    if (a.account_type !== accountType) continue;
    const st = a.account_subtype?.trim();
    if (!st) continue;
    const key = st.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    custom.push(st);
  }
  custom.sort((a, b) => a.localeCompare(b));
  return [...master, ...custom];
}

/** Return the sub-band for a subtype, or null if none is mapped. */
export function getSubtypeBand(subtype: string | null | undefined): { min: number; max: number } | null {
  if (!subtype) return null;
  return ACCOUNT_SUBTYPE_BANDS[subtype] || null;
}

/**
 * Suggest a sensible default detail type (subtype) based on the account
 * number range and account type. Used by the "Quick Setup" action in the
 * Chart of Accounts form so users never end up with uncategorized accounts.
 * Returns null when no confident suggestion can be made — caller should
 * fall back to the first available subtype for the account type.
 */
export function suggestSubtypeFromCode(
  accountCode: string | number | null | undefined,
  accountType: string,
): string | null {
  const code = parseInt(String(accountCode ?? ""), 10);
  const subs = ACCOUNT_SUBTYPES[accountType] || [];
  const pick = (name: string): string | null =>
    subs.find(s => s.toLowerCase() === name.toLowerCase()) || null;

  if (!Number.isFinite(code)) return subs[0] || null;

  // Asset 1000–1999
  if (accountType === "Asset") {
    if (code >= 1000 && code <= 1099) return pick("Cash on Hand");
    if (code >= 1100 && code <= 1149) return pick("Checking");
    if (code >= 1150 && code <= 1199) return pick("Savings");
    if (code >= 1200 && code <= 1299) return pick("Accounts Receivable");
    if (code >= 1300 && code <= 1399) return pick("Inventory");
    if (code >= 1400 && code <= 1499) return pick("Prepaid Expenses");
    if (code >= 1500 && code <= 1599) return pick("Furniture & Equipment");
    if (code >= 1600 && code <= 1699) return pick("Vehicles");
    if (code >= 1700 && code <= 1799) return pick("Buildings");
    if (code >= 1800 && code <= 1899) return pick("Accumulated Depreciation");
    if (code >= 1900 && code <= 1999) return pick("Intangible Assets");
    return pick("Other Current Assets");
  }

  // Liability 2000–2999
  if (accountType === "Liability") {
    if (code >= 2000 && code <= 2099) return pick("Accounts Payable");
    if (code >= 2100 && code <= 2199) return pick("Credit Card");
    if (code >= 2200 && code <= 2399) return pick("Other Current Liability");
    if (code >= 2400 && code <= 2599) return pick("Payroll Liability");
    if (code >= 2600 && code <= 2699) return pick("Sales Tax Payable");
    if (code >= 2700 && code <= 2899) return pick("Long-term Liability");
    if (code >= 2900 && code <= 2999) return pick("Long-Term Loan");
    return pick("Other Current Liability");
  }

  // Equity 3000–3999
  if (accountType === "Equity") {
    if (code === 3900) return pick("Opening Balance Equity");
    if (code >= 3000 && code <= 3099) return pick("Owner's Equity");
    if (code >= 3100 && code <= 3199) return pick("Retained Earnings");
    if (code >= 3200 && code <= 3299) return pick("Partner's Equity");
    if (code >= 3300 && code <= 3399) return pick("Dividends");
    return pick("Owner's Equity");
  }

  // Income 4000–4999
  if (accountType === "Income") {
    if (code >= 4000 && code <= 4399) return pick("Sales Revenue");
    if (code >= 4400 && code <= 4499) return pick("Sales of Product");
    if (code >= 4500 && code <= 4799) return pick("Service Revenue");
    if (code >= 4800 && code <= 4899) return pick("Discount");
    if (code >= 4900 && code <= 4999) return pick("Other Revenue");
    return pick("Sales Revenue");
  }

  // COGS 5000–5999
  if (accountType === "Cost of Goods Sold") {
    if (code >= 5000 && code <= 5299) return pick("Cost of Materials");
    if (code >= 5300 && code <= 5499) return pick("Cost of Labour");
    if (code >= 5500 && code <= 5699) return pick("Shipping & Delivery");
    return pick("Other COGS");
  }

  // Expense 6000–7999
  if (accountType === "Expense") {
    if (code >= 6000 && code <= 6099) return pick("Advertising");
    if (code >= 6100 && code <= 6199) return pick("Bank Charges");
    if (code >= 6200 && code <= 6299) return pick("Rent");
    if (code >= 6300 && code <= 6399) return pick("Utilities");
    if (code >= 6400 && code <= 6499) return pick("Supplies");
    if (code >= 6500 && code <= 6599) return pick("Insurance");
    if (code >= 6600 && code <= 6699) return pick("Payroll Expenses");
    if (code >= 6700 && code <= 6799) return pick("Office Supplies");
    if (code >= 6800 && code <= 6899) return pick("Professional Fees");
    if (code >= 6900 && code <= 6999) return pick("Travel & Transport");
    if (code >= 7000 && code <= 7099) return pick("Depreciation");
    if (code >= 7100 && code <= 7199) return pick("Repairs & Maintenance");
    if (code >= 7200 && code <= 7299) return pick("Taxes & Licences");
    if (code >= 7300 && code <= 7399) return pick("Meals & Entertainment");
    return pick("Other Expense");
  }

  // Other Income 8000–8999
  if (accountType === "Other Income") {
    if (code >= 8000 && code <= 8199) return pick("Interest Earned");
    if (code >= 8200 && code <= 8399) return pick("Dividend Income");
    if (code >= 8400 && code <= 8599) return pick("Gain on Sale of Assets");
    return pick("Miscellaneous Income");
  }

  // Other Expense 9000–9999
  if (accountType === "Other Expense") {
    if (code >= 9000 && code <= 9199) return pick("Interest Expense");
    if (code >= 9200 && code <= 9399) return pick("Loss on Sale of Assets");
    if (code >= 9400 && code <= 9599) return pick("Penalties & Fines");
    return pick("Miscellaneous Expense");
  }

  return subs[0] || null;
}

// Control accounts that cannot be posted to directly.
// Accumulated Depreciation is deliberately absent: it is a contra account whose
// opening balance is a plain trial-balance figure at migration, and depreciation
// runs, impairments and disposals all post to it directly.
export const CONTROL_ACCOUNT_SUBTYPES = [
  "Accounts Receivable",
  "Accounts Payable",
  "Inventory",
  "Fixed Assets",
  "Furniture & Equipment",
  "Vehicles",
  "Buildings",
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
    case "customer": return "/sales/customers";
    case "vendor": return "/accounting/vendors";
    case "inventory": return "/accounting/inventory";
    case "fixed_asset": return "/assets/register";
    case "asset_depreciation": return "/assets/depreciation";
    default: return null;
  }
}

// Subtypes that require sub-ledger breakdown for opening balances
export const SUBLEDGER_SUBTYPES = [
  "Accounts Receivable",
  "Accounts Payable",
  "Inventory",
  "Fixed Assets",
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
  return { requires_subledger: false, subledger_type: "none" };
}
