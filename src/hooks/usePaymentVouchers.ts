import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface VoucherLine {
  id?: string;
  account_id: string;
  description: string;
  amount: number;
}

export interface PaymentVoucherFormData {
  account_number?: string;
  cheque_number?: string;
  payee_id?: string;
  payment_account_id: string;
  payment_method: string;
  reference_number?: string;
  payment_date: string;
  memo?: string;
  bills_attached?: number;
  approved_by?: string;
  accountant?: string;
  checked_by?: string;
  made_by?: string;
  lines: VoucherLine[];
}

export function usePaymentVouchers() {
  return useQuery({
    queryKey: ["payment_vouchers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_vouchers")
        .select("*, customers(name), accounts!payment_vouchers_payment_account_id_fkey(account_name, account_code)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function usePaymentVoucher(id: string | undefined) {
  return useQuery({
    queryKey: ["payment_voucher", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("payment_vouchers")
        .select("*, customers(name), accounts!payment_vouchers_payment_account_id_fkey(account_name, account_code), payment_voucher_lines(*, accounts(account_name, account_code))")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreatePaymentVoucher() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async (formData: PaymentVoucherFormData) => {
      if (!appUser) throw new Error("Not authenticated");

      // Server validates everything (cash/bank account, expense/liability lines,
      // duplicate references, balanced JE, precision, account ownership, etc.)
      // and runs voucher + lines + journal entry in a single transaction.
      const { data, error } = await supabase.rpc("create_payment_voucher", {
        p_payment_account_id: formData.payment_account_id,
        p_payment_method: formData.payment_method,
        p_payment_date: formData.payment_date,
        p_lines: formData.lines.map((l) => ({
          account_id: l.account_id,
          description: l.description ?? null,
          amount: Number(l.amount),
        })),
        p_payee_id: formData.payee_id || null,
        p_account_number: formData.account_number || null,
        p_cheque_number: formData.cheque_number || null,
        p_reference_number: formData.reference_number || null,
        p_memo: formData.memo || null,
        p_bills_attached: formData.bills_attached ?? 0,
        p_approved_by: formData.approved_by || null,
        p_accountant: formData.accountant || null,
        p_checked_by: formData.checked_by || null,
        p_made_by: formData.made_by || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Payment voucher created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdatePaymentVoucher() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...formData }: PaymentVoucherFormData & { id: string }) => {
      const totalAmount = formData.lines.reduce((sum, l) => sum + l.amount, 0);
      if (totalAmount <= 0) throw new Error("Total amount must be greater than zero");

      const { error } = await supabase
        .from("payment_vouchers")
        .update({
          account_number: formData.account_number || null,
          cheque_number: formData.cheque_number || null,
          payee_id: formData.payee_id || null,
          payment_account_id: formData.payment_account_id,
          payment_method: formData.payment_method,
          reference_number: formData.reference_number || null,
          payment_date: formData.payment_date,
          memo: formData.memo || null,
          bills_attached: formData.bills_attached || 0,
          approved_by: formData.approved_by || null,
          accountant: formData.accountant || null,
          checked_by: formData.checked_by || null,
          made_by: formData.made_by || null,
          total_amount: totalAmount,
        })
        .eq("id", id);
      if (error) throw error;

      // Delete old lines and insert new
      await supabase.from("payment_voucher_lines").delete().eq("voucher_id", id);
      const lines = formData.lines.map((l) => ({
        voucher_id: id,
        account_id: l.account_id,
        description: l.description || null,
        amount: l.amount,
      }));
      const { error: linesError } = await supabase.from("payment_voucher_lines").insert(lines);
      if (linesError) throw linesError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["payment_voucher"] });
      toast.success("Payment voucher updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePaymentVoucher() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payment_vouchers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_vouchers"] });
      toast.success("Payment voucher deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
