import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { isDebitNormal } from "@/lib/accountTypes";
import { writeAuditLog } from "@/hooks/useData";

// Get a system setting
export function useSystemSetting(key: string) {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["system_setting", appUser?.tenant_id, key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("setting_key", key)
        .maybeSingle();
      if (error) throw error;
      return data?.setting_value || null;
    },
    enabled: !!appUser?.tenant_id,
  });
}

// Save a system setting
export function useSaveSystemSetting() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error } = await supabase.from("system_settings").upsert(
        {
          tenant_id: appUser.tenant_id,
          setting_key: key,
          setting_value: value,
          updated_by: appUser.id,
        },
        { onConflict: "tenant_id,setting_key" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["system_setting", appUser?.tenant_id, vars.key] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Opening balance date
export function useOpeningBalanceDate() {
  return useSystemSetting("opening_balance_date");
}

// Opening balance status: draft | finalized | closed
export function useOpeningBalanceStatus() {
  return useSystemSetting("opening_balance_status");
}

// Finalize opening balances
export function useFinalizeOpeningBalances() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      await supabase.from("system_settings").upsert(
        {
          tenant_id: appUser.tenant_id,
          setting_key: "opening_balance_status",
          setting_value: "finalized",
          updated_by: appUser.id,
        },
        { onConflict: "tenant_id,setting_key" }
      );
      await supabase.from("audit_logs").insert({
        action: "Opening Balances Finalized",
        table_name: "system_settings",
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system_setting"] });
      toast.success("Opening balances finalized");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Revert to draft
export function useRevertToDraft() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      await supabase.from("system_settings").upsert(
        {
          tenant_id: appUser.tenant_id,
          setting_key: "opening_balance_status",
          setting_value: "draft",
          updated_by: appUser.id,
        },
        { onConflict: "tenant_id,setting_key" }
      );
      await supabase.from("audit_logs").insert({
        action: "Opening Balances Reverted to Draft",
        table_name: "system_settings",
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system_setting"] });
      toast.success("Opening balances reverted to draft");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Helper: ensure OBE account exists, return its ID
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

// Update account opening balance with proper journal entry + OBE offset
// This is the QuickBooks-style single-source posting:
// - Updates account metadata
// - Voids any previous OB journal for this specific account
// - Creates a new balanced journal entry (account + OBE offset)
export function useSaveAccountOpeningBalance() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      accountId,
      openingBalance,
      openingBalanceType,
    }: {
      accountId: string;
      openingBalance: number;
      openingBalanceType: "debit" | "credit";
    }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");

      // 1. Update account metadata
      const { error } = await supabase
        .from("accounts")
        .update({
          opening_balance: openingBalance,
          opening_balance_type: openingBalanceType,
        })
        .eq("id", accountId)
        .eq("tenant_id", appUser.tenant_id);
      if (error) throw error;
      writeAuditLog("Opening Balance Updated", "accounts", accountId, { opening_balance: openingBalance, opening_balance_type: openingBalanceType });

      // 2. Void ALL existing OB journal entries for this account (inline + OB-page)
      const { data: existingEntries } = await supabase
        .from("journal_entries")
        .select("id, journal_lines(account_id)")
        .eq("tenant_id", appUser.tenant_id)
        .eq("entry_type", "opening_balance")
        .eq("status", "posted");

      for (const je of existingEntries || []) {
        const lines = (je.journal_lines || []) as any[];
        const hasAccount = lines.some((l: any) => l.account_id === accountId);
        if (hasAccount) {
          await supabase
            .from("journal_entries")
            .update({
              status: "voided",
              void_reason: "Opening balance updated via inline edit",
              voided_by: appUser.id,
              voided_at: new Date().toISOString(),
            })
            .eq("id", je.id)
            .eq("tenant_id", appUser.tenant_id);
        }
      }

      if (openingBalance <= 0) return; // No journal needed for zero balance

      // 3. Ensure OBE account exists
      const obeAccountId = await ensureOBEAccount(appUser.tenant_id);

      // 4. Get the OB date (use system setting or today)
      const { data: dateSetting } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("tenant_id", appUser.tenant_id)
        .eq("setting_key", "opening_balance_date")
        .maybeSingle();
      const entryDate = dateSetting?.setting_value || new Date().toISOString().slice(0, 10);

      // 5. Create balanced journal entry
      const ref = `OB-INLINE-${accountId.substring(0, 8)}`;
      const { data: entry, error: entryErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser.tenant_id,
          description: "Opening Balance — Inline Entry",
          entry_date: entryDate,
          reference: ref,
          status: "posted",
          entry_type: "opening_balance",
          is_system_generated: true,
          created_by: appUser.id,
        })
        .select()
        .single();
      if (entryErr) throw entryErr;

      // 6. Create journal lines:
      // Account line: debit or credit per user input
      // OBE line: opposite side to balance
      const lines = [
        {
          journal_entry_id: entry.id,
          account_id: accountId,
          debit: openingBalanceType === "debit" ? openingBalance : 0,
          credit: openingBalanceType === "credit" ? openingBalance : 0,
        },
        {
          journal_entry_id: entry.id,
          account_id: obeAccountId,
          debit: openingBalanceType === "credit" ? openingBalance : 0,
          credit: openingBalanceType === "debit" ? openingBalance : 0,
        },
      ];
      const { error: linesErr } = await supabase.from("journal_lines").insert(lines);
      if (linesErr) throw linesErr;

      // 7. Audit log
      await supabase.from("audit_logs").insert({
        action: "Opening Balance Inline Edit",
        table_name: "accounts",
        record_id: accountId,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: {
          opening_balance: openingBalance,
          opening_balance_type: openingBalanceType,
          journal_entry_id: entry.id,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts_active"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      queryClient.invalidateQueries({ queryKey: ["obe_balance"] });
      toast.success("Opening balance saved with journal entry");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
