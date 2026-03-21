import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface AccountCategory {
  id: string;
  tenant_id: string;
  name: string;
  account_type: string;
  sort_order: number;
  created_at: string;
}

export function useAccountCategories() {
  return useQuery({
    queryKey: ["account_categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_categories")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as AccountCategory[];
    },
  });
}

export function useCreateAccountCategory() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (cat: { name: string; account_type: string; sort_order?: number }) => {
      const { data, error } = await supabase
        .from("account_categories")
        .insert({ ...cat, tenant_id: appUser?.tenant_id })
        .select()
        .single();
      if (error) throw error;
      return data as AccountCategory;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account_categories"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// QuickBooks-style categories with Current/Non-Current grouping
const DEFAULT_CATEGORIES: { name: string; account_type: string; sort_order: number }[] = [
  // Asset categories
  { name: "Current Assets", account_type: "Asset", sort_order: 1 },
  { name: "Non-Current Assets", account_type: "Asset", sort_order: 2 },
  // Liability categories
  { name: "Current Liabilities", account_type: "Liability", sort_order: 3 },
  { name: "Long-Term Liabilities", account_type: "Liability", sort_order: 4 },
  // Equity
  { name: "Owner's Equity", account_type: "Equity", sort_order: 5 },
  { name: "Retained Earnings", account_type: "Equity", sort_order: 6 },
  // Income
  { name: "Sales Revenue", account_type: "Income", sort_order: 7 },
  { name: "Service Revenue", account_type: "Income", sort_order: 8 },
  // COGS
  { name: "Cost of Materials", account_type: "Cost of Goods Sold", sort_order: 9 },
  // Expense
  { name: "Operating Expenses", account_type: "Expense", sort_order: 10 },
  { name: "Administrative Expenses", account_type: "Expense", sort_order: 11 },
  { name: "Payroll Expenses", account_type: "Expense", sort_order: 12 },
  // Other Income / Other Expense
  { name: "Other Income", account_type: "Other Income", sort_order: 13 },
  { name: "Other Expense", account_type: "Other Expense", sort_order: 14 },
];

interface DefaultAccount {
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype: string;
  category_name: string;
}

const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  // ─── Assets → Current Assets ───────────────────────────────
  { account_code: "1010", account_name: "Cash on Hand", account_type: "Asset", account_subtype: "Cash on Hand", category_name: "Current Assets" },
  { account_code: "1020", account_name: "Business Checking", account_type: "Asset", account_subtype: "Checking", category_name: "Current Assets" },
  { account_code: "1030", account_name: "Petty Cash", account_type: "Asset", account_subtype: "Cash on Hand", category_name: "Current Assets" },
  { account_code: "1040", account_name: "Savings Account", account_type: "Asset", account_subtype: "Savings", category_name: "Current Assets" },
  { account_code: "1100", account_name: "Accounts Receivable", account_type: "Asset", account_subtype: "Accounts Receivable", category_name: "Current Assets" },
  { account_code: "1200", account_name: "Inventory Asset", account_type: "Asset", account_subtype: "Inventory", category_name: "Current Assets" },
  { account_code: "1300", account_name: "Prepaid Expenses", account_type: "Asset", account_subtype: "Prepaid Expenses", category_name: "Current Assets" },
  { account_code: "1310", account_name: "Employee Advances", account_type: "Asset", account_subtype: "Other Current Assets", category_name: "Current Assets" },
  { account_code: "1400", account_name: "VAT Receivable", account_type: "Asset", account_subtype: "Other Current Assets", category_name: "Current Assets" },
  // ─── Assets → Non-Current Assets ──────────────────────────
  { account_code: "1500", account_name: "Land", account_type: "Asset", account_subtype: "Fixed Assets", category_name: "Non-Current Assets" },
  { account_code: "1510", account_name: "Buildings", account_type: "Asset", account_subtype: "Buildings", category_name: "Non-Current Assets" },
  { account_code: "1520", account_name: "Machinery", account_type: "Asset", account_subtype: "Fixed Assets", category_name: "Non-Current Assets" },
  { account_code: "1530", account_name: "Equipment", account_type: "Asset", account_subtype: "Furniture & Equipment", category_name: "Non-Current Assets" },
  { account_code: "1540", account_name: "Vehicles", account_type: "Asset", account_subtype: "Vehicles", category_name: "Non-Current Assets" },
  { account_code: "1550", account_name: "Furniture & Fixtures", account_type: "Asset", account_subtype: "Furniture & Equipment", category_name: "Non-Current Assets" },
  { account_code: "1600", account_name: "Accumulated Depreciation", account_type: "Asset", account_subtype: "Accumulated Depreciation", category_name: "Non-Current Assets" },
  { account_code: "1610", account_name: "Intangible Assets", account_type: "Asset", account_subtype: "Intangible Assets", category_name: "Non-Current Assets" },
  // ─── Liabilities → Current Liabilities ─────────────────────
  { account_code: "2000", account_name: "Accounts Payable", account_type: "Liability", account_subtype: "Accounts Payable", category_name: "Current Liabilities" },
  { account_code: "2100", account_name: "Salaries Payable", account_type: "Liability", account_subtype: "Payroll Liability", category_name: "Current Liabilities" },
  { account_code: "2110", account_name: "EPF Payable", account_type: "Liability", account_subtype: "Payroll Liability", category_name: "Current Liabilities" },
  { account_code: "2120", account_name: "ETF Payable", account_type: "Liability", account_subtype: "Payroll Liability", category_name: "Current Liabilities" },
  { account_code: "2200", account_name: "VAT Payable", account_type: "Liability", account_subtype: "Sales Tax Payable", category_name: "Current Liabilities" },
  { account_code: "2300", account_name: "Accrued Expenses", account_type: "Liability", account_subtype: "Other Current Liability", category_name: "Current Liabilities" },
  { account_code: "2400", account_name: "Short-Term Loans", account_type: "Liability", account_subtype: "Other Current Liability", category_name: "Current Liabilities" },
  // ─── Liabilities → Long-Term Liabilities ───────────────────
  { account_code: "2500", account_name: "Long-Term Loans", account_type: "Liability", account_subtype: "Long-Term Loan", category_name: "Long-Term Liabilities" },
  { account_code: "2510", account_name: "Mortgage Payable", account_type: "Liability", account_subtype: "Long-Term Loan", category_name: "Long-Term Liabilities" },
  { account_code: "2520", account_name: "Lease Liability", account_type: "Liability", account_subtype: "Long-Term Loan", category_name: "Long-Term Liabilities" },
  // ─── Equity ────────────────────────────────────────────────
  { account_code: "3010", account_name: "Owner Capital", account_type: "Equity", account_subtype: "Owner's Equity", category_name: "Owner's Equity" },
  { account_code: "3020", account_name: "Retained Earnings", account_type: "Equity", account_subtype: "Retained Earnings", category_name: "Retained Earnings" },
  { account_code: "3030", account_name: "Dividends Paid", account_type: "Equity", account_subtype: "Dividends", category_name: "Owner's Equity" },
  { account_code: "3900", account_name: "Opening Balance Equity", account_type: "Equity", account_subtype: "Opening Balance Equity", category_name: "Owner's Equity" },
  // ─── Income ────────────────────────────────────────────────
  { account_code: "4010", account_name: "Sales Revenue", account_type: "Income", account_subtype: "Sales Revenue", category_name: "Sales Revenue" },
  { account_code: "4020", account_name: "Service Revenue", account_type: "Income", account_subtype: "Service Revenue", category_name: "Service Revenue" },
  { account_code: "4030", account_name: "Discounts Given", account_type: "Income", account_subtype: "Discount", category_name: "Sales Revenue" },
  // ─── COGS ──────────────────────────────────────────────────
  { account_code: "5010", account_name: "Cost of Goods Sold", account_type: "Cost of Goods Sold", account_subtype: "Cost of Materials", category_name: "Cost of Materials" },
  { account_code: "5020", account_name: "Cost of Labour", account_type: "Cost of Goods Sold", account_subtype: "Cost of Labour", category_name: "Cost of Materials" },
  { account_code: "5030", account_name: "Shipping & Delivery", account_type: "Cost of Goods Sold", account_subtype: "Shipping & Delivery", category_name: "Cost of Materials" },
  // ─── Expenses ──────────────────────────────────────────────
  { account_code: "6100", account_name: "Salaries & Wages", account_type: "Expense", account_subtype: "Payroll Expenses", category_name: "Payroll Expenses" },
  { account_code: "6110", account_name: "Employer EPF Contribution", account_type: "Expense", account_subtype: "Payroll Expenses", category_name: "Payroll Expenses" },
  { account_code: "6120", account_name: "Employer ETF Contribution", account_type: "Expense", account_subtype: "Payroll Expenses", category_name: "Payroll Expenses" },
  { account_code: "6200", account_name: "Rent Expense", account_type: "Expense", account_subtype: "Rent", category_name: "Operating Expenses" },
  { account_code: "6210", account_name: "Utilities Expense", account_type: "Expense", account_subtype: "Utilities", category_name: "Operating Expenses" },
  { account_code: "6220", account_name: "Insurance Expense", account_type: "Expense", account_subtype: "Insurance", category_name: "Operating Expenses" },
  { account_code: "6300", account_name: "Advertising & Marketing", account_type: "Expense", account_subtype: "Advertising", category_name: "Operating Expenses" },
  { account_code: "6400", account_name: "Office Supplies", account_type: "Expense", account_subtype: "Office Supplies", category_name: "Administrative Expenses" },
  { account_code: "6410", account_name: "Professional Fees", account_type: "Expense", account_subtype: "Professional Fees", category_name: "Administrative Expenses" },
  { account_code: "6500", account_name: "Depreciation Expense", account_type: "Expense", account_subtype: "Depreciation", category_name: "Operating Expenses" },
  { account_code: "6600", account_name: "Bank Charges & Fees", account_type: "Expense", account_subtype: "Bank Charges", category_name: "Administrative Expenses" },
  { account_code: "6700", account_name: "Travel & Transport", account_type: "Expense", account_subtype: "Travel & Transport", category_name: "Operating Expenses" },
  { account_code: "6800", account_name: "Repairs & Maintenance", account_type: "Expense", account_subtype: "Repairs & Maintenance", category_name: "Operating Expenses" },
  { account_code: "6900", account_name: "Meals & Entertainment", account_type: "Expense", account_subtype: "Meals & Entertainment", category_name: "Operating Expenses" },
  { account_code: "7000", account_name: "Taxes & Licences", account_type: "Expense", account_subtype: "Taxes & Licences", category_name: "Operating Expenses" },
  // ─── Other Income ──────────────────────────────────────────
  { account_code: "8010", account_name: "Interest Income", account_type: "Other Income", account_subtype: "Interest Earned", category_name: "Other Income" },
  { account_code: "8020", account_name: "Gain on Sale of Assets", account_type: "Other Income", account_subtype: "Gain on Sale of Assets", category_name: "Other Income" },
  { account_code: "8030", account_name: "Miscellaneous Income", account_type: "Other Income", account_subtype: "Miscellaneous Income", category_name: "Other Income" },
  { account_code: "8040", account_name: "Dividend Income", account_type: "Other Income", account_subtype: "Dividend Income", category_name: "Other Income" },
  // ─── Other Expense ─────────────────────────────────────────
  { account_code: "9010", account_name: "Interest Expense", account_type: "Other Expense", account_subtype: "Interest Expense", category_name: "Other Expense" },
  { account_code: "9020", account_name: "Loss on Sale of Assets", account_type: "Other Expense", account_subtype: "Loss on Sale of Assets", category_name: "Other Expense" },
  { account_code: "9030", account_name: "Penalties & Fines", account_type: "Other Expense", account_subtype: "Penalties & Fines", category_name: "Other Expense" },
  { account_code: "9040", account_name: "Miscellaneous Expense", account_type: "Other Expense", account_subtype: "Miscellaneous Expense", category_name: "Other Expense" },
];

export function useSeedDefaultAccounts() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const tenantId = appUser.tenant_id;

      // Check if categories already exist
      const { data: existing } = await supabase
        .from("account_categories")
        .select("id")
        .eq("tenant_id", tenantId)
        .limit(1);
      if (existing && existing.length > 0) {
        throw new Error("Default accounts already seeded for this tenant. Delete existing categories first to re-seed.");
      }

      // Insert categories
      const { data: cats, error: catErr } = await supabase
        .from("account_categories")
        .insert(DEFAULT_CATEGORIES.map(c => ({ ...c, tenant_id: tenantId })))
        .select();
      if (catErr) throw catErr;

      // Build category map
      const catMap = new Map<string, string>();
      cats.forEach((c: any) => catMap.set(c.name, c.id));

      // Insert accounts with subtypes
      const accountRows = DEFAULT_ACCOUNTS.map(a => ({
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
        account_subtype: a.account_subtype,
        category_id: catMap.get(a.category_name) || null,
        tenant_id: tenantId,
      }));

      const { error: accErr } = await supabase.from("accounts").insert(accountRows);
      if (accErr) throw accErr;

      return { categories: cats.length, accounts: accountRows.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["account_categories"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      toast.success(`Seeded ${result.categories} categories and ${result.accounts} accounts`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
