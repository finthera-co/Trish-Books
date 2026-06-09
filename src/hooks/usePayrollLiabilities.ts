import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";

export type RemittanceType = "EPF_EMPLOYEE" | "EPF_EMPLOYER" | "ETF_EMPLOYER";

export const LIABILITY_LABELS: Record<RemittanceType, string> = {
  EPF_EMPLOYEE: "EPF Employee (8%)",
  EPF_EMPLOYER: "EPF Employer (12%)",
  ETF_EMPLOYER: "ETF Employer (3%)",
};

export type RemittanceStatus = "FULLY_REMITTED" | "OVERDUE" | "DUE_SOON" | "PENDING";

export interface LiabilitySummary {
  type: RemittanceType;
  label: string;
  accrued: number;
  remitted: number;
  outstanding: number;
  periodsOverdue: number;
  periodsDueSoon: number;
  oldestOverduePeriod: string | null;
}

export interface PeriodLiabilityRow {
  remittance_type: RemittanceType;
  period: string;
  accrued_amount: number;
  remitted_amount: number;
  outstanding_amount: number;
  due_date: string;
  remittance_status: RemittanceStatus;
}

export interface RunLiabilityRow {
  run_id: string;
  run_number: string;
  period_label: string;
  period_key: string;
  run_status: string;
  epf_employee: number;
  epf_employer: number;
  etf_employer: number;
  epf_total: number;
  etf_total: number;
  remittance_status: "PENDING" | "PARTIAL" | "REMITTED";
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
  status: string;
  voided_at: string | null;
  void_reason: string | null;
  reversal_journal_entry_id: string | null;
}

function r2(n: number) { return Math.round(n * 100) / 100; }

// ─── 2a. Aggregate summaries from payroll_liability_summary view ─────────────
export function usePayrollLiabilities() {
  return useQuery({
    queryKey: ["payroll_liabilities"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payroll_liability_summary")
        .select("*");
      if (error) throw error;

      type Agg = {
        accrued: number; remitted: number; outstanding: number;
        periodsOverdue: number; periodsDueSoon: number; oldestOverduePeriod: string | null;
      };
      const grouped = new Map<RemittanceType, Agg>();

      for (const row of data || []) {
        const type = row.remittance_type as RemittanceType;
        const existing = grouped.get(type) ?? {
          accrued: 0, remitted: 0, outstanding: 0,
          periodsOverdue: 0, periodsDueSoon: 0, oldestOverduePeriod: null,
        };
        existing.accrued += Number(row.accrued_amount);
        existing.remitted += Number(row.remitted_amount);
        existing.outstanding += Number(row.outstanding_amount);

        if (row.remittance_status === "OVERDUE" && Number(row.outstanding_amount) > 0) {
          existing.periodsOverdue += 1;
          if (!existing.oldestOverduePeriod || row.period < existing.oldestOverduePeriod) {
            existing.oldestOverduePeriod = row.period;
          }
        }
        if (row.remittance_status === "DUE_SOON" && Number(row.outstanding_amount) > 0) {
          existing.periodsDueSoon += 1;
        }
        grouped.set(type, existing);
      }

      return (["EPF_EMPLOYEE", "EPF_EMPLOYER", "ETF_EMPLOYER"] as RemittanceType[]).map((type) => ({
        type,
        label: LIABILITY_LABELS[type],
        accrued: r2(grouped.get(type)?.accrued ?? 0),
        remitted: r2(grouped.get(type)?.remitted ?? 0),
        outstanding: r2(grouped.get(type)?.outstanding ?? 0),
        periodsOverdue: grouped.get(type)?.periodsOverdue ?? 0,
        periodsDueSoon: grouped.get(type)?.periodsDueSoon ?? 0,
        oldestOverduePeriod: grouped.get(type)?.oldestOverduePeriod ?? null,
      })) as LiabilitySummary[];
    },
  });
}

// ─── 2b. Per-period rows from the view ──────────────────────────────────────
export function usePayrollLiabilityByPeriod() {
  return useQuery({
    queryKey: ["payroll_liability_by_period"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payroll_liability_summary")
        .select("*")
        .order("period", { ascending: false });
      if (error) throw error;
      return (data || []) as PeriodLiabilityRow[];
    },
  });
}

// ─── 2c. Per-run breakdown with remittance status ────────────────────────────
export function usePayrollLiabilityByRun() {
  return useQuery({
    queryKey: ["payroll_liability_by_run"],
    queryFn: async () => {
      const [{ data: results, error: resErr }, { data: periodData }] = await Promise.all([
        supabase
          .from("payroll_results")
          .select("component_code, value, run_id, payroll_runs(run_number, period_start, period_end, status)")
          .in("component_code", ["EPF_EMPLOYEE", "EPF_EMPLOYER", "ETF_EMPLOYER"]),
        (supabase as any)
          .from("payroll_liability_summary")
          .select("period, accrued_amount, remitted_amount"),
      ]);
      if (resErr) throw resErr;

      // Aggregate period-level totals from view to determine remittance status
      const periodTotals = new Map<string, { accrued: number; remitted: number }>();
      for (const row of periodData || []) {
        const p = row.period as string;
        const existing = periodTotals.get(p) ?? { accrued: 0, remitted: 0 };
        existing.accrued += Number(row.accrued_amount);
        existing.remitted += Number(row.remitted_amount);
        periodTotals.set(p, existing);
      }

      const byRun = new Map<string, {
        run_id: string; run_number: string; period_label: string;
        period_key: string; run_status: string;
        epf_employee: number; epf_employer: number; etf_employer: number;
      }>();

      for (const r of results || []) {
        const run = (r as any).payroll_runs;
        if (!run || (run.status !== "processed" && run.status !== "finalized")) continue;
        const period_key = ((run.period_start as string) || "").substring(0, 7);
        const existing = byRun.get(r.run_id) ?? {
          run_id: r.run_id,
          run_number: run.run_number,
          period_label: `${run.period_start} – ${run.period_end}`,
          period_key,
          run_status: run.status,
          epf_employee: 0, epf_employer: 0, etf_employer: 0,
        };
        if (r.component_code === "EPF_EMPLOYEE") existing.epf_employee += Number(r.value);
        if (r.component_code === "EPF_EMPLOYER") existing.epf_employer += Number(r.value);
        if (r.component_code === "ETF_EMPLOYER") existing.etf_employer += Number(r.value);
        byRun.set(r.run_id, existing);
      }

      return Array.from(byRun.values()).map((r): RunLiabilityRow => {
        const pt = periodTotals.get(r.period_key);
        let remittance_status: "PENDING" | "PARTIAL" | "REMITTED" = "PENDING";
        if (pt && pt.accrued > 0.01) {
          if (pt.remitted >= pt.accrued - 0.01) remittance_status = "REMITTED";
          else if (pt.remitted > 0.01) remittance_status = "PARTIAL";
        }
        return {
          ...r,
          epf_total: r2(r.epf_employee + r.epf_employer),
          etf_total: r2(r.etf_employer),
          remittance_status,
        };
      });
    },
  });
}

// ─── History ─────────────────────────────────────────────────────────────────
export function usePayrollRemittanceHistory() {
  return useQuery({
    queryKey: ["payroll_remittances"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payroll_remittances")
        .select("*")
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data || []) as PayrollRemittance[];
    },
  });
}

// ─── 2d. Void a remittance + create reversal JE ──────────────────────────────
export function useVoidRemittance() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async ({ remittance_id, void_reason }: { remittance_id: string; void_reason: string }) => {
      const { data: rem, error: fetchErr } = await (supabase as any)
        .from("payroll_remittances")
        .select("*")
        .eq("id", remittance_id)
        .single();
      if (fetchErr) throw fetchErr;
      if (rem.status === "voided") throw new Error("Remittance is already voided");

      // Reversal JE: Dr Bank / Cr Liability (opposite of original Dr Liability / Cr Bank)
      const { data: je, error: jeErr } = await supabase
        .from("journal_entries")
        .insert({
          tenant_id: appUser?.tenant_id,
          description: `REVERSAL: ${LIABILITY_LABELS[rem.remittance_type as RemittanceType] ?? rem.remittance_type} Remittance — ${rem.period}`,
          entry_date: format(new Date(), "yyyy-MM-dd"),
          reference: `VOID-${rem.reference ?? (remittance_id as string).substring(0, 8)}`,
          created_by: appUser?.id,
          status: "draft",
        })
        .select()
        .single();
      if (jeErr) throw jeErr;

      const { error: linesErr } = await supabase.from("journal_lines").insert([
        { journal_entry_id: je.id, account_id: rem.bank_account_id,      debit: rem.amount, credit: 0 },
        { journal_entry_id: je.id, account_id: rem.liability_account_id, debit: 0, credit: rem.amount },
      ]);
      if (linesErr) {
        await supabase.from("journal_entries").delete().eq("id", je.id);
        throw linesErr;
      }

      const { error: postErr } = await supabase
        .from("journal_entries").update({ status: "posted" }).eq("id", je.id);
      if (postErr) throw postErr;

      const { error: updateErr } = await (supabase as any)
        .from("payroll_remittances")
        .update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: appUser?.id,
          void_reason,
          reversal_journal_entry_id: je.id,
        })
        .eq("id", remittance_id);
      if (updateErr) throw updateErr;

      return { reversal_journal_entry_id: je.id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_liabilities"] });
      qc.invalidateQueries({ queryKey: ["payroll_remittances"] });
      qc.invalidateQueries({ queryKey: ["payroll_liability_by_run"] });
      qc.invalidateQueries({ queryKey: ["payroll_liability_by_period"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Remittance voided — reversal journal entry created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── 2e. Record remittance — upgraded with duplicate check + auto GL resolve ─
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
      // Duplicate guard: check for an active remittance for this type + period
      const { data: existing, error: checkErr } = await (supabase as any)
        .from("payroll_remittances")
        .select("id")
        .eq("remittance_type", input.remittance_type)
        .eq("period", input.period)
        .eq("status", "posted")
        .limit(1);
      if (checkErr) throw checkErr;
      if (existing && existing.length > 0) {
        const label = LIABILITY_LABELS[input.remittance_type];
        throw new Error(
          `A remittance for ${label} in period ${input.period} already exists. Void it first if it was recorded in error.`
        );
      }

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

      // GL: Dr Liability / Cr Bank
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

      await (supabase as any)
        .from("payroll_remittances")
        .update({ journal_entry_id: je.id })
        .eq("id", rem.id);

      return { remittance: rem, journal_entry_id: je.id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_liabilities"] });
      qc.invalidateQueries({ queryKey: ["payroll_remittances"] });
      qc.invalidateQueries({ queryKey: ["payroll_liability_by_period"] });
      qc.invalidateQueries({ queryKey: ["payroll_liability_by_run"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Remittance recorded and posted to GL");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
