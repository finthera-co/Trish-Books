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
        is_system: true,
        is_active: true,
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

// Generate next OBE batch ID
async function getNextBatchId(tenantId: string): Promise<string> {
  const { count } = await supabase
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("entry_type", "opening_balance")
    .not("obe_batch_id", "is", null);
  
  // Find the highest existing batch number
  const { data: existing } = await supabase
    .from("journal_entries")
    .select("obe_batch_id")
    .eq("tenant_id", tenantId)
    .eq("entry_type", "opening_balance")
    .not("obe_batch_id", "is", null)
    .order("obe_batch_id", { ascending: false })
    .limit(1);
  
  let nextNum = 1;
  if (existing && existing.length > 0 && existing[0].obe_batch_id) {
    const match = existing[0].obe_batch_id.match(/OBE-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  
  return `OBE-${String(nextNum).padStart(4, "0")}`;
}

// Find the current active (posted) OBE batch entry
async function findActiveBatchEntry(tenantId: string) {
  const { data } = await supabase
    .from("journal_entries")
    .select("id, reference, obe_batch_id")
    .eq("tenant_id", tenantId)
    .eq("entry_type", "opening_balance")
    .eq("status", "posted")
    .not("obe_batch_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return data && data.length > 0 ? data[0] : null;
}

// Save opening balance journal entry with auto OBE balancing
// QuickBooks-style: EDIT-IN-PLACE if existing batch exists, otherwise create new
export function useSaveOpeningBalances() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const ensureOBE = useEnsureOBEAccount();

  return useMutation({
    mutationFn: async (params: {
      lines: { account_id: string; debit: number; credit: number }[];
      entry_date: string;
      description?: string;
    }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      const obeAccountId = await ensureOBE.mutateAsync();

      // Filter out empty lines and OBE account lines
      const userLines = params.lines.filter(
        (l) => l.account_id && l.account_id !== obeAccountId && (l.debit > 0 || l.credit > 0)
      );
      if (userLines.length === 0) throw new Error("At least one account line is required");

      // Void any inline entries for accounts in this batch
      const accountIds = userLines.map((l) => l.account_id);
      for (const accountId of accountIds) {
        const { data: inlineEntries } = await supabase
          .from("journal_entries")
          .select("id")
          .eq("tenant_id", appUser.tenant_id)
          .eq("entry_type", "opening_balance")
          .eq("status", "posted")
          .like("reference", `OB-INLINE-${accountId.substring(0, 8)}%`);

        for (const entry of inlineEntries || []) {
          await supabase
            .from("journal_entries")
            .update({
              status: "voided",
              void_reason: "Superseded by batch opening balance entry",
              voided_by: appUser.id,
              voided_at: new Date().toISOString(),
            })
            .eq("id", entry.id)
            .eq("tenant_id", appUser.tenant_id);
        }
      }

      const totalDebits = userLines.reduce((s, l) => s + l.debit, 0);
      const totalCredits = userLines.reduce((s, l) => s + l.credit, 0);
      const difference = totalDebits - totalCredits;

      // Build all lines including OBE auto-balance
      const allLines = [...userLines];
      if (Math.abs(difference) > 0.005) {
        allLines.push({
          account_id: obeAccountId,
          debit: difference < 0 ? Math.abs(difference) : 0,
          credit: difference > 0 ? difference : 0,
        });
      }

      // EDIT-IN-PLACE: Check if there's an existing active batch entry
      const existingBatch = await findActiveBatchEntry(appUser.tenant_id);

      let entryId: string;
      let batchId: string;
      let ref: string;

      if (existingBatch) {
        // UPDATE existing journal entry (edit-in-place)
        entryId = existingBatch.id;
        batchId = existingBatch.obe_batch_id!;
        ref = existingBatch.reference!;

        // Update header
        await supabase
          .from("journal_entries")
          .update({
            description: params.description || "Opening Balance Entry",
            entry_date: params.entry_date,
          })
          .eq("id", entryId)
          .eq("tenant_id", appUser.tenant_id);

        // Delete existing lines and re-insert
        await supabase
          .from("journal_lines")
          .delete()
          .eq("journal_entry_id", entryId);

        const lines = allLines.map((l) => ({
          journal_entry_id: entryId,
          account_id: l.account_id,
          debit: l.debit,
          credit: l.credit,
        }));
        const { error: linesErr } = await supabase.from("journal_lines").insert(lines);
        if (linesErr) throw linesErr;

        // Audit log for edit
        await supabase.from("audit_logs").insert({
          action: "Opening Balance Entry Updated (Edit-in-Place)",
          table_name: "journal_entries",
          record_id: entryId,
          user_id: appUser.id,
          tenant_id: appUser.tenant_id,
          details: { 
            batch_id: batchId, 
            reference: ref, 
            total_debits: totalDebits, 
            total_credits: totalCredits, 
            obe_adjustment: difference 
          },
        });
      } else {
        // CREATE new batch entry
        batchId = await getNextBatchId(appUser.tenant_id);
        ref = `OB-${batchId.replace("OBE-", "")}`;

        const { data: entry, error: entryErr } = await supabase
          .from("journal_entries")
          .insert({
            tenant_id: appUser.tenant_id,
            description: params.description || "Opening Balance Entry",
            entry_date: params.entry_date,
            reference: ref,
            status: "posted",
            entry_type: "opening_balance",
            is_system_generated: true,
            created_by: appUser.id,
            obe_batch_id: batchId,
          })
          .select()
          .single();
        if (entryErr) throw entryErr;
        entryId = entry.id;

        // Create journal lines
        const lines = allLines.map((l) => ({
          journal_entry_id: entryId,
          account_id: l.account_id,
          debit: l.debit,
          credit: l.credit,
        }));
        const { error: linesErr } = await supabase.from("journal_lines").insert(lines);
        if (linesErr) throw linesErr;

        // Audit log for creation
        await supabase.from("audit_logs").insert({
          action: "Opening Balance Entry Created",
          table_name: "journal_entries",
          record_id: entryId,
          user_id: appUser.id,
          tenant_id: appUser.tenant_id,
          details: { 
            batch_id: batchId, 
            reference: ref, 
            total_debits: totalDebits, 
            total_credits: totalCredits, 
            obe_adjustment: difference 
          },
        });
      }

      // Sync opening_balance fields on each user account so COA reflects amounts
      for (const l of userLines) {
        const amount = l.debit > 0 ? l.debit : l.credit;
        const balType = l.debit > 0 ? "debit" : "credit";
        await supabase
          .from("accounts")
          .update({
            opening_balance: amount,
            opening_balance_type: balType,
          })
          .eq("id", l.account_id)
          .eq("tenant_id", appUser.tenant_id);
      }

      return { id: entryId, batchId, reference: ref };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["obe_balance"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      toast.success("Opening balances saved successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

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
