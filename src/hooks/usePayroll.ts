import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  runPayrollForEmployee,
  type PayrollComponent,
  type PayrollRule,
  type EmployeePayrollInput,
} from "@/lib/payrollRuleEngine";

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
  const [compsRes, rulesRes] = await Promise.all([
    supabase.from("payroll_components").select("*").eq("is_active", true),
    supabase.from("payroll_rules").select("*").eq("is_active", true).order("priority"),
  ]);
  if (compsRes.error) throw compsRes.error;
  if (rulesRes.error) throw rulesRes.error;
  return {
    components: (compsRes.data || []) as PayrollComponent[],
    rules: ((rulesRes.data || []) as unknown) as PayrollRule[],
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

      // Load rule engine config + employee statutory flags
      const [config, empRes] = await Promise.all([
        loadEngineConfig(),
        supabase.from("employees")
          .select("id,is_epf_applicable,is_etf_applicable,is_paye_applicable,employment_type")
          .in("id", input.employees.map((e) => e.employee_id)),
      ]);
      if (empRes.error) throw empRes.error;
      const empMap = new Map((empRes.data || []).map((e: any) => [e.id, e]));

      let totalGross = 0, totalDeductions = 0, totalNet = 0, totalEmployerEpf = 0, totalEmployerEtf = 0;

      const items = input.employees.map((emp) => {
        const empFlags = empMap.get(emp.employee_id) || {
          id: emp.employee_id,
          is_epf_applicable: true,
          is_etf_applicable: true,
          is_paye_applicable: false,
        };
        const engineInput: EmployeePayrollInput = {
          id: emp.employee_id,
          is_epf_applicable: !!empFlags.is_epf_applicable,
          is_etf_applicable: !!empFlags.is_etf_applicable,
          is_paye_applicable: !!empFlags.is_paye_applicable,
          employment_type: empFlags.employment_type,
          basic_salary: emp.basic_salary,
          overtime_pay: emp.overtime_pay || 0,
          bonuses: emp.bonuses || 0,
          allowances: emp.allowances || 0,
          other_deductions: emp.other_deductions || 0,
        };

        const result = runPayrollForEmployee(engineInput, config.rules, config.components);

        totalGross += result.gross_pay;
        totalDeductions += result.total_deductions;
        totalNet += result.net_pay;
        totalEmployerEpf += result.employer_epf;
        totalEmployerEtf += result.employer_etf;

        return {
          employee_id: emp.employee_id,
          basic_salary: emp.basic_salary,
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
        };
      });

      // Create run
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
      }).select().single();
      if (error) throw error;

      // Create run items
      const runItems = items.map((item) => ({ ...item, run_id: run.id }));
      const { error: itemsError } = await supabase.from("payroll_run_items").insert(runItems);
      if (itemsError) throw itemsError;

      writeAuditLog("Payroll Run Created", "payroll_runs", run.id, {
        run_number: runNumber, employee_count: items.length, total_net: totalNet,
      });
      return run;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success("Payroll run created via rule engine");
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
        .select("id,run_id,employee_id,basic_salary,overtime_pay,bonuses,allowances,other_deductions")
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
          basic_salary: Number(it.basic_salary || 0),
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

      // Calculate totals
      let totalGross = 0, totalDeductions = 0, totalNet = 0, totalEmployerEpf = 0, totalEmployerEtf = 0;

      const items = input.employees.map((emp) => {
        const grossPay = emp.basic_salary + (emp.overtime_pay || 0) + (emp.bonuses || 0) + (emp.allowances || 0);
        const employeeEpf = Math.round(emp.basic_salary * EPF_EMPLOYEE_RATE * 100) / 100;
        const employerEpf = Math.round(emp.basic_salary * EPF_EMPLOYER_RATE * 100) / 100;
        const employerEtf = Math.round(emp.basic_salary * ETF_EMPLOYER_RATE * 100) / 100;
        const totalDed = employeeEpf + (emp.other_deductions || 0);
        const netPay = grossPay - totalDed;

        totalGross += grossPay;
        totalDeductions += totalDed;
        totalNet += netPay;
        totalEmployerEpf += employerEpf;
        totalEmployerEtf += employerEtf;

        return {
          employee_id: emp.employee_id,
          basic_salary: emp.basic_salary,
          overtime_hours: emp.overtime_hours || 0,
          overtime_pay: emp.overtime_pay || 0,
          gross_pay: grossPay,
          employee_epf: employeeEpf,
          employer_epf: employerEpf,
          employer_etf: employerEtf,
          other_deductions: emp.other_deductions || 0,
          bonuses: emp.bonuses || 0,
          allowances: emp.allowances || 0,
          net_pay: netPay,
          payment_method: emp.payment_method || "bank_transfer",
          notes: emp.notes,
        };
      });

      // Create run
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
      }).select().single();
      if (error) throw error;

      // Create run items
      const runItems = items.map((item) => ({ ...item, run_id: run.id }));
      const { error: itemsError } = await supabase.from("payroll_run_items").insert(runItems);
      if (itemsError) throw itemsError;

      writeAuditLog("Payroll Run Created", "payroll_runs", run.id, {
        run_number: runNumber, employee_count: items.length, total_net: totalNet,
      });
      return run;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      toast.success("Payroll run created");
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
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (runId: string) => {
      // Get run data
      const { data: run } = await supabase.from("payroll_runs").select("*").eq("id", runId).single();
      if (!run) throw new Error("Run not found");

      // Create journal entry for GL integration
      const { data: je, error: jeError } = await supabase.from("journal_entries").insert({
        tenant_id: run.tenant_id,
        description: `Payroll - ${run.run_number} (${run.period_start} to ${run.period_end})`,
        entry_date: run.payment_date || run.period_end,
        reference: run.run_number,
        created_by: appUser?.id,
        status: "posted",
      }).select().single();

      if (jeError) {
        console.error("Journal entry creation failed:", jeError);
        // Continue without JE - update status anyway
      }

      const { error } = await supabase.from("payroll_runs").update({
        status: "processed",
        journal_entry_id: je?.id || null,
      }).eq("id", runId);
      if (error) throw error;

      writeAuditLog("Payroll Run Processed", "payroll_runs", runId, { journal_entry_id: je?.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      qc.invalidateQueries({ queryKey: ["journal_entries"] });
      toast.success("Payroll processed and posted to general ledger");
    },
    onError: (e: Error) => toast.error(e.message),
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
