import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AccountDependencies {
  journalLines: number;
  budgetItems: number;
  bankFeedTransactions: number;
  bankReconciliations: number;
  fixedAssets: number;
  expenseCategories: number;
  transactions: number;
  openingBalances: number;
  openingBalanceDetails: number;
  childAccounts: number;
  total: number;
}

export async function checkAccountDependencies(accountId: string): Promise<AccountDependencies> {
  const [
    journalLines,
    budgetItems,
    bankFeedTxns,
    bankReconciliations,
    fixedAssets,
    expenseCategories,
    transactions,
    openingBalances,
    openingBalanceDetails,
    childAccounts,
  ] = await Promise.all([
    supabase.from("journal_lines").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    supabase.from("budget_items").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    supabase.from("bank_feed_transactions").select("id", { count: "exact", head: true }).eq("bank_account_id", accountId),
    supabase.from("bank_reconciliations").select("id", { count: "exact", head: true }).eq("bank_account_id", accountId),
    supabase.from("fixed_assets").select("id", { count: "exact", head: true }).or(`asset_account_id.eq.${accountId},depreciation_account_id.eq.${accountId},depr_expense_account_id.eq.${accountId}`),
    supabase.from("expense_categories").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    supabase.from("opening_balances").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    supabase.from("opening_balance_details").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    supabase.from("accounts").select("id", { count: "exact", head: true }).eq("parent_account_id", accountId),
  ]);

  const deps: AccountDependencies = {
    journalLines: journalLines.count || 0,
    budgetItems: budgetItems.count || 0,
    bankFeedTransactions: bankFeedTxns.count || 0,
    bankReconciliations: bankReconciliations.count || 0,
    fixedAssets: fixedAssets.count || 0,
    expenseCategories: expenseCategories.count || 0,
    transactions: transactions.count || 0,
    openingBalances: openingBalances.count || 0,
    openingBalanceDetails: openingBalanceDetails.count || 0,
    childAccounts: childAccounts.count || 0,
    total: 0,
  };
  deps.total = deps.journalLines + deps.budgetItems + deps.bankFeedTransactions +
    deps.bankReconciliations + deps.fixedAssets + deps.expenseCategories +
    deps.transactions + deps.openingBalances + deps.openingBalanceDetails + deps.childAccounts;
  return deps;
}

export function useReassignAndDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, reassignToId }: { accountId: string; reassignToId?: string }) => {
      if (reassignToId) {
        // Reassign all references to the new account
        await Promise.all([
          supabase.from("journal_lines").update({ account_id: reassignToId }).eq("account_id", accountId),
          supabase.from("budget_items").update({ account_id: reassignToId }).eq("account_id", accountId),
          supabase.from("bank_feed_transactions").update({ bank_account_id: reassignToId }).eq("bank_account_id", accountId),
          supabase.from("bank_reconciliations").update({ bank_account_id: reassignToId }).eq("bank_account_id", accountId),
          supabase.from("expense_categories").update({ account_id: reassignToId }).eq("account_id", accountId),
          supabase.from("transactions").update({ account_id: reassignToId }).eq("account_id", accountId),
          supabase.from("opening_balances").update({ account_id: reassignToId }).eq("account_id", accountId),
          supabase.from("opening_balance_details").update({ account_id: reassignToId }).eq("account_id", accountId),
          supabase.from("accounts").update({ parent_account_id: reassignToId }).eq("parent_account_id", accountId),
          // Fixed assets have multiple FK columns
          supabase.from("fixed_assets").update({ asset_account_id: reassignToId }).eq("asset_account_id", accountId),
          supabase.from("fixed_assets").update({ depreciation_account_id: reassignToId }).eq("depreciation_account_id", accountId),
          supabase.from("fixed_assets").update({ depr_expense_account_id: reassignToId }).eq("depr_expense_account_id", accountId),
        ]);
      }

      const { error } = await supabase.from("accounts").delete().eq("id", accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts_active"] });
      toast.success("Account deleted successfully");
    },
    onError: (e: Error) => toast.error(`Failed to delete: ${e.message}`),
  });
}
