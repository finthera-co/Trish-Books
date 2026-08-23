import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface VoucherLine {
  id?: string;
  account_id: string;
  description: string;
  amount: number;
  customer_id?: string | null;
  is_billable?: boolean;
  cost_center_id?: string | null;
  is_taxable?: boolean;
  sort_order?: number;
}

export interface CheckFormData {
  account_number?: string;
  cheque_number?: string;
  payee_id?: string;
  payee_vendor_id?: string;
  permit_number?: string;
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
  print_later?: boolean;
  mailing_address?: string;
  location_id?: string | null;
  lines: VoucherLine[];
}

export function usePaymentVouchers() {
  return useQuery({
    queryKey: ["payment_vouchers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_vouchers")
        .select("*, customers(name), vendors(name), accounts!payment_vouchers_payment_account_id_fkey(account_name, account_code)")
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
        .select("*, customers(name), vendors(name, address, email), accounts!payment_vouchers_payment_account_id_fkey(account_name, account_code), payment_voucher_lines(*, accounts(account_name, account_code), customers(name))")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCheck() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async (formData: CheckFormData) => {
      if (!appUser) throw new Error("Not authenticated");

      // Server validates everything (cash/bank account, expense/liability lines,
      // duplicate references, balanced JE, precision, account ownership, check
      // number assignment, audit log) and runs voucher + lines + journal entry
      // in a single transaction.
      const { data, error } = await supabase.rpc("create_check", {
        p_payment_account_id: formData.payment_account_id,
        p_payment_method: formData.payment_method,
        p_payment_date: formData.payment_date,
        p_lines: formData.lines.map((l) => ({
          account_id: l.account_id,
          description: l.description ?? null,
          amount: Number(l.amount),
          customer_id: l.customer_id || null,
          is_billable: l.is_billable ?? false,
          cost_center_id: l.cost_center_id || null,
          is_taxable: l.is_taxable ?? false,
          sort_order: l.sort_order ?? 0,
        })),
        p_payee_id: formData.payee_id || null,
        p_payee_vendor_id: formData.payee_vendor_id || null,
        p_account_number: formData.account_number || null,
        p_cheque_number: formData.cheque_number || null,
        p_reference_number: formData.reference_number || null,
        p_memo: formData.memo || null,
        p_bills_attached: formData.bills_attached ?? 0,
        p_approved_by: formData.approved_by || null,
        p_accountant: formData.accountant || null,
        p_checked_by: formData.checked_by || null,
        p_made_by: formData.made_by || null,
        p_print_later: formData.print_later ?? false,
        p_mailing_address: formData.mailing_address || null,
        p_permit_number: formData.permit_number || null,
        p_location_id: formData.location_id || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["account_balances"] });
      toast.success("Check created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useVoidCheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("void_check", {
        p_voucher_id: id,
        p_reason: reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment_vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["payment_voucher"] });
      queryClient.invalidateQueries({ queryKey: ["journal_entries"] });
      queryClient.invalidateQueries({ queryKey: ["period_account_movements"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["account_balances"] });
      toast.success("Check voided");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePaymentVoucher() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Posted vouchers cannot be deleted (trigger enforces, UI fails fast).
      const { data: existing, error: fetchErr } = await supabase
        .from("payment_vouchers")
        .select("status, voucher_number")
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;
      if (existing?.status === "posted") {
        throw new Error(
          `Cannot delete posted voucher ${existing.voucher_number}. Create a reversal instead.`
        );
      }

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
