import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";

export interface PCCountDenominationInput {
  denomination: number;
  denom_type: "note" | "coin";
  quantity: number;
  subtotal: number;
  sort_order: number;
}

// Maps the machine-readable post_pc_count error codes to friendly messages.
function humanizeCountError(raw: string): string {
  const msg = raw || "";
  if (msg.includes("PERIOD_LOCKED"))
    return "The count date falls in a closed fiscal period. Reopen it or change the date.";
  if (msg.includes("INVALID_STATE"))
    return "This count has already been posted.";
  if (msg.includes("PC_ACCOUNT_NOT_LINKED"))
    return "This petty cash fund is not linked to a general-ledger account.";
  return msg.replace(/^[A-Z_]+:\s*/, "");
}

// ─── List counts for a fund (or all funds) ───
export function usePCCounts(pcAccountId?: string) {
  return useQuery({
    queryKey: ["pc_counts", pcAccountId],
    queryFn: async () => {
      let query = supabase
        .from("petty_cash_counts")
        .select("*, petty_cash_accounts(account_name), counted_user:counted_by(first_name, last_name)")
        .order("count_date", { ascending: false });
      if (pcAccountId) query = query.eq("petty_cash_account_id", pcAccountId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

// ─── Single count with its denomination breakdown ───
export function usePCCount(id?: string) {
  return useQuery({
    queryKey: ["pc_count", id],
    queryFn: async () => {
      const { data: count, error } = await supabase
        .from("petty_cash_counts")
        .select("*, petty_cash_accounts(account_name, account_id, float_amount), counted_user:counted_by(first_name, last_name)")
        .eq("id", id!)
        .single();
      if (error) throw error;

      const { data: denominations, error: dErr } = await supabase
        .from("petty_cash_count_denominations")
        .select("*")
        .eq("count_id", id!)
        .order("sort_order");
      if (dErr) throw dErr;

      return { ...count, denominations: denominations || [] };
    },
    enabled: !!id,
  });
}

// ─── Create a draft count + its denomination rows ───
export function useCreatePCCount() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      petty_cash_account_id: string;
      count_date: string;
      book_balance: number;
      counted_balance: number;
      notes?: string;
      counted_by?: string;
      denominations: PCCountDenominationInput[];
    }) => {
      // Atomic, gapless count number
      const { data: countNumber, error: numErr } = await supabase.rpc("pc_next_document_number", {
        p_tenant_id: appUser!.tenant_id,
        p_doc_type: "PCC",
      });
      if (numErr) throw numErr;

      const variance = Number((input.counted_balance - input.book_balance).toFixed(2));

      const { data: count, error } = await supabase
        .from("petty_cash_counts")
        .insert({
          tenant_id: appUser!.tenant_id,
          count_number: countNumber as string,
          petty_cash_account_id: input.petty_cash_account_id,
          count_date: input.count_date,
          book_balance: input.book_balance,
          counted_balance: input.counted_balance,
          variance,
          status: "draft",
          notes: input.notes || null,
          counted_by: input.counted_by || appUser!.id,
        })
        .select()
        .single();
      if (error) throw error;

      if (input.denominations.length) {
        const rows = input.denominations.map((d) => ({
          count_id: count.id,
          denomination: d.denomination,
          denom_type: d.denom_type,
          quantity: d.quantity,
          subtotal: d.subtotal,
          sort_order: d.sort_order,
        }));
        const { error: dErr } = await supabase
          .from("petty_cash_count_denominations")
          .insert(rows);
        if (dErr) throw dErr;
      }

      return count;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pc_counts"] });
      toast.success("Cash count saved as draft");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Post a draft count (computes & posts variance to Cash Over/Short) ───
export function usePostPCCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (countId: string) => {
      const { error } = await supabase.rpc("post_pc_count", { p_count_id: countId });
      if (error) throw new Error(humanizeCountError(error.message));

      // Read back the frozen result so we can report the variance & linked JE.
      const { data: posted, error: readErr } = await supabase
        .from("petty_cash_counts")
        .select("variance, journal_entry_id")
        .eq("id", countId)
        .single();
      if (readErr) throw readErr;
      return posted;
    },
    onSuccess: (posted) => {
      qc.invalidateQueries({ queryKey: ["pc_counts"] });
      qc.invalidateQueries({ queryKey: ["pc_count"] });
      qc.invalidateQueries({ queryKey: ["pc_balance"] });
      qc.invalidateQueries({ queryKey: ["pc_ledger"] });
      const variance = Number(posted?.variance || 0);
      if (variance === 0) {
        toast.success("Count posted — cash balanced, no variance");
      } else {
        const label = variance > 0 ? "overage" : "shortage";
        toast.success(`Count posted — ${label} of ${formatCurrency(Math.abs(variance))} recorded`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
