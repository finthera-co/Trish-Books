// Payroll Simulation Engine — what-if mode (NO persistence).
// Loads current rules + employee, optionally applies overrides, returns full breakdown with traces.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SimulateRequest {
  employee_id?: string;
  // Direct attribute overrides — used INSTEAD of stored values when provided
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
  // Or supply a full synthetic employee with no DB lookup
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
  // Optional date for selecting effective rule versions (defaults to today)
  as_of_date?: string;
}

/* ====== Embedded engine (mirrors src/lib/payrollRuleEngine.ts) ====== */
type FormulaType = "PERCENTAGE" | "FIXED" | "DERIVED" | "EXPRESSION" | "CONDITIONAL";
interface Rule {
  id: string; name: string; target_component_code: string; formula_type: FormulaType;
  formula_value: number; base_component_code: string | null; expression: string | null;
  condition_json: any; priority: number; is_active: boolean;
  rule_version_id?: string; version_no?: number;
}
interface Component { id: string; code: string; name: string; kind: string; is_active: boolean; }
interface EmpInput {
  id: string; is_epf_applicable: boolean; is_etf_applicable: boolean; is_paye_applicable: boolean;
  employment_type?: string; basic_salary: number; overtime_pay?: number; bonuses?: number;
  allowances?: number; other_deductions?: number;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function evalCondition(cond: any, emp: EmpInput, steps: string[]) {
  if (!cond) { steps.push("No condition → applies"); return true; }
  const { field, operator, value } = cond;
  const actual = (emp as any)[field];
  steps.push(`Cond: ${field}=${JSON.stringify(actual)} ${operator} ${JSON.stringify(value)}`);
  switch (operator) {
    case "==": return actual === value;
    case "!=": return actual !== value;
    case ">": return actual > value;
    case ">=": return actual >= value;
    case "<": return actual < value;
    case "<=": return actual <= value;
    case "in": return Array.isArray(value) && value.includes(actual);
  }
  return false;
}

function evalExpr(expr: string, ctx: Record<string, number>, refs: Record<string, number>, steps: string[]) {
  const tokens = expr.match(/[A-Z_][A-Z0-9_]*|[0-9.]+|[+\-*/()]/g) || [];
  const safe = tokens.map((t) => {
    if (/^[A-Z_]/.test(t)) {
      const v = ctx[t]; const n = typeof v === "number" && isFinite(v) ? v : 0;
      refs[t] = n; return String(n);
    }
    return t;
  }).join(" ");
  steps.push(`${expr}  →  ${safe}`);
  try { return Number(new Function(`return (${safe});`)()) || 0; } catch { return 0; }
}

function runEngine(emp: EmpInput, rules: Rule[], components: Component[]) {
  const ctx: Record<string, number> = {};
  for (const c of components) ctx[c.code] = 0;
  ctx.BASIC = emp.basic_salary || 0;
  ctx.OVERTIME = emp.overtime_pay || 0;
  ctx.BONUS = emp.bonuses || 0;
  ctx.ALLOWANCES = emp.allowances || 0;
  ctx.OTHER_DEDUCTIONS = emp.other_deductions || 0;

  const traces: Record<string, any> = {};
  const sorted = [...rules].filter((r) => r.is_active).sort((a, b) => a.priority - b.priority);

  for (const r of sorted) {
    const steps: string[] = [];
    const refs: Record<string, number> = {};
    const passed = evalCondition(r.condition_json, emp, steps);
    let result = 0, formula = "(skipped)", base = 0;
    if (passed) {
      if (r.formula_type === "PERCENTAGE") {
        base = r.base_component_code ? (ctx[r.base_component_code] || 0) : 0;
        if (r.base_component_code) refs[r.base_component_code] = base;
        result = round2(base * (Number(r.formula_value) / 100));
        formula = `${r.base_component_code}(${base}) × ${r.formula_value}% = ${result}`;
      } else if (r.formula_type === "FIXED") {
        result = Number(r.formula_value) || 0;
        formula = `FIXED = ${result}`;
      } else {
        result = round2(evalExpr(r.expression || "0", ctx, refs, steps));
        formula = r.expression || "0";
      }
      ctx[r.target_component_code] = result;
      steps.push(`= ${result}`);
    }
    traces[r.target_component_code] = {
      rule_id: r.id, rule_version_id: r.rule_version_id || null, rule_name: r.name,
      formula_type: r.formula_type, formula_applied: formula,
      base_component: r.base_component_code, base_value: base, inputs: refs,
      condition: r.condition_json, condition_passed: passed, result,
      evaluation_steps: steps, timestamp: new Date().toISOString(),
    };
  }

  return {
    context: ctx, traces,
    gross_pay: ctx.GROSS_PAY || 0,
    employee_epf: ctx.EPF_EMPLOYEE || 0,
    employer_epf: ctx.EPF_EMPLOYER || 0,
    employer_etf: ctx.ETF_EMPLOYER || 0,
    total_deductions: (ctx.EPF_EMPLOYEE || 0) + (ctx.OTHER_DEDUCTIONS || 0),
    net_pay: ctx.NET_PAY || 0,
  };
}

/* ====== HTTP handler ====== */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const body: SimulateRequest = await req.json().catch(() => ({}));

    // 1. Load components and active rules (RLS scopes by tenant)
    const [compsRes, rulesRes] = await Promise.all([
      supabase.from("payroll_components").select("*").eq("is_active", true),
      supabase.from("payroll_rules").select("*").eq("is_active", true).order("priority"),
    ]);
    if (compsRes.error) throw compsRes.error;
    if (rulesRes.error) throw rulesRes.error;

    // 2. Resolve employee
    let employee: EmpInput;
    if (body.synthetic_employee) {
      employee = {
        id: "synthetic",
        is_epf_applicable: body.synthetic_employee.is_epf_applicable ?? true,
        is_etf_applicable: body.synthetic_employee.is_etf_applicable ?? true,
        is_paye_applicable: body.synthetic_employee.is_paye_applicable ?? false,
        basic_salary: body.synthetic_employee.basic_salary,
        overtime_pay: body.synthetic_employee.overtime_pay || 0,
        bonuses: body.synthetic_employee.bonuses || 0,
        allowances: body.synthetic_employee.allowances || 0,
        other_deductions: body.synthetic_employee.other_deductions || 0,
      };
    } else if (body.employee_id) {
      const { data: emp, error: empErr } = await supabase
        .from("employees")
        .select("id,salary,is_epf_applicable,is_etf_applicable,is_paye_applicable,employment_type")
        .eq("id", body.employee_id).single();
      if (empErr) throw empErr;
      employee = {
        id: emp.id,
        is_epf_applicable: body.overrides?.is_epf_applicable ?? !!emp.is_epf_applicable,
        is_etf_applicable: body.overrides?.is_etf_applicable ?? !!emp.is_etf_applicable,
        is_paye_applicable: body.overrides?.is_paye_applicable ?? !!emp.is_paye_applicable,
        employment_type: body.overrides?.employment_type ?? emp.employment_type,
        basic_salary: body.overrides?.basic_salary ?? Number(emp.salary || 0),
        overtime_pay: body.overrides?.overtime_pay || 0,
        bonuses: body.overrides?.bonuses || 0,
        allowances: body.overrides?.allowances || 0,
        other_deductions: body.overrides?.other_deductions || 0,
      };
    } else {
      return new Response(JSON.stringify({ error: "Provide employee_id or synthetic_employee" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = runEngine(employee, rulesRes.data as Rule[], compsRes.data as Component[]);

    return new Response(JSON.stringify({
      simulation: true,
      persisted: false,
      as_of_date: body.as_of_date || new Date().toISOString().slice(0, 10),
      employee_input: employee,
      breakdown: {
        gross_pay: result.gross_pay,
        employee_epf: result.employee_epf,
        employer_epf: result.employer_epf,
        employer_etf: result.employer_etf,
        total_deductions: result.total_deductions,
        net_pay: result.net_pay,
      },
      context: result.context,
      traces: result.traces,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
