import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface GratuitySettings {
  tenant_id: string;
  months_per_year: number;
  eligibility_years: number;
  accrue_from_start: boolean;
  terminal_tax_relief: number;
  terminal_tax_rate: number;
}

export interface GratuityScheduleRow {
  employee_id: string;
  employee_name: string;
  employee_number: string | null;
  hire_date: string | null;
  termination_date: string | null;
  years_of_service: number;
  monthly_salary: number;
  accrued_amount: number;
  eligible: boolean;
}

export interface GratuityProvision {
  id: string;
  period: string;
  total_amount: number;
  employee_count: number;
  journal_entry_id: string | null;
  created_at: string;
}

export function useGratuitySettings() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["gratuity_settings", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async (): Promise<GratuitySettings | null> => {
      const { data, error } = await supabase
        .from("gratuity_settings").select("*").eq("tenant_id", appUser!.tenant_id).maybeSingle();
      if (error) throw error;
      return (data as GratuitySettings) ?? null;
    },
  });
}

export function useSaveGratuitySettings() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: { months_per_year: number; eligibility_years: number; accrue_from_start: boolean; terminal_tax_relief?: number; terminal_tax_rate?: number }) => {
      const tenant = appUser?.tenant_id;
      if (!tenant) throw new Error("No tenant");
      const { error } = await supabase.from("gratuity_settings").upsert(
        { tenant_id: tenant, ...input, updated_at: new Date().toISOString() },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gratuity_settings"] });
      qc.invalidateQueries({ queryKey: ["gratuity_schedule"] });
      toast.success("Gratuity settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useGratuitySchedule() {
  return useQuery({
    queryKey: ["gratuity_schedule"],
    queryFn: async (): Promise<GratuityScheduleRow[]> => {
      const { data, error } = await supabase.rpc("rpc_gratuity_schedule");
      if (error) throw error;
      return ((data as any[]) || []).map((r) => ({
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        employee_number: r.employee_number,
        hire_date: r.hire_date,
        termination_date: r.termination_date,
        years_of_service: Number(r.years_of_service) || 0,
        monthly_salary: Number(r.monthly_salary) || 0,
        accrued_amount: Number(r.accrued_amount) || 0,
        eligible: !!r.eligible,
      }));
    },
  });
}

export function useGratuityProvisions() {
  return useQuery({
    queryKey: ["gratuity_provisions"],
    queryFn: async (): Promise<GratuityProvision[]> => {
      const { data, error } = await supabase
        .from("gratuity_provisions").select("*").order("period", { ascending: false });
      if (error) throw error;
      return (data || []) as GratuityProvision[];
    },
  });
}

// ── Annual bonus provision ──────────────────────────────────────────────────
export function useBonusSettings() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["bonus_settings", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("bonus_settings").select("*").eq("tenant_id", appUser!.tenant_id).maybeSingle();
      if (error) throw error;
      return data as { bonus_months: number } | null;
    },
  });
}

export function useSaveBonusSettings() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (bonus_months: number) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error } = await supabase.from("bonus_settings").upsert(
        { tenant_id: appUser.tenant_id, bonus_months, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bonus_settings"] }); toast.success("Bonus policy saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useBonusProvisions() {
  return useQuery({
    queryKey: ["bonus_provisions"],
    queryFn: async (): Promise<GratuityProvision[]> => {
      const { data, error } = await supabase.from("bonus_provisions").select("*").order("period", { ascending: false });
      if (error) throw error;
      return (data || []) as GratuityProvision[];
    },
  });
}

export function usePostBonusProvision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => {
      const { data, error } = await supabase.rpc("rpc_post_bonus_provision", { p_period: period });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["bonus_provisions"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      if (res?.ok) toast.success(`Bonus provision posted: LKR ${Number(res.total).toLocaleString()}`);
      else toast.info(res?.reason || "Nothing to post");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export interface FinalSettlement {
  employee_id: string;
  employee_name: string;
  hire_date: string | null;
  termination_date: string | null;
  years_of_service: number;
  monthly_salary: number;
  gratuity_eligible: boolean;
  gratuity_amount: number;
  gratuity_tax: number;
  gratuity_net: number;
  encashable_leave_days: number;
  leave_encashment: number;
  outstanding_loan: number;
  net_settlement: number;
}

export function useFinalSettlement(employeeId?: string) {
  return useQuery({
    queryKey: ["final_settlement", employeeId],
    enabled: !!employeeId,
    queryFn: async (): Promise<FinalSettlement> => {
      const { data, error } = await supabase.rpc("rpc_final_settlement", { p_employee_id: employeeId! });
      if (error) throw error;
      return data as unknown as FinalSettlement;
    },
  });
}

export function usePostGratuityProvision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => {
      const { data, error } = await supabase.rpc("rpc_post_gratuity_provision", { p_period: period });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["gratuity_provisions"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      if (res?.ok) toast.success(`Provision posted: LKR ${Number(res.total).toLocaleString()} (${res.employees} employees)`);
      else toast.info(res?.reason || "Nothing to post");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
