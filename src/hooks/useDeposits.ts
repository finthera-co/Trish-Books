import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { useAuth } from "@/contexts/AuthContext";
import { post } from "@/lib/postingEngine";
import { toast } from "sonner";

export interface DepositRow {
  id: string; customer_id: string; deposit_date: string; amount: number; applied_amount: number;
  status: string; reference: string | null; advance_account_id: string | null; customers?: { name: string };
}

export function useDeposits() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["customer_deposits", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customer_deposits")
        .select("*, customers(name)")
        .eq("tenant_id", appUser!.tenant_id)
        .order("deposit_date", { ascending: false });
      if (error) throw error;
      return data as DepositRow[];
    },
  });
}

// Record an advance receipt: Dr Bank / Cr Customer Advances.
export function useRecordDeposit() {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customer_id: string; amount: number; deposit_date: string;
      bank_account_id: string; advance_account_id: string; payment_method?: string; reference?: string; notes?: string;
    }) => {
      const tenant_id = appUser!.tenant_id;
      const { data: dep, error } = await (supabase as any)
        .from("customer_deposits")
        .insert({
          tenant_id, customer_id: input.customer_id, amount: input.amount, deposit_date: input.deposit_date,
          bank_account_id: input.bank_account_id, advance_account_id: input.advance_account_id,
          payment_method: input.payment_method || null, reference: input.reference || null, notes: input.notes || null,
          created_by: appUser!.id, status: "unapplied",
        })
        .select("id").single();
      if (error) throw error;

      const result = await post({
        tenant_id, entry_date: input.deposit_date,
        description: `Customer advance received${input.reference ? ` — ${input.reference}` : ""}`,
        source_type: "customer_deposit" as any, source_id: dep.id, reference: input.reference,
        lines: [
          { account_id: input.bank_account_id, debit: input.amount, credit: 0 },
          { account_id: input.advance_account_id, debit: 0, credit: input.amount },
        ],
      });
      await (supabase as any).from("customer_deposits").update({ journal_entry_id: result.journal_entry_id }).eq("id", dep.id);
      return dep;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer_deposits"] });
      toast.success("Advance recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Apply a deposit to an invoice: Dr Customer Advances / Cr AR (no new bank
// movement). Posted server-side via post-payment-received with
// funded_by_deposit_id — the function validates the unapplied balance, books
// the JE + allocation + AR sub-ledgers together, and updates the deposit.
export function useApplyDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      deposit: DepositRow; invoice_id: string; invoice_number: string; amount: number;
      ar_account_id: string; applied_date: string;
    }) => {
      const data = await invokeEdgeFunction<{ ok?: boolean; error?: string }>(
        "post-payment-received",
        {
          action: "post",
          request_id: crypto.randomUUID(),
          customer_id: input.deposit.customer_id,
          payment_date: input.applied_date,
          reference: `Deposit${input.deposit.reference ? ` ${input.deposit.reference}` : ""}`,
          ar_account_id: input.ar_account_id,
          funded_by_deposit_id: input.deposit.id,
          allocations: [{ invoice_id: input.invoice_id, amount: input.amount }],
        },
      );
      if (!data?.ok) throw new Error(data?.error || "Failed to apply deposit");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer_deposits"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["payments_received"] });
      qc.invalidateQueries({ queryKey: ["ar_transactions"] });
      toast.success("Deposit applied to invoice");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
