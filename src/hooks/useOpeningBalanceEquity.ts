import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// Ensure OBE account exists for current tenant, return its ID
export function useEnsureOBEAccount() {
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { data: existing } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("account_name", "Opening Balance Equity")
        .eq("is_system", true)
        .maybeSingle();
      if (existing) return existing.id;

      const { data, error } = await supabase.from("accounts").insert({
        tenant_id: appUser.tenant_id,
        account_name: "Opening Balance Equity",
        account_code: "3900",
        account_type: "Equity",
        account_subtype: "Opening Balance Equity",
        normal_balance: "credit",
        is_system: true,
        is_active: true,
        is_locked: true,
      }).select("id").single();
      if (error) throw error;
      return data.id;
    },
  });
}

// Get OBE account for tenant
export function useOBEAccount() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["obe_account", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_name, account_code")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("account_name", "Opening Balance Equity")
        .eq("is_system", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });
}

// Get OBE balance (sum of all journal lines touching OBE account)
export function useOBEBalance() {
  const { data: obeAccount } = useOBEAccount();
  return useQuery({
    queryKey: ["obe_balance", obeAccount?.id],
    queryFn: async () => {
      if (!obeAccount?.id) return { balance: 0, type: "zero" as const };
      const { data, error } = await supabase
        .from("journal_lines")
        .select("debit, credit, journal_entries!inner(status)")
        .eq("account_id", obeAccount.id);
      if (error) throw error;

      const posted = (data || []).filter((l: any) => l.journal_entries?.status === "posted");
      const totalDebit = posted.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = posted.reduce((s, l) => s + Number(l.credit), 0);
      const balance = totalDebit - totalCredit;
      return {
        balance: Math.abs(balance),
        rawBalance: balance,
        type: balance > 0.005 ? ("debit" as const) : balance < -0.005 ? ("credit" as const) : ("zero" as const),
      };
    },
    enabled: !!obeAccount?.id,
  });
}

// Re-export useSystemSetting from settings module for backward compatibility
export { useSystemSetting } from "@/hooks/useOpeningBalanceSettings";

// Note: The old batch-based useSaveOpeningBalances has been removed.
// Opening balances are now saved per-account via useSaveQuickBooksOB (useQuickBooksOBE.ts)
// or useSaveAccountOpeningBalance (useOpeningBalanceSettings.ts).

// Cascade void an OBE journal entry — resets account balances and deletes orphan accounts
export function useVoidOBEJournalEntry() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (journalEntryId: string) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      // 1. Get the journal entry and its lines
      const { data: entry, error: entryErr } = await supabase
        .from("journal_entries")
        .select("*, journal_lines(account_id, debit, credit)")
        .eq("id", journalEntryId)
        .eq("tenant_id", appUser.tenant_id)
        .single();
      if (entryErr) throw entryErr;
      if (entry.status === "voided") throw new Error("Entry is already voided");
      if (entry.entry_type !== "opening_balance") throw new Error("Only OBE entries can be cascade-voided");

      const lines = (entry.journal_lines as any[]) || [];

      // 2. Void the journal entry
      const { error: voidErr } = await supabase
        .from("journal_entries")
        .update({
          status: "voided",
          void_reason: "OBE cascade void — all linked balances reset",
          voided_by: appUser.id,
          voided_at: new Date().toISOString(),
        })
        .eq("id", journalEntryId)
        .eq("tenant_id", appUser.tenant_id);
      if (voidErr) throw voidErr;

      // 3. Get OBE account ID to skip it
      const { data: obeAccount } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_system", true)
        .eq("account_name", "Opening Balance Equity")
        .maybeSingle();
      const obeAccountId = obeAccount?.id;

      // 4. For each account line (excluding OBE), reset opening balance
      const accountIds = lines
        .map((l: any) => l.account_id)
        .filter((id: string) => id !== obeAccountId);

      for (const accountId of accountIds) {
        // Reset opening balance on the account
        await supabase
          .from("accounts")
          .update({
            opening_balance: 0,
            opening_balance_type: "debit",
          })
          .eq("id", accountId)
          .eq("tenant_id", appUser.tenant_id);

        // Delete opening_balances table entries for this account
        await supabase
          .from("opening_balances")
          .delete()
          .eq("account_id", accountId)
          .eq("tenant_id", appUser.tenant_id);

        // Delete opening_balance_details for this account
        await supabase
          .from("opening_balance_details")
          .delete()
          .eq("account_id", accountId)
          .eq("tenant_id", appUser.tenant_id);
      }

      // 5. Delete orphan accounts/sub-accounts created from OBE (if no other dependencies)
      for (const accountId of accountIds) {
        const { data: account } = await supabase
          .from("accounts")
          .select("id, created_from")
          .eq("id", accountId)
          .eq("tenant_id", appUser.tenant_id)
          .maybeSingle();
        
        if (account?.created_from === "OBE") {
          // Check if account has any other transactions (non-OBE journal lines)
          const { count: otherJournalLines } = await supabase
            .from("journal_lines")
            .select("id", { count: "exact", head: true })
            .eq("account_id", accountId)
            .not("journal_entry_id", "eq", journalEntryId);
          
          const { count: transactions } = await supabase
            .from("transactions")
            .select("id", { count: "exact", head: true })
            .eq("account_id", accountId);

          const { count: children } = await supabase
            .from("accounts")
            .select("id", { count: "exact", head: true })
            .eq("parent_account_id", accountId);

          const hasOtherDeps = (otherJournalLines || 0) > 0 || (transactions || 0) > 0 || (children || 0) > 0;

          if (!hasOtherDeps) {
            // Safe to delete — orphan account created from OBE with no other use
            await supabase
              .from("accounts")
              .delete()
              .eq("id", accountId)
              .eq("tenant_id", appUser.tenant_id);
          }
        }
      }

      // 6. Audit log
      await supabase.from("audit_logs").insert({
        action: "OBE Journal Entry Cascade Voided",
        table_name: "journal_entries",
        record_id: journalEntryId,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: {
          batch_id: entry.obe_batch_id,
          accounts_reset: accountIds,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["obe_balance"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      queryClient.invalidateQueries({ queryKey: ["opening_balances"] });
      toast.success("OBE entry voided — all linked balances reset");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Close OBE by transferring balance to target account
export function useCloseOBE() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      obeAccountId: string;
      targetAccountId: string;
      balance: number;
      balanceType: "debit" | "credit";
      closingDate: string;
    }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      const { data: existing } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("tenant_id", appUser.tenant_id)
        .eq("setting_key", "obe_closed")
        .maybeSingle();
      if (existing?.setting_value === "true") {
        throw new Error("Opening Balance Equity has already been closed");
      }

      const { data: entry, error: entryErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser.tenant_id,
          description: "Close Opening Balance Equity",
          entry_date: params.closingDate,
          reference: "OBE-CLOSE",
          status: "posted",
          entry_type: "obe_closure",
          is_system_generated: true,
          created_by: appUser.id,
        })
        .select()
        .single();
      if (entryErr) throw entryErr;

      const lines = params.balanceType === "credit"
        ? [
            { journal_entry_id: entry.id, account_id: params.obeAccountId, debit: params.balance, credit: 0 },
            { journal_entry_id: entry.id, account_id: params.targetAccountId, debit: 0, credit: params.balance },
          ]
        : [
            { journal_entry_id: entry.id, account_id: params.targetAccountId, debit: params.balance, credit: 0 },
            { journal_entry_id: entry.id, account_id: params.obeAccountId, debit: 0, credit: params.balance },
          ];

      const { error: linesErr } = await supabase.from("journal_lines").insert(lines);
      if (linesErr) throw linesErr;

      await supabase.from("system_settings").upsert({
        tenant_id: appUser.tenant_id,
        setting_key: "obe_closed",
        setting_value: "true",
        updated_by: appUser.id,
      }, { onConflict: "tenant_id,setting_key" });

      await supabase.from("audit_logs").insert({
        action: "OBE Closed",
        table_name: "journal_entries",
        record_id: entry.id,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: {
          obe_balance: params.balance,
          balance_type: params.balanceType,
          target_account_id: params.targetAccountId,
        },
      });

      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["obe_balance"] });
      queryClient.invalidateQueries({ queryKey: ["system_setting"] });
      toast.success("Opening Balance Equity closed successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Helper: check if a journal entry is a system-generated OBE entry (locked from manual edit)
export function isOBEJournalEntry(entry: { entry_type?: string | null; is_system_generated?: boolean }): boolean {
  return entry.entry_type === "opening_balance" && entry.is_system_generated === true;
}
