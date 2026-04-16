import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useBankFeedTransactions(reconciliationId?: string) {
  return useQuery({
    queryKey: ["bank_feed_transactions", reconciliationId],
    queryFn: async () => {
      if (!reconciliationId) return [];
      const { data, error } = await supabase
        .from("bank_feed_transactions")
        .select("*")
        .eq("reconciliation_id", reconciliationId)
        .order("transaction_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!reconciliationId,
  });
}

export function useImportBankFeed() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async ({
      reconciliationId,
      bankAccountId,
      transactions,
    }: {
      reconciliationId: string;
      bankAccountId: string;
      transactions: Array<{
        transaction_date: string;
        description: string;
        amount: number;
        reference_number?: string;
        bank_balance?: number;
      }>;
    }) => {
      const batch = crypto.randomUUID();
      const rows = transactions.map((t) => ({
        tenant_id: appUser?.tenant_id!,
        reconciliation_id: reconciliationId,
        bank_account_id: bankAccountId,
        transaction_date: t.transaction_date,
        description: t.description,
        amount: t.amount,
        reference_number: t.reference_number || null,
        bank_balance: t.bank_balance ?? null,
        import_batch: batch,
        status: "unmatched" as const,
      }));

      // Duplicate detection: check existing feeds for same account
      const { data: existing } = await supabase
        .from("bank_feed_transactions")
        .select("transaction_date, amount, description")
        .eq("bank_account_id", bankAccountId);

      const existingSet = new Set(
        (existing || []).map((e: any) => `${e.transaction_date}|${e.amount}|${(e.description || "").toLowerCase().trim()}`)
      );

      const rowsWithDuplicates = rows.map((r) => {
        const key = `${r.transaction_date}|${r.amount}|${(r.description || "").toLowerCase().trim()}`;
        return { ...r, is_duplicate: existingSet.has(key) };
      });

      const { data, error } = await supabase
        .from("bank_feed_transactions")
        .insert(rowsWithDuplicates)
        .select();
      if (error) throw error;

      const duplicateCount = rowsWithDuplicates.filter((r) => r.is_duplicate).length;
      return { imported: data?.length || 0, duplicates: duplicateCount };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bank_feed_transactions", vars.reconciliationId] });
      const msg = `Imported ${result.imported} transactions` + (result.duplicates > 0 ? ` (${result.duplicates} duplicates detected)` : "");
      toast.success(msg);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useApproveMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bankFeedId,
      reconTxnId,
      reconciliationId,
    }: {
      bankFeedId: string;
      reconTxnId: string;
      reconciliationId: string;
    }) => {
      // Mark bank feed as matched
      const { error: bfErr } = await supabase
        .from("bank_feed_transactions")
        .update({ status: "matched" })
        .eq("id", bankFeedId);
      if (bfErr) throw bfErr;

      // Mark reconciliation transaction as cleared
      const { error: rtErr } = await supabase
        .from("reconciliation_transactions")
        .update({ cleared: true, cleared_date: new Date().toISOString().split("T")[0] })
        .eq("id", reconTxnId);
      if (rtErr) throw rtErr;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bank_feed_transactions", vars.reconciliationId] });
      queryClient.invalidateQueries({ queryKey: ["reconciliation_transactions", vars.reconciliationId] });
      toast.success("Match approved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRejectMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bankFeedId,
      reconciliationId,
    }: {
      bankFeedId: string;
      reconciliationId: string;
    }) => {
      const { error } = await supabase
        .from("bank_feed_transactions")
        .update({ status: "unmatched", matched_journal_line_id: null, match_confidence: null })
        .eq("id", bankFeedId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bank_feed_transactions", vars.reconciliationId] });
      toast.success("Match rejected");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteBankFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reconciliationId }: { id: string; reconciliationId: string }) => {
      const { error } = await supabase
        .from("bank_feed_transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bank_feed_transactions", vars.reconciliationId] });
      toast.success("Transaction deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRunAIMatching() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      reconciliationId,
      bankAccountId,
    }: {
      reconciliationId: string;
      bankAccountId: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("match-transactions", {
        body: { reconciliation_id: reconciliationId, bank_account_id: bankAccountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["bank_feed_transactions", vars.reconciliationId] });
      queryClient.invalidateQueries({ queryKey: ["reconciliation_transactions", vars.reconciliationId] });
      const parts = [];
      if (result.auto_matched > 0) parts.push(`${result.auto_matched} auto-matched`);
      if (result.suggested > 0) parts.push(`${result.suggested} suggested`);
      if (result.rules_applied > 0) parts.push(`${result.rules_applied} rules applied`);
      const breakdown = result.breakdown;
      const methods = [];
      if (breakdown?.source > 0) methods.push(`source:${breakdown.source}`);
      if (breakdown?.module > 0) methods.push(`module:${breakdown.module}`);
      if (breakdown?.combo > 0) methods.push(`combo:${breakdown.combo}`);
      if (breakdown?.scoring > 0) methods.push(`scoring:${breakdown.scoring}`);
      const msg = `Matching: ${parts.join(", ")}` + (methods.length ? ` (${methods.join(", ")})` : "");
      toast.success(msg || "No matches found");
    },
    onError: (e: Error) => toast.error("Matching failed: " + e.message),
  });
}
