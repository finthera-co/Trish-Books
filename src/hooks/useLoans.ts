import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface EmployeeLoan {
  id: string;
  employee_id: string;
  description: string | null;
  principal: number;
  monthly_installment: number;
  balance: number;
  start_date: string;
  status: "active" | "settled" | "cancelled";
  created_at: string;
  employees?: { first_name: string; last_name: string; employee_number: string | null };
}

export function useEmployeeLoans() {
  return useQuery({
    queryKey: ["employee_loans"],
    queryFn: async (): Promise<EmployeeLoan[]> => {
      const { data, error } = await supabase
        .from("employee_loans")
        .select("*, employees(first_name, last_name, employee_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as EmployeeLoan[];
    },
  });
}

export function useCreateLoan() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      employee_id: string; description?: string; principal: number; monthly_installment: number;
      start_date?: string; bank_account_id?: string;
    }) => {
      const { data, error } = await supabase.from("employee_loans").insert({
        tenant_id: appUser?.tenant_id,
        employee_id: input.employee_id,
        description: input.description || null,
        principal: input.principal,
        monthly_installment: input.monthly_installment,
        balance: input.principal,                       // starts at full principal
        start_date: input.start_date || new Date().toISOString().slice(0, 10),
        created_by: appUser?.id,
      }).select("id").single();
      if (error) throw error;
      // Post the advance to the GL (Dr Staff Loans Receivable / Cr Bank) if a bank is chosen.
      if (input.bank_account_id && data?.id) {
        const { error: jeErr } = await supabase.rpc("rpc_post_loan_advance", { p_loan_id: data.id, p_bank_account_id: input.bank_account_id });
        if (jeErr) throw jeErr;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employee_loans"] }); toast.success("Loan recorded"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCancelLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_loans").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employee_loans"] }); toast.success("Loan cancelled"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface LoanRepaymentRow {
  id: string;
  loan_id: string;
  amount: number;
  balance_after: number;
  created_at: string;
}

export function useLoanRepayments(loanId?: string) {
  return useQuery({
    queryKey: ["loan_repayments", loanId],
    enabled: !!loanId,
    queryFn: async (): Promise<LoanRepaymentRow[]> => {
      const { data, error } = await supabase
        .from("loan_repayments").select("*").eq("loan_id", loanId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as LoanRepaymentRow[];
    },
  });
}
