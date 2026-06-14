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
        .select("*, employees(first_name, last_name, department, epf_number)")
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
    overtime_hours?: number;
    overtime_pay?: number;
    bonuses?: number;
    allowances?: number;
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
      // Generate run number
      const { count } = await supabase.from("payroll_runs").select("*", { count: "exact", head: true });
      const runNumber = `PR-${String((count || 0) + 1).padStart(5, "0")}`;

      // Load rule engine config + employee statutory flags + APIT schedule
      const [config, empRes, apitSchedule] = await Promise.all([
        loadEngineConfig(),
        supabase.from("employees")
          .select("id,is_epf_applicable,is_etf_applicable,is_paye_applicable,employment_type")
          .in("id", input.employees.map((e) => e.employee_id)),
        loadApitSchedule(appUser!.tenant_id, input.period_end),
      ]);
      if (empRes.error) throw empRes.error;
      const empMap = new Map((empRes.data || []).map((e: any) => [e.id, e]));

      let totalGross = 0, totalDeductions = 0, totalNet = 0, totalEmployerEpf = 0, totalEmployerEtf = 0;
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
        const attendanceDeduction = emp.attendance_deduction || 0;
        const engineInput: EmployeePayrollInput = {
          id: emp.employee_id,
          is_epf_applicable: !!empFlags.is_epf_applicable,
          is_etf_applicable: !!empFlags.is_etf_applicable,
          is_paye_applicable: !!empFlags.is_paye_applicable,
          employment_type: empFlags.employment_type,
          basic_salary: emp.basic_salary - attendanceDeduction,
          overtime_pay: emp.overtime_pay || 0,
          bonuses: emp.bonuses || 0,
          allowances: emp.allowances || 0,
          other_deductions: emp.other_deductions || 0,
        };

        const result = runPayrollForEmployee(engineInput, config.rules, config.components);

        // APIT (PAYE): bracket schedules cannot be expressed in the rule
        // formula types, so it is computed by the shared tax engine and
        // injected as the PAYE component with a compatible trace. Credit-side
        // deduction only (like EPF Employee).
        let payeAmount = 0;
        if (engineInput.is_paye_applicable && apitSchedule) {
          const apit = calculateApit(result.gross_pay, apitSchedule);
          payeAmount = apit.monthlyApit;
          if (payeAmount > 0) {
            result.traces["PAYE"] = apit.trace as any;
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
        }

        perEmployeeTraces.push({ employee_id: emp.employee_id, engineInput, traces: result.traces });

        totalGross += result.gross_pay;
        totalDeductions += result.total_deductions;
        totalNet += result.net_pay;
        totalEmployerEpf += result.employer_epf;
        totalEmployerEtf += result.employer_etf;

        return {
          employee_id: emp.employee_id,
          basic_salary: emp.basic_salary, // full contractual basic — never pro-rated in storage
          overtime_hours: emp.overtime_hours || 0,
          overtime_pay: emp.overtime_pay || 0,
          gross_pay: result.gross_pay,
          employee_epf: result.employee_epf,
          employer_epf: result.employer_epf,
          employer_etf: result.employer_etf,
          other_deductions: emp.other_deductions || 0,
          bonuses: emp.bonuses || 0,
          allowances: emp.allowances || 0,
          net_pay: result.net_pay,
          payment_method: emp.payment_method || "bank_transfer",
          notes: emp.notes,
          working_days: emp.working_days ?? null,
          days_present: emp.days_present ?? null,
          paid_leave_days: emp.paid_leave_days ?? null,
          unpaid_absent_days: emp.unpaid_absent_days ?? null,
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
        notes: input.notes,
        created_by: appUser?.id,
        rule_set_version_hash: ruleSetHash,
      }).select().single();
      if (error) throw error;

      // Cache layer: legacy run items (kept for backward-compat with PayStub UI)
      const runItems = items.map((item) => ({ ...item, run_id: run.id }));
      const { error: itemsError } = await supabase.from("payroll_run_items").insert(runItems);
      if (itemsError) throw itemsError;

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
        .from("payroll_runs").select("id,tenant_id").eq("status", "draft");
      if (dErr) throw dErr;
      if (!drafts || drafts.length === 0) return { runs: 0, items: 0 };

      const runIds = drafts.map((r) => r.id);
      const { data: items, error: iErr } = await supabase
        .from("payroll_run_items")
        .select("id,run_id,employee_id,basic_salary,overtime_pay,bonuses,allowances,other_deductions,attendance_deduction")
        .in("run_id", runIds);
      if (iErr) throw iErr;
      if (!items || items.length === 0) return { runs: drafts.length, items: 0 };

      // Load employee flags
      const empIds = Array.from(new Set(items.map((it) => it.employee_id)));
      const { data: emps } = await supabase
        .from("employees")
        .select("id,is_epf_applicable,is_etf_applicable,is_paye_applicable,employment_type")
        .in("id", empIds);
      const empMap = new Map((emps || []).map((e: any) => [e.id, e]));

      // Recompute each item via the engine
      const runTotals = new Map<string, { gross: number; ded: number; net: number; eEpf: number; eEtf: number }>();
      let updated = 0;

      for (const it of items) {
        const ef = empMap.get(it.employee_id) || { id: it.employee_id, is_epf_applicable: true, is_etf_applicable: true, is_paye_applicable: false };
        const result = runPayrollForEmployee({
          id: it.employee_id,
          is_epf_applicable: !!ef.is_epf_applicable,
          is_etf_applicable: !!ef.is_etf_applicable,
          is_paye_applicable: !!ef.is_paye_applicable,
          employment_type: ef.employment_type,
          basic_salary: Number(it.basic_salary || 0) - Number(it.attendance_deduction || 0),
          overtime_pay: Number(it.overtime_pay || 0),
          bonuses: Number(it.bonuses || 0),
          allowances: Number(it.allowances || 0),
          other_deductions: Number(it.other_deductions || 0),
        }, config.rules, config.components);

        await supabase.from("payroll_run_items").update({
          gross_pay: result.gross_pay,
          employee_epf: result.employee_epf,
          employer_epf: result.employer_epf,
          employer_etf: result.employer_etf,
          net_pay: result.net_pay,
        }).eq("id", it.id);
        updated++;

        const t = runTotals.get(it.run_id) || { gross: 0, ded: 0, net: 0, eEpf: 0, eEtf: 0 };
        t.gross += result.gross_pay;
        t.ded += result.total_deductions;
        t.net += result.net_pay;
        t.eEpf += result.employer_epf;
        t.eEtf += result.employer_etf;
        runTotals.set(it.run_id, t);
      }

      // Update run totals
      for (const [runId, t] of runTotals) {
        await supabase.from("payroll_runs").update({
          total_gross: t.gross, total_deductions: t.ded, total_net: t.net,
          total_employer_epf: t.eEpf, total_employer_etf: t.eEtf,
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
  return useMutation({
    mutationFn: async (runId: string) => {
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
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      qc.invalidateQueries({ queryKey: ["period_account_movements"] });
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
    mutationFn: async (runId: string) => {
      const { error } = await supabase.from("payroll_runs").update({ status: "voided" }).eq("id", runId);
      if (error) throw error;
      writeAuditLog("Payroll Run Voided", "payroll_runs", runId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success("Payroll run voided");
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
      writeAuditLog("Payroll Run Finalized", "payroll_runs", runId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success("Payroll run finalized — now immutable");
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
