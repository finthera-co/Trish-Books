import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface MyEmployee {
  id: string;
  employee_number: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  email: string | null;
  designation: string | null;
  department: string | null;
  photo_url: string | null;
  hire_date: string | null;
  status: string | null;
}

/**
 * The employee's own payslips (processed/finalized runs only), newest first.
 * RLS already restricts payroll_run_items to the caller's own employee_id.
 */
export function useMyPayslips(employeeId?: string) {
  return useQuery({
    queryKey: ["my_payslips", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_run_items")
        .select("*, employees(first_name, last_name, department, epf_number, designation, employee_number, bank_account_no), payroll_item_details(*), payroll_runs(*)")
        .eq("employee_id", employeeId!);
      if (error) throw error;
      // RLS already restricts to published runs; sort newest first.
      return (data ?? [])
        .filter((it: any) => it.payroll_runs)
        .sort((a: any, b: any) => (b.payroll_runs.period_end > a.payroll_runs.period_end ? 1 : -1));
    },
  });
}

/** The current user's tenant branding (company name, logo, reg. no) for documents. */
export function useTenantBranding() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["tenant_branding", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("company_name, country, registration_number, logo_url")
        .eq("id", appUser!.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * The employee record linked to the currently signed-in user (employees.user_id).
 * RLS scopes the row to the caller, so this only ever returns the user's own record.
 */
export function useMyEmployee() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["my_employee", appUser?.id],
    enabled: !!appUser?.id,
    queryFn: async (): Promise<MyEmployee | null> => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_number, first_name, middle_name, last_name, email, designation, department, photo_url, hire_date, status")
        .eq("user_id", appUser!.id)
        .maybeSingle();
      if (error) throw error;
      return data as MyEmployee | null;
    },
  });
}
