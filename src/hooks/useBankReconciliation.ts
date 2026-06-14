import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useBankReconciliations() {
  return useQuery({
    queryKey: ["bank_reconciliations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_reconciliations")
        .select("*, accounts(account_name, account_code), users!bank_reconciliations_reconciled_by_fkey(first_name, last_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useBankReconciliation(id?: string) {
  return useQuery({
    queryKey: ["bank_reconciliation", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("bank_reconciliations")
        .select("*, accounts(account_name, account_code)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useReconciliationTransactions(reconciliationId?: string) {
  return useQuery({
    queryKey: ["reconciliation_transactions", reconciliationId],
    queryFn: async () => {
      if (!reconciliationId) return [];
      const { data, error } = await supabase
        .from("reconciliation_transactions")
        .select("*, journal_lines(*, journal_entries(description, reference, entry_date, status), accounts(account_name, account_code))")
        .eq("reconciliation_id", reconciliationId);
      if (error) throw error;
      return data;
    },
    enabled: !!reconciliationId,
  });
}

export function useReconciliationAdjustments(reconciliationId?: string) {
  return useQuery({
    queryKey: ["reconciliation_adjustments", reconciliationId],
    queryFn: async () => {
      if (!reconciliationId) return [];
      const { data, error } = await supabase
        .from("reconciliation_adjustments")
        .select("*")
        .eq("reconciliation_id", reconciliationId);
      if (error) throw error;
      return data;
    },
    enabled: !!reconciliationId,
  });
}

export function useReconciliationLogs(reconciliationId?: string) {
  return useQuery({
    queryKey: ["reconciliation_logs", reconciliationId],
    queryFn: async () => {
      if (!reconciliationId) return [];
      const { data, error } = await supabase
        .from("reconciliation_logs")
        .select("*, users(first_name, last_name)")
        .eq("reconciliation_id", reconciliationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!reconciliationId,
  });
}

export function useCreateReconciliation() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (rec: {
      bank_account_id: string;
      statement_ending_date: string;
      statement_ending_balance: number;
      beginning_balance: number;
      service_charges?: number;
      interest_earned?: number;
      notes?: string;
    }) => {
      const { data, error } = await supabase
        .from("bank_reconciliations")
        .insert({ ...rec, tenant_id: appUser?.tenant_id! })
        .select()
        .single();
      if (error) throw error;

      // Load all journal lines for this bank account up to statement date
      const { data: journalLines, error: jlError } = await supabase
        .from("journal_lines")
        .select("*, journal_entries!inner(entry_date, status, tenant_id)")
        .eq("account_id", rec.bank_account_id)
        .lte("journal_entries.entry_date", rec.statement_ending_date)
        .eq("journal_entries.status", "posted")
        .eq("journal_entries.tenant_id", appUser?.tenant_id!);
      if (jlError) throw jlError;

      // Check which lines are already reconciled in previous reconciliations
      const previouslyReconciled = new Set<string>();
      if (journalLines && journalLines.length > 0) {
        const lineIds = journalLines.map((l: any) => l.id);
        const { data: existing } = await supabase
          .from("reconciliation_transactions")
          .select("journal_line_id")
          .in("journal_line_id", lineIds)
          .eq("cleared", true);
        if (existing) existing.forEach((e: any) => previouslyReconciled.add(e.journal_line_id));
      }

      // Insert unreconciled lines as reconciliation_transactions
      const unreconciledLines = (journalLines || []).filter(
        (l: any) => !previouslyReconciled.has(l.id)
      );
      if (unreconciledLines.length > 0) {
        const rows = unreconciledLines.map((l: any) => ({
          reconciliation_id: data.id,
          journal_line_id: l.id,
          cleared: false,
        }));
        const { error: insertError } = await supabase
          .from("reconciliation_transactions")
          .insert(rows);
        if (insertError) throw insertError;
      }

      // Log
      await supabase.from("reconciliation_logs").insert({
        reconciliation_id: data.id,
        user_id: appUser?.id,
        action: "reconciliation_started",
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_reconciliations"] });
      toast.success("Reconciliation started");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleClearTransaction() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async ({ id, cleared, reconciliationId }: { id: string; cleared: boolean; reconciliationId: string }) => {
      const { error } = await supabase
        .from("reconciliation_transactions")
        .update({ cleared, cleared_date: cleared ? new Date().toISOString().split("T")[0] : null })
        .eq("id", id);
      if (error) throw error;

      await supabase.from("reconciliation_logs").insert({
        reconciliation_id: reconciliationId,
        user_id: appUser?.id,
        action: cleared ? "transaction_marked_cleared" : "transaction_unmarked",
        affected_transaction_id: id,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation_transactions", variables.reconciliationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCompleteReconciliation() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async ({ id, clearedBalance }: { id: string; clearedBalance: number }) => {
      // Fetch reconciliation for period lock check
      const { data: recon, error: reconErr } = await supabase
        .from("bank_reconciliations")
        .select("tenant_id, statement_ending_date")
        .eq("id", id)
        .single();
      if (reconErr) throw reconErr;

      // Period lock enforcement
      const { data: closedPeriods } = await supabase
        .from("fiscal_periods")
        .select("name")
        .eq("tenant_id", recon.tenant_id)
        .eq("status", "closed")
        .lte("period_start", recon.statement_ending_date)
        .gte("period_end", recon.statement_ending_date)
        .limit(1);
      if (closedPeriods && closedPeriods.length > 0) {
        throw new Error(`Cannot finalize: fiscal period "${closedPeriods[0].name}" is closed.`);
      }

      // No-orphan enforcement: check for unresolved bank feed txns
      const { data: orphans } = await supabase
        .from("bank_feed_transactions")
        .select("id")
        .eq("reconciliation_id", id)
        .in("status", ["unmatched", "suggested"])
        .eq("is_duplicate", false)
        .limit(1);
      if (orphans && orphans.length > 0) {
        throw new Error("Cannot finalize: unresolved bank feed transactions exist. Match or delete them first.");
      }

      const { error } = await supabase
        .from("bank_reconciliations")
        .update({
          status: "reconciled",
          cleared_balance: clearedBalance,
          difference: 0,
          reconciled_by: appUser?.id,
          reconciled_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;

      await supabase.from("reconciliation_logs").insert({
        reconciliation_id: id,
        user_id: appUser?.id,
        action: "reconciliation_completed",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_reconciliations"] });
      toast.success("Reconciliation completed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUndoReconciliation() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      // Unmark all cleared transactions
      const { error: txError } = await supabase
        .from("reconciliation_transactions")
        .update({ cleared: false, cleared_date: null })
        .eq("reconciliation_id", id);
      if (txError) throw txError;

      const { error } = await supabase
        .from("bank_reconciliations")
        .update({
          status: "in_progress",
          reconciled_by: null,
          reconciled_at: null,
          cleared_balance: 0,
        })
        .eq("id", id);
      if (error) throw error;

      await supabase.from("reconciliation_logs").insert({
        reconciliation_id: id,
        user_id: appUser?.id,
        action: "reconciliation_undone",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_reconciliations"] });
      toast.success("Reconciliation undone");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateReconciliationAdjustment() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (adj: {
      reconciliation_id: string;
      bank_account_id: string;
      account_id: string;
      amount: number;
      description: string;
      adjustment_type: "charge" | "interest";
      date: string;
    }) => {
      // Create journal entry for the adjustment
      const isCharge = adj.adjustment_type === "charge";
      const { data: je, error: jeError } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser?.tenant_id!,
          description: adj.description,
          entry_date: adj.date,
          reference: `RECON-ADJ`,
          created_by: appUser?.id,
          status: "posted",
        })
        .select()
        .single();
      if (jeError) throw jeError;

      // Double entry: charge debits expense, credits bank; interest debits bank, credits income
      const lines = isCharge
        ? [
            { journal_entry_id: je.id, account_id: adj.account_id, debit: adj.amount, credit: 0 },
            { journal_entry_id: je.id, account_id: adj.bank_account_id, debit: 0, credit: adj.amount },
          ]
        : [
            { journal_entry_id: je.id, account_id: adj.bank_account_id, debit: adj.amount, credit: 0 },
            { journal_entry_id: je.id, account_id: adj.account_id, debit: 0, credit: adj.amount },
          ];
      const { error: linesError } = await supabase.from("journal_lines").insert(lines);
      if (linesError) throw linesError;

      // Record the adjustment
      const { data: adjData, error: adjError } = await supabase
        .from("reconciliation_adjustments")
        .insert({
          reconciliation_id: adj.reconciliation_id,
          journal_entry_id: je.id,
          amount: adj.amount,
          description: adj.description,
          adjustment_type: adj.adjustment_type,
        })
        .select()
        .single();
      if (adjError) throw adjError;

      // Add the new journal lines as reconciliation transactions (auto-cleared)
      const { data: newLines } = await supabase
        .from("journal_lines")
        .select("id")
        .eq("journal_entry_id", je.id)
        .eq("account_id", adj.bank_account_id);
      if (newLines && newLines.length > 0) {
        await supabase.from("reconciliation_transactions").insert(
          newLines.map((l: any) => ({
            reconciliation_id: adj.reconciliation_id,
            journal_line_id: l.id,
            cleared: true,
            cleared_date: adj.date,
          }))
        );
      }

      await supabase.from("reconciliation_logs").insert({
        reconciliation_id: adj.reconciliation_id,
        user_id: appUser?.id,
        action: "adjustment_added",
        details: { type: adj.adjustment_type, amount: adj.amount },
      });

      return adjData;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation_transactions", variables.reconciliation_id] });
      queryClient.invalidateQueries({ queryKey: ["reconciliation_adjustments", variables.reconciliation_id] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      toast.success("Adjustment added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useLastReconciliation(bankAccountId?: string) {
  return useQuery({
    queryKey: ["last_reconciliation", bankAccountId],
    queryFn: async () => {
      if (!bankAccountId) return null;
      const { data, error } = await supabase
        .from("bank_reconciliations")
        .select("*")
        .eq("bank_account_id", bankAccountId)
        .eq("status", "reconciled")
        .order("statement_ending_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!bankAccountId,
  });
}
