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
      // Check if OBE already exists
      const { data: existing } = await supabase
        .from("accounts")
        .select("id")
        .eq("tenant_id", appUser.tenant_id)
        .eq("account_name", "Opening Balance Equity")
        .eq("is_system", true)
        .maybeSingle();
      if (existing) return existing.id;

      // Create it
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

// Save opening balance journal entry with auto OBE balancing
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

      // Generate reference
      const { count } = await supabase
        .from("journal_entries")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", appUser.tenant_id)
        .eq("entry_type", "opening_balance");
      const ref = `OB-${String((count || 0) + 1).padStart(4, "0")}`;

      // Create journal entry
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
        })
        .select()
        .single();
      if (entryErr) throw entryErr;

      // Create journal lines
      const lines = allLines.map((l) => ({
        journal_entry_id: entry.id,
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
      }));
      const { error: linesErr } = await supabase.from("journal_lines").insert(lines);
      if (linesErr) throw linesErr;

      // Audit log
      await supabase.from("audit_logs").insert({
        action: "Opening Balance Entry Created",
        table_name: "journal_entries",
        record_id: entry.id,
        user_id: appUser.id,
        tenant_id: appUser.tenant_id,
        details: { reference: ref, total_debits: totalDebits, total_credits: totalCredits, obe_adjustment: difference },
      });

      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["obe_balance"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Opening balances saved successfully");
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

      // Check if already closed
      const { data: existing } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("tenant_id", appUser.tenant_id)
        .eq("setting_key", "obe_closed")
        .maybeSingle();
      if (existing?.setting_value === "true") {
        throw new Error("Opening Balance Equity has already been closed");
      }

      // Create closing journal entry
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

      // If OBE has credit balance: Debit OBE, Credit target
      // If OBE has debit balance: Debit target, Credit OBE
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

      // Set obe_closed flag
      await supabase.from("system_settings").upsert({
        tenant_id: appUser.tenant_id,
        setting_key: "obe_closed",
        setting_value: "true",
        updated_by: appUser.id,
      }, { onConflict: "tenant_id,setting_key" });

      // Audit
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
