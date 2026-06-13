import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { isDebitNormal } from "@/lib/accountTypes";

// Ensure OBE system account exists
async function ensureOBEAccount(tenantId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("account_name", "Opening Balance Equity")
    .eq("is_system", true)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase.from("accounts").insert({
    tenant_id: tenantId,
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
}

/**
 * QuickBooks posting logic:
 * Given account normal balance and signed amount, determine DR/CR
 */
function computePosting(normalBalance: string, amountSigned: number) {
  const amt = Math.abs(amountSigned);
  const isPositive = amountSigned >= 0;
  const isDebit = normalBalance.toLowerCase() === "debit";

  // Account side
  let accountDebit = 0, accountCredit = 0;
  // OBE side (always opposite)
  let obeDebit = 0, obeCredit = 0;

  if (isDebit) {
    if (isPositive) {
      accountDebit = amt; obeCredit = amt;
    } else {
      accountCredit = amt; obeDebit = amt;
    }
  } else {
    if (isPositive) {
      accountCredit = amt; obeDebit = amt;
    } else {
      accountDebit = amt; obeCredit = amt;
    }
  }

  return { accountDebit, accountCredit, obeDebit, obeCredit };
}

// Fetch all opening balance entries for current tenant
export function useOpeningBalanceEntries() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["qb_ob_entries", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, reference, entry_date, description, status, created_at, journal_lines(account_id, debit, credit)")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("entry_type", "opening_balance")
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Get OBE account ID
      const { data: obeAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("is_system", true)
        .eq("account_name", "Opening Balance Equity")
        .maybeSingle();
      const obeId = obeAcct?.id;

      // Transform into per-account entries
      // Also fetch all accounts to determine normal balance for sign
      const { data: allAccounts } = await supabase
        .from("accounts")
        .select("id, normal_balance, account_type")
        .eq("tenant_id", appUser!.tenant_id);
      const acctMap = new Map((allAccounts || []).map((a: any) => [a.id, a]));

      return (data || []).map((je: any) => {
        const lines = (je.journal_lines || []) as any[];
        const accountLine = lines.find((l: any) => l.account_id !== obeId) || lines[0];
        const accountId = accountLine?.account_id;
        const debit = Number(accountLine?.debit || 0);
        const credit = Number(accountLine?.credit || 0);
        
        // Determine signed amount using normal balance logic
        const acct = acctMap.get(accountId);
        const normalIsDebit = acct ? isDebitNormal(acct.account_type) : true;
        // If posted on normal side → positive, opposite side → negative
        let amountSigned: number;
        if (normalIsDebit) {
          amountSigned = debit > 0 ? debit : -credit;
        } else {
          amountSigned = credit > 0 ? credit : -debit;
        }
        
        return {
          id: je.id,
          account_id: accountId,
          amount_signed: amountSigned,
          debit,
          credit,
          as_of_date: je.entry_date,
          description: je.description,
          status: je.status,
          journal_id: je.id,
          reference: je.reference,
          created_at: je.created_at,
        };
      });
    },
    enabled: !!appUser?.tenant_id,
  });
}

// Save a QuickBooks-style opening balance (one per account)
export function useSaveQuickBooksOB() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      accountId: string;
      amountSigned: number;
      asOfDate: string;
      description?: string;
      editEntryId?: string;
    }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      const obeAccountId = await ensureOBEAccount(appUser.tenant_id);

      // Get account to determine normal balance
      const { data: account, error: acctErr } = await supabase
        .from("accounts")
        .select("id, normal_balance, account_type, account_name, account_code")
        .eq("id", params.accountId)
        .single();
      if (acctErr || !account) throw new Error("Account not found");

      const normalBalance = account.normal_balance || (isDebitNormal(account.account_type) ? "debit" : "credit");
      const posting = computePosting(normalBalance, params.amountSigned);
      const absAmount = Math.abs(params.amountSigned);

      // ── Migrated fixed-asset guard ──
      // A Fixed Asset control account whose opening balance was built via the
      // inline "New Asset (migrated)" flow is ALREADY posted to the GL by the
      // per-asset opening journals (Dr Cost / Cr OBE, and Dr OBE / Cr Accum Dep).
      // Posting a competing Dr Control / Cr OBE here would double-count the cost,
      // and the void-existing block below would destroy those asset journals
      // (they are entry_type 'opening_balance' and touch this control account).
      // So when fixed-asset sub-ledger detail exists, skip GL posting and just
      // sync the account's opening-balance metadata.
      const { data: assetDetail } = await supabase
        .from("opening_balance_details")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("account_id", params.accountId)
        .eq("entity_type", "fixed_asset")
        .limit(1);

      if (assetDetail && assetDetail.length > 0) {
        await supabase
          .from("accounts")
          .update({
            opening_balance: absAmount,
            opening_balance_type: posting.accountDebit > 0 ? "debit" : "credit",
          })
          .eq("id", params.accountId)
          .eq("tenant_id", appUser.tenant_id);

        await supabase.from("audit_logs").insert({
          action: "Opening Balance (Fixed Asset sub-ledger) Synced",
          table_name: "accounts",
          record_id: params.accountId,
          user_id: appUser.id,
          tenant_id: appUser.tenant_id,
          details: {
            account_id: params.accountId,
            amount_signed: params.amountSigned,
            note: "Control journal skipped — migrated-asset opening journals already posted to GL",
          },
        });

        return { id: null, skipped_control_journal: true } as any;
      }

      // If editing, void the old entry first
      if (params.editEntryId) {
        await supabase
          .from("journal_entries")
          .update({
            status: "voided",
            void_reason: "Opening balance edited — replaced by new entry",
            voided_by: appUser.id,
            voided_at: new Date().toISOString(),
          })
          .eq("id", params.editEntryId)
          .eq("tenant_id", appUser.tenant_id);
      }

      // Void ANY existing opening balance entries for this account (both inline and OB-page)
      const { data: existingEntries } = await supabase
        .from("journal_entries")
        .select("id, journal_lines(account_id)")
        .eq("tenant_id", appUser.tenant_id)
        .eq("entry_type", "opening_balance")
        .eq("status", "posted");

      for (const je of existingEntries || []) {
        if (je.id === params.editEntryId) continue; // already voided above
        const lines = (je.journal_lines || []) as any[];
        const hasAccount = lines.some((l: any) => l.account_id === params.accountId);
        if (hasAccount) {
          await supabase
            .from("journal_entries")
            .update({
              status: "voided",
              void_reason: "Superseded by new opening balance entry",
              voided_by: appUser.id,
              voided_at: new Date().toISOString(),
            })
            .eq("id", je.id)
            .eq("tenant_id", appUser.tenant_id);
        }
      }

      // Create new journal entry
      const ref = `OB-${account.account_code}`;
      const { data: entry, error: entryErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser.tenant_id,
          description: params.description || `Opening Balance — ${account.account_name}`,
          entry_date: params.asOfDate,
          reference: ref,
          status: "posted",
          entry_type: "opening_balance",
          is_system_generated: true,
          created_by: appUser.id,
        })
        .select()
        .single();
      if (entryErr) throw entryErr;

      // Create journal lines
      const lines = [
        {
          journal_entry_id: entry.id,
          account_id: params.accountId,
          debit: posting.accountDebit,
          credit: posting.accountCredit,
        },
        {
          journal_entry_id: entry.id,
          account_id: obeAccountId,
          debit: posting.obeDebit,
          credit: posting.obeCredit,
        },
      ];
      const { error: linesErr } = await supabase.from("journal_lines").insert(lines);
      if (linesErr) throw linesErr;

      // Sync account opening_balance metadata
      await supabase
        .from("accounts")
        .update({
          opening_balance: absAmount,
          opening_balance_type: posting.accountDebit > 0 ? "debit" : "credit",
        })
        .eq("id", params.accountId)
        .eq("tenant_id", appUser.tenant_id);

      // Audit log
      await supabase.from("audit_logs").insert({
        action: params.editEntryId ? "Opening Balance Updated" : "Opening Balance Created",
        table_name: "journal_entries",
        record_id: entry.id,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: {
          account_id: params.accountId,
          amount_signed: params.amountSigned,
          normal_balance: normalBalance,
          posting,
          old_entry_id: params.editEntryId || null,
        },
      });

      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qb_ob_entries"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["obe_balance"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      toast.success("Opening balance saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Void an OB entry (creates reversing entry, marks as voided)
export function useVoidOBEntry() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (journalEntryId: string) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      // Get entry and lines
      const { data: entry, error } = await supabase
        .from("journal_entries")
        .select("*, journal_lines(account_id, debit, credit)")
        .eq("id", journalEntryId)
        .eq("tenant_id", appUser.tenant_id)
        .single();
      if (error) throw error;
      if (entry.status === "voided") throw new Error("Already voided");

      const lines = (entry.journal_lines as any[]) || [];

      // Find the non-OBE account to reset its balance
      const { data: obeAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_system", true)
        .eq("account_name", "Opening Balance Equity")
        .maybeSingle();
      const obeId = obeAcct?.id;
      const accountLine = lines.find((l: any) => l.account_id !== obeId);

      // Void the entry
      await supabase
        .from("journal_entries")
        .update({
          status: "voided",
          void_reason: "Opening balance voided by user",
          voided_by: appUser.id,
          voided_at: new Date().toISOString(),
        })
        .eq("id", journalEntryId)
        .eq("tenant_id", appUser.tenant_id);

      // Reset account opening balance
      if (accountLine) {
        await supabase
          .from("accounts")
          .update({ opening_balance: 0, opening_balance_type: "debit" })
          .eq("id", accountLine.account_id)
          .eq("tenant_id", appUser.tenant_id);
      }

      // Audit
      await supabase.from("audit_logs").insert({
        action: "Opening Balance Voided",
        table_name: "journal_entries",
        record_id: journalEntryId,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: { account_id: accountLine?.account_id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qb_ob_entries"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["obe_balance"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      toast.success("Opening balance voided");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Delete an OB entry (voids journal + removes record)
export function useDeleteOBEntry() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (journalEntryId: string) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      const { data: entry, error } = await supabase
        .from("journal_entries")
        .select("*, journal_lines(account_id, debit, credit)")
        .eq("id", journalEntryId)
        .eq("tenant_id", appUser.tenant_id)
        .single();
      if (error) throw error;

      const lines = (entry.journal_lines as any[]) || [];
      const { data: obeAcct } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("is_system", true)
        .eq("account_name", "Opening Balance Equity")
        .maybeSingle();
      const obeId = obeAcct?.id;
      const accountLine = lines.find((l: any) => l.account_id !== obeId);

      // Void journal (we never delete journals)
      await supabase
        .from("journal_entries")
        .update({
          status: "voided",
          void_reason: "Opening balance deleted by user",
          voided_by: appUser.id,
          voided_at: new Date().toISOString(),
        })
        .eq("id", journalEntryId)
        .eq("tenant_id", appUser.tenant_id);

      // Reset account
      if (accountLine) {
        await supabase
          .from("accounts")
          .update({ opening_balance: 0, opening_balance_type: "debit" })
          .eq("id", accountLine.account_id)
          .eq("tenant_id", appUser.tenant_id);

        // Delete opening_balances records
        await supabase
          .from("opening_balances")
          .delete()
          .eq("account_id", accountLine.account_id)
          .eq("tenant_id", appUser.tenant_id);
      }

      // Audit
      await supabase.from("audit_logs").insert({
        action: "Opening Balance Deleted",
        table_name: "journal_entries",
        record_id: journalEntryId,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qb_ob_entries"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["obe_balance"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      toast.success("Opening balance deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
