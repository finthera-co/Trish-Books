import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";

export type RemittanceType = "EPF_EMPLOYEE" | "EPF_EMPLOYER" | "ETF_EMPLOYER";

export interface LiabilitySummary {
  type: RemittanceType;
  label: string;
  accrued: number;
  remitted: number;
  outstanding: number;
}

export interface PayrollRemittance {
  id: string;
  remittance_type: string;
  period: string;
  amount: number;
  payment_date: string;
  bank_account_id: string;
  liability_account_id: string;
  journal_entry_id: string | null;
  reference: string | null;
  notes: string | null;
  payroll_run_id: string | null;
  created_at: string;
}

const LIABILITY_LABELS: Record<RemittanceType, string> = {
  EPF_EMPLOYEE: "EPF Employee (8%)",
  EPF_EMPLOYER: "EPF Employer (12%)",
  ETF_EMPLOYER: "ETF Employer (3%)",
};

const COMPONENT_TO_LIABILITY: Record<string, RemittanceType> = {
  EPF_EMPLOYEE: "EPF_EMPLOYEE",
  EPF_EMPLOYER: "EPF_EMPLOYER",
  ETF_EMPLOYER: "ETF_EMPLOYER",
};

export function usePayrollLiabilities() {
  return useQuery({
    queryKey: ["payroll_liabilities"],
    queryFn: async () => {
      const [{ data: results }, { data: remittances }] = await Promise.all([
        supabase
          .from("payroll_results")
          .select("component_code, value, payroll_runs(status)")
          .in("component_code", ["EPF_EMPLOYEE", "EPF_EMPLOYER", "ETF_EMPLOYER"]),
        (supabase as any)
          .from("payroll_remittances")
          .select("remittance_type, amount"),
      ]);

      const accrued: Record<RemittanceType, number> = { EPF_EMPLOYEE: 0, EPF_EMPLOYER: 0, ETF_EMPLOYER: 0 };
      for (const r of results || []) {
        const liabilityType = COMPONENT_TO_LIABILITY[r.component_code];
        if (!liabilityType) continue;
        const run = (r as any).payroll_runs;
        if (run?.status === "processed" || run?.status === "finalized") {
          accrued[liabilityType] += Number(r.value || 0);
        }
      }

      const remitted: Record<RemittanceType, number> = { EPF_EMPLOYEE: 0, EPF_EMPLOYER: 0, ETF_EMPLOYER: 0 };
      for (const rem of remittances || []) {
        const t = rem.remittance_type as RemittanceType;
        if (remitted[t] !== undefined) remitted[t] += Number(rem.amount || 0);
      }

      return (["EPF_EMPLOYEE", "EPF_EMPLOYER", "ETF_EMPLOYER"] as RemittanceType[]).map((type) => ({
        type,
        label: LIABILITY_LABELS[type],
        accrued: Math.round(accrued[type] * 100) / 100,
        remitted: Math.round(remitted[type] * 100) / 100,
        outstanding: Math.round((accrued[type] - remitted[type]) * 100) / 100,
      })) as LiabilitySummary[];
    },
  });
}

export function usePayrollRemittanceHistory(type?: RemittanceType) {
  return useQuery({
    queryKey: ["payroll_remittances", type],
    queryFn: async () => {
      let query = (supabase as any)
        .from("payroll_remittances")
        .select("*")
        .order("payment_date", { ascending: false });
      if (type) query = query.eq("remittance_type", type);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as PayrollRemittance[];
    },
  });
}

export function usePayrollLiabilityByRun() {
  return useQuery({
    queryKey: ["payroll_liability_by_run"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_results")
        .select("component_code, value, run_id, payroll_runs(run_number, period_start, period_end, status)")
        .in("component_code", ["EPF_EMPLOYEE", "EPF_EMPLOYER", "ETF_EMPLOYER"]);
      if (error) throw error;

      const byRun = new Map<string, {
        run_id: string;
        run_number: string;
        period: string;
        status: string;
        epf_employee: number;
        epf_employer: number;
        etf_employer: number;
      }>();

      for (const r of data || []) {
        const run = (r as any).payroll_runs;
        if (!run || (run.status !== "processed" && run.status !== "finalized")) continue;
        const existing = byRun.get(r.run_id) || {
          run_id: r.run_id,
          run_number: run.run_number,
          period: `${run.period_start} – ${run.period_end}`,
          status: run.status,
          epf_employee: 0,
          epf_employer: 0,
          etf_employer: 0,
        };
        if (r.component_code === "EPF_EMPLOYEE") existing.epf_employee += Number(r.value);
        if (r.component_code === "EPF_EMPLOYER") existing.epf_employer += Number(r.value);
        if (r.component_code === "ETF_EMPLOYER") existing.etf_employer += Number(r.value);
        byRun.set(r.run_id, existing);
      }

      return Array.from(byRun.values());
    },
  });
}

export function useRecordRemittance() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      remittance_type: RemittanceType;
      period: string;
      amount: number;
      payment_date: string;
      bank_account_id: string;
      liability_account_id: string;
      reference?: string;
      notes?: string;
      payroll_run_id?: string;
    }) => {
      // Insert remittance
      const { data: rem, error: remErr } = await (supabase as any)
        .from("payroll_remittances")
        .insert({
          tenant_id: appUser?.tenant_id,
          remittance_type: input.remittance_type,
          period: input.period,
          amount: input.amount,
          payment_date: input.payment_date,
          bank_account_id: input.bank_account_id,
          liability_account_id: input.liability_account_id,
          reference: input.reference || null,
          notes: input.notes || null,
          payroll_run_id: input.payroll_run_id || null,
          created_by: appUser?.id,
        })
        .select()
        .single();
      if (remErr) throw remErr;

      // Post GL: Dr Liability / Cr Bank
      const { data: je, error: jeErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser?.tenant_id,
          description: `${LIABILITY_LABELS[input.remittance_type]} Remittance — ${input.period}`,
          entry_date: input.payment_date,
          reference: input.reference || `REM-${format(new Date(), "yyyyMMdd")}`,
          created_by: appUser?.id,
          status: "draft",
        })
        .select()
        .single();
      if (jeErr) throw jeErr;

      const { error: linesErr } = await supabase.from("journal_lines").insert([
        { journal_entry_id: je.id, account_id: input.liability_account_id, debit: input.amount, credit: 0 },
        { journal_entry_id: je.id, account_id: input.bank_account_id, debit: 0, credit: input.amount },
      ]);
      if (linesErr) { await supabase.from("journal_entries").delete().eq("id", je.id); throw linesErr; }

      await supabase.from("journal_entries").update({ status: "posted" }).eq("id", je.id);

      // Link JE to remittance
      await (supabase as any)
        .from("payroll_remittances")
        .update({ journal_entry_id: je.id })
        .eq("id", rem.id);

      return { remittance: rem, journal_entry_id: je.id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_liabilities"] });
      qc.invalidateQueries({ queryKey: ["payroll_remittances"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Remittance recorded and posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
