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

      const totalAmount = formData.lines.reduce((sum, l) => sum + l.amount, 0);
      if (totalAmount <= 0) throw new Error("Total amount must be greater than zero");

      // Generate voucher number
      const { data: voucherNum } = await supabase.rpc("generate_voucher_number", { p_tenant_id: appUser.tenant_id });

      // Create payment voucher
      const { data: voucher, error } = await supabase
        .from("payment_vouchers")
        .insert({
          voucher_number: voucherNum,
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
          status: "posted",
          tenant_id: appUser.tenant_id,
        })
        .select()
        .single();
      if (error) throw error;

      // Insert lines
      const lines = formData.lines.map((l) => ({
        voucher_id: voucher.id,
        account_id: l.account_id,
        description: l.description || null,
        amount: l.amount,
      }));
      const { error: linesError } = await supabase.from("payment_voucher_lines").insert(lines);
      if (linesError) throw linesError;

      // Create double-entry journal
      const journalLines = [
        ...formData.lines.map((l) => ({
          account_id: l.account_id,
          debit: l.amount,
          credit: 0,
        })),
        {
          account_id: formData.payment_account_id,
          debit: 0,
          credit: totalAmount,
        },
      ];

      const { data: je, error: jeError } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser.tenant_id,
          description: `Payment Voucher ${voucherNum}`,
          entry_date: formData.payment_date,
          reference: voucherNum,
          created_by: appUser.id,
          status: "posted",
        })
        .select()
        .single();
      if (jeError) throw jeError;

      const { error: jlError } = await supabase
        .from("journal_lines")
        .insert(journalLines.map((jl) => ({ ...jl, journal_entry_id: je.id })));
      if (jlError) throw jlError;

      // Link journal entry to voucher
      await supabase.from("payment_vouchers").update({ journal_entry_id: je.id }).eq("id", voucher.id);

      return voucher;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
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
