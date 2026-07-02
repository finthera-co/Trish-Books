import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  runPayrollForEmployee,
  hashRuleSet,
  type PayrollComponent,
  type PayrollRule,
  type EmployeePayrollInput,
} from "@/lib/payrollRuleEngine";
import { calculateApit, type ApitSchedule } from "@/lib/taxEngine";

/**
 * Effective APIT schedule for a pay date: tenant override first, system
 * default (tenant_id NULL) otherwise. Returns null when none configured —
 * PAYE is then skipped entirely.
 */
// 1-based month within the Sri Lanka tax year (April = 1 … March = 12).
function apitMonthIndex(periodEnd: string): number {
  const d = new Date(periodEnd);
  const m = d.getMonth() + 1, y = d.getFullYear();
  const tyStart = m >= 4 ? y : y - 1;
  return (y - tyStart) * 12 + (m - 4) + 1;
}

// Fraction of the tax year elapsed through period_end (0–1) — used for the
// cumulative APIT scale on NON-monthly schedules (monthly uses exact month/12).
function apitYearFraction(periodEnd: string): number {
  const pe = new Date(periodEnd);
  const m = pe.getMonth() + 1, y = pe.getFullYear();
  const startYear = m >= 4 ? y : y - 1;
  const start = new Date(startYear, 3, 1);            // 1 April
  const nextStart = new Date(startYear + 1, 3, 1);    // next 1 April
  const dayMs = 86400000;
  const daysInYear = Math.round((nextStart.getTime() - start.getTime()) / dayMs);
  const elapsed = Math.round((pe.getTime() - start.getTime()) / dayMs) + 1;
  return Math.min(1, Math.max(0, elapsed / daysInYear));
}

// Segregation of duties: when enabled, the run's creator may not approve/process it.
async function assertSegregationOfDuties(runId: string, tenantId: string, userId?: string) {
  const { data: ps } = await supabase.from("payroll_settings").select("enforce_sod").eq("tenant_id", tenantId).maybeSingle();
  if (!ps?.enforce_sod) return;
  const { data: run } = await supabase.from("payroll_runs").select("created_by").eq("id", runId).maybeSingle();
  if (userId && run?.created_by && run.created_by === userId) {
    throw new Error("Segregation of duties: the run's creator cannot approve or process it — another user must.");
  }
}

async function loadApitSchedule(tenantId: string, asOf: string): Promise<ApitSchedule | null> {
  const { data: schedules } = await supabase
    .from("apit_schedules" as any)
    .select("id, tenant_id, annual_relief, effective_from, effective_to, apit_brackets(id, bracket_order, annual_amount_up_to, rate)")
    .lte("effective_from", asOf)
    .or(`effective_to.is.null,effective_to.gte.${asOf}`);
  const rows = ((schedules as any[]) || []).filter(
    (s) => s.tenant_id === tenantId || s.tenant_id === null
  );
  // tenant-specific schedule wins over the system default
  const chosen =
    rows.find((s) => s.tenant_id === tenantId) ?? rows.find((s) => s.tenant_id === null);
  if (!chosen || !chosen.apit_brackets?.length) return null;
  return {
    id: chosen.id,
    annualRelief: Number(chosen.annual_relief),
    brackets: chosen.apit_brackets.map((b: any) => ({
      bracketOrder: b.bracket_order,
      annualAmountUpTo: b.annual_amount_up_to === null ? null : Number(b.annual_amount_up_to),
      rate: Number(b.rate),
    })),
  };
}

// ===== Payroll settings (segregation of duties) =====
export function usePayrollSettings() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["payroll_settings", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_settings").select("*").eq("tenant_id", appUser!.tenant_id).maybeSingle();
      if (error) throw error;
      return data as { enforce_sod: boolean; cash_round_to: number } | null;
    },
  });
}

export function useSavePayrollSettings() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: { enforce_sod?: boolean; cash_round_to?: number }) => {
      if (!appUser?.tenant_id) throw new Error("No tenant");
      const { error } = await supabase.from("payroll_settings").upsert(
        { tenant_id: appUser.tenant_id, ...input, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll_settings"] }); toast.success("Payroll controls saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Rule Engine Hooks =====
export function usePayrollComponents() {
  return useQuery({
    queryKey: ["payroll_components"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_components").select("*").eq("is_active", true);
      if (error) throw error;
      return data as PayrollComponent[];
    },
  });
}

export function usePayrollRules() {
  return useQuery({
    queryKey: ["payroll_rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_rules").select("*").eq("is_active", true).order("priority");
      if (error) throw error;
      return (data || []) as unknown as PayrollRule[];
    },
  });
}

async function loadEngineConfig() {
  // Load active components and the LATEST version of each active rule from payroll_rule_versions.
  // This is what gets locked into the run snapshot.
  const [compsRes, rulesRes] = await Promise.all([
    supabase.from("payroll_components").select("*").eq("is_active", true),
    supabase
      .from("payroll_rule_versions")
      .select("*")
      .eq("is_active", true)
      .order("rule_id")
      .order("version_no", { ascending: false }),
  ]);
  if (compsRes.error) throw compsRes.error;
  if (rulesRes.error) throw rulesRes.error;

  // Keep only the latest version per rule_id
  const latestByRule = new Map<string, any>();
  for (const v of rulesRes.data || []) {
    if (!latestByRule.has(v.rule_id)) latestByRule.set(v.rule_id, v);
  }
  const versionedRules: PayrollRule[] = Array.from(latestByRule.values()).map((v: any) => ({
    id: v.rule_id,
    rule_version_id: v.id,
    version_no: v.version_no,
    name: v.name,
    target_component_code: v.target_component_code,
    formula_type: v.formula_type,
    formula_value: Number(v.formula_value),
    base_component_code: v.base_component_code,
    expression: v.expression,
    condition_json: v.condition_json,
    priority: v.priority,
    is_active: v.is_active,
    effective_from: v.effective_from,
    effective_to: v.effective_to,
  }));

  return {
    components: (compsRes.data || []) as PayrollComponent[],
    rules: versionedRules,
    rawVersions: Array.from(latestByRule.values()),
  };
}

// Helper: Write audit log
async function writeAuditLog(action: string, tableName: string, recordId?: string, details?: Record<string, any>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const tenantId = await supabase.rpc("get_user_tenant_id");
    const userId = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
    await supabase.from("audit_logs").insert({
      action, table_name: tableName, record_id: recordId,
      user_id: userId.data?.id, tenant_id: tenantId.data, details: details || null,
    });
  } catch { /* silent */ }
}

// ===== Pay Schedules =====
export function usePaySchedules() {
  return useQuery({
    queryKey: ["pay_schedules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pay_schedules").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePaySchedule() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (schedule: { name: string; frequency: string; anchor_date?: string; description?: string }) => {
      const { data, error } = await supabase.from("pay_schedules").insert({ ...schedule, tenant_id: appUser?.tenant_id }).select().single();
      if (error) throw error;
      writeAuditLog("Pay Schedule Created", "pay_schedules", data.id, { name: schedule.name });
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pay_schedules"] }); toast.success("Pay schedule created"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Earning/Deduction Types =====
export function useEarningTypes() {
  return useQuery({
    queryKey: ["payroll_earning_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_earning_types").select("*").order("category", { ascending: true }).order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateEarningType() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (type: { name: string; category: string; is_taxable?: boolean; is_statutory?: boolean; rate?: number; description?: string }) => {
      const { data, error } = await supabase.from("payroll_earning_types").insert({ ...type, tenant_id: appUser?.tenant_id }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll_earning_types"] }); toast.success("Earning/deduction type created"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Payroll Runs =====
export function usePayrollRuns() {
  return useQuery({
    queryKey: ["payroll_runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*, pay_schedules(name), users!payroll_runs_created_by_fkey(first_name, last_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function usePayrollRunItems(runId?: string) {
  return useQuery({
    queryKey: ["payroll_run_items", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_run_items")
        .select("*, employees(first_name, last_name, department, epf_number, designation, employee_number, bank_account_no), payroll_item_details(*)")
        .eq("run_id", runId!)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!runId,
  });
}

export interface PayrollRunInput {
  pay_schedule_id?: string;
  period_start: string;
  period_end: string;
  payment_date?: string;
  notes?: string;
  employees: {
    employee_id: string;
    basic_salary: number;
    contractual_basic?: number; // full monthly basic — no-pay-leave per-day base
    hours_worked?: number;
    overtime_hours?: number;
    overtime_pay?: number;
    bonuses?: number;
    allowances?: number;
    non_epf_allowances?: number;
    arrears?: number;            // back-pay — EPF-able taxable earning
    other_deductions?: number;
    payment_method?: string;
    notes?: string;
    // Attendance pro-rata: basic_salary stays the FULL contractual basic;
    // attendance_deduction is stored separately (audit trail). The engine
    // runs on earned basic = basic_salary - attendance_deduction.
    working_days?: number;
    days_present?: number;
    paid_leave_days?: number;
    unpaid_absent_days?: number;
    attendance_deduction?: number;
  }[];
}

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: PayrollRunInput) => {
      // Guard against a duplicate run covering the same period (double-pay risk).
      const { data: overlapping } = await supabase.from("payroll_runs")
        .select("run_number, period_start, period_end")
        .neq("status", "voided")
        .lte("period_start", input.period_end)
        .gte("period_end", input.period_start)
        .limit(1);
      if (overlapping && overlapping.length > 0) {
        const o = overlapping[0] as any;
        throw new Error(`A payroll run already covers this period (${o.run_number}: ${o.period_start} → ${o.period_end}). Void it or adjust the dates.`);
      }

      // Generate a concurrency-safe per-tenant run number (atomic counter).
      const { data: rnData, error: rnErr } = await supabase.rpc("next_tenant_number", {
        p_tenant_id: appUser!.tenant_id, p_key: "payroll_run",
      });
      if (rnErr) throw rnErr;
      const runNumber = `PR-${String(Number(rnData) || 1).padStart(5, "0")}`;

      // Load rule engine config + employee statutory flags + APIT schedule
      const [config, empRes, apitSchedule] = await Promise.all([
        loadEngineConfig(),
        supabase.from("employees")
          .select("id,is_epf_applicable,is_etf_applicable,is_paye_applicable,employment_type,pay_rate_type,bik_monthly_value")
          .in("id", input.employees.map((e) => e.employee_id)),
        loadApitSchedule(appUser!.tenant_id, input.period_end),
      ]);
      if (empRes.error) throw empRes.error;
      const empMap = new Map((empRes.data || []).map((e: any) => [e.id, e]));

      // Active salary-loan installments — folded into other deductions (capped at balance).
      const { data: loansData } = await supabase.from("employee_loans")
        .select("employee_id, monthly_installment, balance")
        .eq("status", "active").gt("balance", 0)
        .in("employee_id", input.employees.map((e) => e.employee_id));
      const loanByEmp = new Map<string, number>();
      ((loansData as any[]) || []).forEach((l) => {
        const amt = Math.min(Number(l.monthly_installment) || 0, Number(l.balance) || 0);
        if (amt > 0) loanByEmp.set(l.employee_id, (loanByEmp.get(l.employee_id) || 0) + amt);
      });

      // No-pay-leave proration (single source). Pull approved leave for the
      // period grouped by type, plus the period's working-day denominator
      // (Mon–Sat excl holidays), then prorate basic for unpaid leave days.
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const empIdList = input.employees.map((e) => e.employee_id);
      const [leaveRes, wdRes, ytdRes] = await Promise.all([
        supabase.rpc("rpc_period_leave_summary", { p_period_start: input.period_start, p_period_end: input.period_end, p_employee_ids: empIdList }),
        supabase.rpc("count_working_days", { p_tenant_id: appUser!.tenant_id, p_start: input.period_start, p_end: input.period_end, p_is_half_day: false } as any),
        supabase.rpc("rpc_ytd_payroll", { p_before: input.period_start, p_employee_ids: empIdList }),
      ]);
      const workingDays = Number(wdRes.data) || 0;
      const unpaidLeaveByEmp = new Map<string, number>();
      ((leaveRes.data as any[]) || []).forEach((r) => {
        if (r.treatment === "unpaid") unpaidLeaveByEmp.set(r.employee_id, (unpaidLeaveByEmp.get(r.employee_id) || 0) + (Number(r.days_taken) || 0));
      });
      // Year-to-date gross + PAYE for the cumulative APIT method.
      const ytdByEmp = new Map<string, { gross: number; paye: number }>();
      ((ytdRes.data as any[]) || []).forEach((r) => {
        ytdByEmp.set(r.employee_id, { gross: Number(r.ytd_gross) || 0, paye: Number(r.ytd_paye) || 0 });
      });
      const apitMonth = apitMonthIndex(input.period_end);
      // Non-monthly schedules scale the cumulative APIT by the elapsed year fraction.
      let payFrequency = "monthly";
      if (input.pay_schedule_id) {
        const { data: sched } = await supabase.from("pay_schedules").select("frequency").eq("id", input.pay_schedule_id).maybeSingle();
        if (sched?.frequency) payFrequency = sched.frequency;
      }
      const apitYearFrac = payFrequency === "monthly" ? undefined : apitYearFraction(input.period_end);

      let totalGross = 0, totalDeductions = 0, totalNet = 0, totalEmployerEpf = 0, totalEmployerEtf = 0, totalPaye = 0;
      const ruleSetHash = hashRuleSet(config.rules);

      // Capture per-employee traces for the immutable ledger
      const perEmployeeTraces: Array<{
        employee_id: string;
        engineInput: EmployeePayrollInput;
        traces: Record<string, any>;
      }> = [];

      const items = input.employees.map((emp) => {
        const empFlags = empMap.get(emp.employee_id) || {
          id: emp.employee_id,
          is_epf_applicable: true,
          is_etf_applicable: true,
          is_paye_applicable: false,
        };
        // The rule engine (and therefore EPF/ETF, gross, net and GL posting via
        // payroll_results) runs on the EARNED basic after the attendance
        // (no-pay) deduction. The full contractual basic is persisted on the
        // run item alongside the deduction.
        // No-pay leave reduces basic for salaried staff (prorated on working days).
        // Hourly staff are paid on hours, so leave doesn't cut their basic here.
        const unpaidLeaveDays = unpaidLeaveByEmp.get(emp.employee_id) || 0;
        const isHourly = (empFlags.pay_rate_type ?? "monthly") === "hourly";
        // No-pay leave is valued at the contractual day rate, on the employee's own
        // working-day count (per-shift), falling back to the tenant default.
        const fullBasic = emp.contractual_basic ?? emp.basic_salary;
        const empWorkingDays = emp.working_days && emp.working_days > 0 ? emp.working_days : workingDays;
        const perDay = empWorkingDays > 0 ? fullBasic / empWorkingDays : 0;
        const leaveDeduction = isHourly ? 0 : r2(perDay * unpaidLeaveDays);
        const attendanceDeduction = r2((emp.attendance_deduction || 0) + leaveDeduction);
        const engineInput: EmployeePayrollInput = {
          id: emp.employee_id,
          is_epf_applicable: !!empFlags.is_epf_applicable,
          is_etf_applicable: !!empFlags.is_etf_applicable,
          is_paye_applicable: !!empFlags.is_paye_applicable,
          employment_type: empFlags.employment_type,
          basic_salary: emp.basic_salary - attendanceDeduction,
          overtime_pay: emp.overtime_pay || 0,
          bonuses: emp.bonuses || 0,
          // Arrears are back-pay of salary → EPF-able & taxable, so fold into allowances.
          allowances: (emp.allowances || 0) + (emp.arrears || 0),
          non_epf_allowances: emp.non_epf_allowances || 0,
          other_deductions: emp.other_deductions || 0,
          loan_deduction: 0, // capped to available net + re-applied below
        };
        const desiredLoan = loanByEmp.get(emp.employee_id) || 0;

        // First pass without the loan, to find what's left for loan recovery.
        let result = runPayrollForEmployee(engineInput, config.rules, config.components);

        // APIT (PAYE) — computed on gross + BIK, independent of the loan.
        let payeAmount = 0;
        let apitTrace: any = null;
        // Non-cash benefit (BIK): taxable for APIT only — added to the tax base, not
        // to cash gross/net or EPF.
        const bik = Number(empFlags.bik_monthly_value) || 0;
        if (engineInput.is_paye_applicable && apitSchedule) {
          // Cumulative (YTD) method — self-corrects for variable pay and bonuses.
          const ytd = ytdByEmp.get(emp.employee_id) || { gross: 0, paye: 0 };
          const apit = calculateApit(result.gross_pay + bik, apitSchedule, engineInput.bonuses || 0, {
            priorGross: ytd.gross, priorPaye: ytd.paye, monthIndex: apitMonth, yearFraction: apitYearFrac,
          });
          payeAmount = apit.monthlyApit;
          apitTrace = apit.trace;
        }

        // Cap loan recovery at the net actually available after statutory + other
        // deductions — never recover more than the employee is paid.
        const availableForLoan = Math.max(0, result.net_pay - payeAmount);
        const loanDeduction = Math.min(desiredLoan, availableForLoan);

        // Re-run with the capped loan so the traces/net reflect the real recovery.
        if (loanDeduction > 0) {
          result = runPayrollForEmployee({ ...engineInput, loan_deduction: loanDeduction }, config.rules, config.components);
        }

        // Inject PAYE into the final result.
        if (payeAmount > 0) {
          result.traces["PAYE"] = apitTrace as any;
          result.total_deductions += payeAmount;
          result.net_pay -= payeAmount;
          const netTrace = result.traces["NET_PAY"] as any;
          if (netTrace) {
            netTrace.result = result.net_pay;
            netTrace.evaluation_steps = [
              ...(netTrace.evaluation_steps || []),
              `Less APIT (PAYE) ${payeAmount} → ${result.net_pay}`,
            ];
          }
        }

        // Net pay never goes below zero.
        result.net_pay = Math.max(0, result.net_pay);

        perEmployeeTraces.push({ employee_id: emp.employee_id, engineInput, traces: result.traces });

        totalGross += result.gross_pay;
        totalDeductions += result.total_deductions;
        totalNet += result.net_pay;
        totalEmployerEpf += result.employer_epf;
        totalEmployerEtf += result.employer_etf;
        totalPaye += payeAmount;

        return {
          employee_id: emp.employee_id,
          basic_salary: emp.basic_salary, // earned (biometric) or full (manual) basic
          contractual_basic: emp.contractual_basic ?? emp.basic_salary, // full monthly basic for leave per-day
          epf_base: result.context?.EPF_BASE ?? null, // actual engine EPF base (for the statutory return)
          bik_value: bik, // non-cash taxable benefit (APIT base only)
          hours_worked: emp.hours_worked ?? null,
          overtime_hours: emp.overtime_hours || 0,
          overtime_pay: emp.overtime_pay || 0,
          gross_pay: result.gross_pay,
          employee_epf: result.employee_epf,
          employee_paye: payeAmount,
          employer_epf: result.employer_epf,
          employer_etf: result.employer_etf,
          other_deductions: emp.other_deductions || 0,
          loan_deduction: loanDeduction,
          bonuses: emp.bonuses || 0,
          allowances: emp.allowances || 0,
          non_epf_allowances: emp.non_epf_allowances || 0,
          arrears: emp.arrears || 0,
          net_pay: result.net_pay,
          payment_method: emp.payment_method || "bank_transfer",
          notes: emp.notes,
          working_days: emp.working_days ?? (workingDays || null),
          days_present: emp.days_present ?? null,
          paid_leave_days: emp.paid_leave_days ?? null,
          unpaid_absent_days: r2((emp.unpaid_absent_days ?? 0) + (isHourly ? 0 : unpaidLeaveDays)) || null,
          attendance_deduction: attendanceDeduction,
        };
      });

      // Create run (with locked rule-set hash)
      const { data: run, error } = await supabase.from("payroll_runs").insert({
        tenant_id: appUser?.tenant_id,
        run_number: runNumber,
        pay_schedule_id: input.pay_schedule_id || null,
        period_start: input.period_start,
        period_end: input.period_end,
        payment_date: input.payment_date || null,
        status: "draft",
        total_gross: totalGross,
        total_deductions: totalDeductions,
        total_net: totalNet,
        total_employer_epf: totalEmployerEpf,
        total_employer_etf: totalEmployerEtf,
        total_paye: totalPaye,
        notes: input.notes,
        created_by: appUser?.id,
        rule_set_version_hash: ruleSetHash,
      }).select().single();
      if (error) throw error;

      // Cache layer: legacy run items (kept for backward-compat with PayStub UI)
      const runItems = items.map((item) => ({ ...item, run_id: run.id }));
      const { error: itemsError } = await supabase.from("payroll_run_items").insert(runItems);
      if (itemsError) throw itemsError;
      // Loan balances are reduced when the run is PROCESSED (posted to GL), not at
      // draft creation — see useProcessPayrollRun. This keeps the receivable in
      // step with the GL and avoids reducing balances for an abandoned draft.

      // ====== Immutable ledger writes ======
      // 1. Run snapshot (frozen rule-set + employee snapshots)
      await supabase.from("payroll_run_snapshots").insert({
        run_id: run.id,
        tenant_id: appUser?.tenant_id,
        rule_set_version_hash: ruleSetHash,
        rule_set: config.rawVersions as any,
        employee_snapshots: perEmployeeTraces.map((p) => p.engineInput) as any,
      });

      // 2. payroll_results: one row per (employee, component) with full trace
      const componentNameByCode = new Map(config.components.map((c) => [c.code, c.name]));
      const resultRows: any[] = [];
      for (const pet of perEmployeeTraces) {
        for (const [code, trace] of Object.entries(pet.traces)) {
          resultRows.push({
            tenant_id: appUser?.tenant_id,
            run_id: run.id,
            employee_id: pet.employee_id,
            component_code: code,
            component_name: componentNameByCode.get(code) || code,
            value: (trace as any).result,
            rule_id: (trace as any).rule_id,
            rule_version_id: (trace as any).rule_version_id,
            calculation_trace: trace as any,
          });
        }
      }
      if (resultRows.length > 0) {
        // chunk to avoid payload limits
        for (let i = 0; i < resultRows.length; i += 500) {
          const chunk = resultRows.slice(i, i + 500);
          const { error: prErr } = await supabase.from("payroll_results").insert(chunk);
          if (prErr) throw prErr;
        }
      }

      writeAuditLog("Payroll Run Created", "payroll_runs", run.id, {
        run_number: runNumber,
        employee_count: items.length,
        total_net: totalNet,
        rule_set_version_hash: ruleSetHash,
        result_rows: resultRows.length,
      });
      return run;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      qc.invalidateQueries({ queryKey: ["payroll_results"] });
      toast.success("Payroll run created with full audit trace");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Recalculate Draft Runs (re-applies current rule set) =====
export function useRecalculateDraftRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const config = await loadEngineConfig();

      // Get all draft runs and their items
      const { data: drafts, error: dErr } = await supabase
        .from("payroll_runs").select("id,tenant_id,period_start,period_end,pay_schedule_id,pay_schedules(frequency)").eq("status", "draft");
      if (dErr) throw dErr;
      if (!drafts || drafts.length === 0) return { runs: 0, items: 0 };

      const runIds = drafts.map((r) => r.id);
      const { data: items, error: iErr } = await supabase
        .from("payroll_run_items")
        .select("id,run_id,employee_id,basic_salary,contractual_basic,overtime_pay,bonuses,allowances,non_epf_allowances,arrears,other_deductions,attendance_deduction,bik_value,loan_deduction")
        .in("run_id", runIds);
      if (iErr) throw iErr;
      if (!items || items.length === 0) return { runs: drafts.length, items: 0 };

      // Load employee flags
      const empIds = Array.from(new Set(items.map((it) => it.employee_id)));
      const { data: emps } = await supabase
        .from("employees")
        .select("id,is_epf_applicable,is_etf_applicable,is_paye_applicable,employment_type,pay_rate_type")
        .in("id", empIds);
      const empMap = new Map((emps || []).map((e: any) => [e.id, e]));

      // APIT/PAYE schedule (same source as the create path) so recalc matches.
      const apitSchedule = await loadApitSchedule(drafts[0].tenant_id, new Date().toISOString().slice(0, 10));

      // Per-run no-pay-leave + working-day denominator, re-derived so recalc
      // reflects leave approved after the draft was created.
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const runWorkingDays = new Map<string, number>();
      const runUnpaidLeave = new Map<string, Map<string, number>>();
      const runYtd = new Map<string, Map<string, { gross: number; paye: number }>>();
      const runMonth = new Map<string, number>();
      const runYearFrac = new Map<string, number | undefined>();
      for (const d of drafts as any[]) {
        const empIdsForRun = items.filter((it) => it.run_id === d.id).map((it) => it.employee_id);
        const [lr, wd, ytd] = await Promise.all([
          supabase.rpc("rpc_period_leave_summary", { p_period_start: d.period_start, p_period_end: d.period_end, p_employee_ids: null }),
          supabase.rpc("count_working_days", { p_tenant_id: d.tenant_id, p_start: d.period_start, p_end: d.period_end, p_is_half_day: false } as any),
          supabase.rpc("rpc_ytd_payroll", { p_before: d.period_start, p_employee_ids: empIdsForRun }),
        ]);
        runWorkingDays.set(d.id, Number(wd.data) || 0);
        const m = new Map<string, number>();
        ((lr.data as any[]) || []).forEach((r) => { if (r.treatment === "unpaid") m.set(r.employee_id, (m.get(r.employee_id) || 0) + (Number(r.days_taken) || 0)); });
        runUnpaidLeave.set(d.id, m);
        const y = new Map<string, { gross: number; paye: number }>();
        ((ytd.data as any[]) || []).forEach((r) => y.set(r.employee_id, { gross: Number(r.ytd_gross) || 0, paye: Number(r.ytd_paye) || 0 }));
        runYtd.set(d.id, y);
        runMonth.set(d.id, apitMonthIndex(d.period_end));
        const freq = (d as any).pay_schedules?.frequency || "monthly";
        runYearFrac.set(d.id, freq === "monthly" ? undefined : apitYearFraction(d.period_end));
      }

      // Recompute each item via the engine
      const runTotals = new Map<string, { gross: number; ded: number; net: number; eEpf: number; eEtf: number; paye: number }>();
      let updated = 0;

      for (const it of items) {
        const ef = empMap.get(it.employee_id) || { id: it.employee_id, is_epf_applicable: true, is_etf_applicable: true, is_paye_applicable: false };
        // Re-derive the no-pay-leave deduction for this run's period.
        const isHourly = (ef.pay_rate_type ?? "monthly") === "hourly";
        const unpaidLeaveDays = runUnpaidLeave.get(it.run_id)?.get(it.employee_id) || 0;
        const wd = runWorkingDays.get(it.run_id) || 0;
        const earnedBasic = Number(it.basic_salary || 0); // engine base (already absence-reduced for biometric)
        // No-pay leave per-day uses the full contractual basic, not the reduced figure.
        const contractualBasic = Number((it as any).contractual_basic ?? it.basic_salary ?? 0);
        const attendanceDeduction = isHourly ? 0 : r2((wd > 0 ? contractualBasic / wd : 0) * unpaidLeaveDays);
        const result = runPayrollForEmployee({
          id: it.employee_id,
          is_epf_applicable: !!ef.is_epf_applicable,
          is_etf_applicable: !!ef.is_etf_applicable,
          is_paye_applicable: !!ef.is_paye_applicable,
          employment_type: ef.employment_type,
          basic_salary: earnedBasic - attendanceDeduction,
          overtime_pay: Number(it.overtime_pay || 0),
          bonuses: Number(it.bonuses || 0),
          allowances: Number(it.allowances || 0) + Number((it as any).arrears || 0),
          non_epf_allowances: Number((it as any).non_epf_allowances || 0),
          other_deductions: Number(it.other_deductions || 0),
          loan_deduction: Number((it as any).loan_deduction || 0),
        }, config.rules, config.components);

        // APIT/PAYE: bracket lookup outside the rule engine (same as create path).
        let payeAmount = 0;
        if (ef.is_paye_applicable && apitSchedule) {
          // Cumulative (YTD) method — matches the create path.
          const ytd = runYtd.get(it.run_id)?.get(it.employee_id) || { gross: 0, paye: 0 };
          payeAmount = calculateApit(result.gross_pay + Number((it as any).bik_value || 0), apitSchedule, Number(it.bonuses || 0), {
            priorGross: ytd.gross, priorPaye: ytd.paye, monthIndex: runMonth.get(it.run_id) || 1,
            yearFraction: runYearFrac.get(it.run_id),
          }).monthlyApit || 0;
        }
        const netPay = Math.max(0, result.net_pay - payeAmount); // never below zero
        const totalDed = result.total_deductions + payeAmount;

        await supabase.from("payroll_run_items").update({
          gross_pay: result.gross_pay,
          epf_base: result.context?.EPF_BASE ?? null,
          employee_epf: result.employee_epf,
          employee_paye: payeAmount,
          employer_epf: result.employer_epf,
          employer_etf: result.employer_etf,
          net_pay: netPay,
          attendance_deduction: attendanceDeduction,
          unpaid_absent_days: isHourly ? 0 : unpaidLeaveDays,
        }).eq("id", it.id);
        updated++;

        const t = runTotals.get(it.run_id) || { gross: 0, ded: 0, net: 0, eEpf: 0, eEtf: 0, paye: 0 };
        t.gross += result.gross_pay;
        t.ded += totalDed;
        t.net += netPay;
        t.eEpf += result.employer_epf;
        t.eEtf += result.employer_etf;
        t.paye += payeAmount;
        runTotals.set(it.run_id, t);
      }

      // Update run totals
      for (const [runId, t] of runTotals) {
        await supabase.from("payroll_runs").update({
          total_gross: t.gross, total_deductions: t.ded, total_net: t.net,
          total_employer_epf: t.eEpf, total_employer_etf: t.eEtf, total_paye: t.paye,
        }).eq("id", runId);
      }

      writeAuditLog("Draft Payroll Runs Recalculated", "payroll_runs", undefined, { runs: drafts.length, items: updated });
      return { runs: drafts.length, items: updated };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      qc.invalidateQueries({ queryKey: ["payroll_run_items"] });
      toast.success(`Recalculated ${r.items} items across ${r.runs} draft run(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}



export function useApprovePayrollRun() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (runId: string) => {
      if (appUser) await assertSegregationOfDuties(runId, appUser.tenant_id, appUser.id);
      const { error } = await supabase.from("payroll_runs").update({
        status: "approved",
        approved_by: appUser ? `${appUser.first_name} ${appUser.last_name}` : "Unknown",
        approved_at: new Date().toISOString(),
      }).eq("id", runId);
      if (error) throw error;
      writeAuditLog("Payroll Run Approved", "payroll_runs", runId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success("Payroll run approved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useProcessPayrollRun() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (runId: string) => {
      if (appUser) await assertSegregationOfDuties(runId, appUser.tenant_id, appUser.id);
      // Delegates to edge function which reads payroll_results, looks up
      // payroll_component_accounts mapping, builds a balanced double-entry
      // journal, and posts it. Returns 422 with `unmapped` array if mapping incomplete.
      const { data, error } = await supabase.functions.invoke("post-payroll-gl", {
        body: { run_id: runId },
      });
      if (error) throw error;
      if (data && (data as any).ok === false) {
        throw new Error((data as any).error || "Failed to post payroll to GL");
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      // Now that the run is posted, reduce loan balances + record repayments
      // (idempotent per run via the loan_repayments unique constraint).
      await supabase.rpc("rpc_apply_loan_repayments", { p_run_id: runId });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
      qc.invalidateQueries({ queryKey: ["employee_loans"] });
      toast.success("Payroll posted to General Ledger");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePayrollGLPreview(runId: string | undefined) {
  return useQuery({
    queryKey: ["payroll_gl_preview", runId],
    enabled: !!runId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("post-payroll-gl", {
        body: { run_id: runId, dry_run: true },
      });
      if (error) throw error;
      if (data && (data as any).ok === false) {
        throw new Error((data as any).error || "Preview failed");
      }
      return data as {
        ok: true;
        dry_run: true;
        lines: { account_id: string; debit: number; credit: number }[];
        total_debit: number;
        total_credit: number;
        line_count: number;
        unmapped?: { component_code: string; amount: number }[];
      };
    },
  });
}

export function useVoidPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arg: string | { runId: string; reason?: string }) => {
      const runId = typeof arg === "string" ? arg : arg.runId;
      const reason = typeof arg === "string" ? undefined : arg.reason;
      // Reverses the GL journal entry + restores loan balances, then marks voided.
      const { error } = await supabase.rpc("rpc_void_payroll_run", { p_run_id: runId, p_reason: reason ?? null });
      if (error) throw error;
      writeAuditLog("Payroll Run Voided", "payroll_runs", runId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["employee_loans"] });
      toast.success("Payroll run voided — GL reversed, loan balances restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Finalize Payroll Run (lock as immutable) =====
export function useFinalizePayrollRun() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.from("payroll_runs").update({
        status: "finalized",
        finalized_at: new Date().toISOString(),
        finalized_by: appUser?.id,
      }).eq("id", runId);
      if (error) throw error;

      // Settle leave that falls in this run's period (approved -> settled, reserved -> taken).
      // Idempotent: only touches 'approved' requests.
      const { data: runRow } = await supabase.from("payroll_runs")
        .select("period_start, period_end").eq("id", runId).single();
      if (runRow) {
        await supabase.rpc("settle_leave_for_period", {
          p_period_start: runRow.period_start, p_period_end: runRow.period_end, p_run_id: runId,
        });
      }

      writeAuditLog("Payroll Run Finalized", "payroll_runs", runId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success("Payroll run finalized — now immutable");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Publish payslips to employees (visibility gate + notify) =====
export function usePublishPayslips() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (run: { id: string; period_start: string; period_end: string }) => {
      const { error } = await supabase.from("payroll_runs").update({
        payslips_published_at: new Date().toISOString(),
        published_by: appUser?.id,
      }).eq("id", run.id);
      if (error) throw error;

      // Notify each employee in the run that has a self-service login.
      const { data: items } = await supabase
        .from("payroll_run_items")
        .select("employees(user_id, first_name)")
        .eq("run_id", run.id);
      const period = `${run.period_start} → ${run.period_end}`;
      const rows = (items ?? [])
        .map((it: any) => it.employees)
        .filter((e: any) => e?.user_id)
        .map((e: any) => ({
          tenant_id: appUser?.tenant_id,
          user_id: e.user_id,
          type: "payroll",
          title: "Payslip ready",
          message: `Your payslip for ${period} is now available.`,
          link: "/me/payslips",
        }));
      if (rows.length) await supabase.from("notifications").insert(rows);

      writeAuditLog("Payslips Published", "payroll_runs", run.id, { notified: rows.length });
      return rows.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      qc.invalidateQueries({ queryKey: ["my_payslips"] });
      toast.success(`Payslips published${count ? ` — ${count} employee${count === 1 ? "" : "s"} notified` : ""}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ===== Read Immutable Results (audit trail) =====
export function usePayrollResults(runId?: string) {
  return useQuery({
    queryKey: ["payroll_results", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_results")
        .select("*, employees(first_name,last_name,department,epf_number)")
        .eq("run_id", runId!)
        .order("employee_id")
        .order("component_code");
      if (error) throw error;
      return data;
    },
    enabled: !!runId,
  });
}

export function usePayrollRunSnapshot(runId?: string) {
  return useQuery({
    queryKey: ["payroll_run_snapshot", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_run_snapshots")
        .select("*")
        .eq("run_id", runId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!runId,
  });
}

// ===== Simulate Payroll (what-if mode, no persistence) =====
export interface SimulatePayrollInput {
  employee_id?: string;
  overrides?: {
    basic_salary?: number;
    overtime_pay?: number;
    bonuses?: number;
    allowances?: number;
    other_deductions?: number;
    is_epf_applicable?: boolean;
    is_etf_applicable?: boolean;
    is_paye_applicable?: boolean;
    employment_type?: string;
  };
  synthetic_employee?: {
    basic_salary: number;
    is_epf_applicable?: boolean;
    is_etf_applicable?: boolean;
    is_paye_applicable?: boolean;
    overtime_pay?: number;
    bonuses?: number;
    allowances?: number;
    other_deductions?: number;
  };
  as_of_date?: string;
}

export function useSimulatePayroll() {
  return useMutation({
    mutationFn: async (input: SimulatePayrollInput) => {
      const { data, error } = await supabase.functions.invoke("simulate-payroll", { body: input });
      if (error) throw error;
      return data;
    },
    onError: (e: Error) => toast.error(`Simulation failed: ${e.message}`),
  });
}

// ===== Period leave-by-type (for the Step-2 grid) =====
export interface PeriodLeaveByEmployee {
  byCode: Record<string, { name: string; treatment: string; days: number }>;
  unpaidDays: number;
}
export function usePeriodLeaveSummary(periodStart?: string, periodEnd?: string, employeeIds?: string[]) {
  return useQuery({
    queryKey: ["period_leave_summary", periodStart, periodEnd, (employeeIds || []).join(",")],
    enabled: !!periodStart && !!periodEnd && !!employeeIds && employeeIds.length > 0,
    queryFn: async (): Promise<Record<string, PeriodLeaveByEmployee>> => {
      const { data, error } = await supabase.rpc("rpc_period_leave_summary", {
        p_period_start: periodStart!, p_period_end: periodEnd!, p_employee_ids: employeeIds!,
      });
      if (error) throw error;
      const map: Record<string, PeriodLeaveByEmployee> = {};
      ((data as any[]) || []).forEach((r) => {
        const m = (map[r.employee_id] ??= { byCode: {}, unpaidDays: 0 });
        m.byCode[r.leave_code] = { name: r.leave_name, treatment: r.treatment, days: Number(r.days_taken) || 0 };
        if (r.treatment === "unpaid") m.unpaidDays += Number(r.days_taken) || 0;
      });
      return map;
    },
  });
}
