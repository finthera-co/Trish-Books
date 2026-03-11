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

const DEFAULT_CATEGORIES: { name: string; account_type: string; sort_order: number }[] = [
  { name: "Current Assets", account_type: "Asset", sort_order: 1 },
  { name: "Non-Current Assets", account_type: "Asset", sort_order: 2 },
  { name: "Current Liabilities", account_type: "Liability", sort_order: 3 },
  { name: "Non-Current Liabilities", account_type: "Liability", sort_order: 4 },
  { name: "Owner Equity", account_type: "Equity", sort_order: 5 },
  { name: "Retained Earnings", account_type: "Equity", sort_order: 6 },
  { name: "Operating Revenue", account_type: "Revenue", sort_order: 7 },
  { name: "Other Income", account_type: "Revenue", sort_order: 8 },
  { name: "Cost of Goods Sold", account_type: "Expense", sort_order: 9 },
  { name: "Operating Expenses", account_type: "Expense", sort_order: 10 },
  { name: "Administrative Expenses", account_type: "Expense", sort_order: 11 },
];

interface DefaultAccount {
  account_code: string;
  account_name: string;
  account_type: string;
  category_name: string;
}

const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  // Current Assets
  { account_code: "1010", account_name: "Cash", account_type: "Asset", category_name: "Current Assets" },
  { account_code: "1020", account_name: "Bank Account", account_type: "Asset", category_name: "Current Assets" },
  { account_code: "1030", account_name: "Petty Cash", account_type: "Asset", category_name: "Current Assets" },
  { account_code: "1100", account_name: "Accounts Receivable", account_type: "Asset", category_name: "Current Assets" },
  { account_code: "1200", account_name: "Inventory", account_type: "Asset", category_name: "Current Assets" },
  { account_code: "1300", account_name: "Prepaid Expenses", account_type: "Asset", category_name: "Current Assets" },
  { account_code: "1400", account_name: "VAT Receivable", account_type: "Asset", category_name: "Current Assets" },
  // Non-Current Assets
  { account_code: "1500", account_name: "Land", account_type: "Asset", category_name: "Non-Current Assets" },
  { account_code: "1510", account_name: "Buildings", account_type: "Asset", category_name: "Non-Current Assets" },
  { account_code: "1520", account_name: "Machinery", account_type: "Asset", category_name: "Non-Current Assets" },
  { account_code: "1530", account_name: "Equipment", account_type: "Asset", category_name: "Non-Current Assets" },
  { account_code: "1540", account_name: "Vehicles", account_type: "Asset", category_name: "Non-Current Assets" },
  { account_code: "1550", account_name: "Furniture & Fixtures", account_type: "Asset", category_name: "Non-Current Assets" },
  { account_code: "1560", account_name: "Intangible Assets", account_type: "Asset", category_name: "Non-Current Assets" },
  { account_code: "1600", account_name: "Accumulated Depreciation", account_type: "Asset", category_name: "Non-Current Assets" },
  // Current Liabilities
  { account_code: "2010", account_name: "Accounts Payable", account_type: "Liability", category_name: "Current Liabilities" },
  { account_code: "2020", account_name: "Salaries Payable", account_type: "Liability", category_name: "Current Liabilities" },
  { account_code: "2030", account_name: "Taxes Payable", account_type: "Liability", category_name: "Current Liabilities" },
  { account_code: "2040", account_name: "VAT Payable", account_type: "Liability", category_name: "Current Liabilities" },
  { account_code: "2050", account_name: "Short-term Loans", account_type: "Liability", category_name: "Current Liabilities" },
  { account_code: "2060", account_name: "Accrued Expenses", account_type: "Liability", category_name: "Current Liabilities" },
  // Non-Current Liabilities
  { account_code: "2500", account_name: "Long-term Loans", account_type: "Liability", category_name: "Non-Current Liabilities" },
  { account_code: "2510", account_name: "Mortgage Payable", account_type: "Liability", category_name: "Non-Current Liabilities" },
  { account_code: "2520", account_name: "Lease Liability", account_type: "Liability", category_name: "Non-Current Liabilities" },
  // Equity
  { account_code: "3010", account_name: "Owner Capital", account_type: "Equity", category_name: "Owner Equity" },
  { account_code: "3020", account_name: "Retained Earnings", account_type: "Equity", category_name: "Retained Earnings" },
  { account_code: "3030", account_name: "Dividends", account_type: "Equity", category_name: "Owner Equity" },
  // Revenue
  { account_code: "4010", account_name: "Sales Revenue", account_type: "Revenue", category_name: "Operating Revenue" },
  { account_code: "4020", account_name: "Service Revenue", account_type: "Revenue", category_name: "Operating Revenue" },
  { account_code: "4510", account_name: "Interest Income", account_type: "Revenue", category_name: "Other Income" },
  // Expenses
  { account_code: "5010", account_name: "Cost of Goods Sold", account_type: "Expense", category_name: "Cost of Goods Sold" },
  { account_code: "5100", account_name: "Salaries Expense", account_type: "Expense", category_name: "Operating Expenses" },
  { account_code: "5110", account_name: "Rent Expense", account_type: "Expense", category_name: "Operating Expenses" },
  { account_code: "5120", account_name: "Utilities Expense", account_type: "Expense", category_name: "Operating Expenses" },
  { account_code: "5130", account_name: "Advertising Expense", account_type: "Expense", category_name: "Operating Expenses" },
  { account_code: "5140", account_name: "Depreciation Expense", account_type: "Expense", category_name: "Operating Expenses" },
  { account_code: "5500", account_name: "Bank Charges", account_type: "Expense", category_name: "Administrative Expenses" },
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

      // Insert accounts
      const accountRows = DEFAULT_ACCOUNTS.map(a => ({
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
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
      toast.success(`Seeded ${result.categories} categories and ${result.accounts} accounts`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
