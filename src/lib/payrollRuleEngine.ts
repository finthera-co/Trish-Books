/**
 * Rule-Based Payroll Engine (SAP / QuickBooks style)
 * 
 * - Components define WHAT is calculated (Basic, Gross, EPF, Net Pay...)
 * - Rules define HOW each component is calculated (formula + condition)
 * - Engine executes rules in priority order against an employee context
 * 
 * Zero hardcoded statutory rates. All policy lives in the DB.
 */

export type FormulaType = "PERCENTAGE" | "FIXED" | "DERIVED" | "EXPRESSION" | "CONDITIONAL";
export type ComponentKind = "earning" | "deduction" | "employer_contribution" | "derived" | "base";

export interface PayrollComponent {
  id: string;
  code: string;
  name: string;
  kind: ComponentKind;
  is_active: boolean;
}

export interface PayrollRule {
  id: string;
  name: string;
  target_component_code: string;
  formula_type: FormulaType;
  formula_value: number;
  base_component_code: string | null;
  expression: string | null;
  condition_json: { field: string; operator: string; value: any } | null;
  priority: number;
  is_active: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface EmployeePayrollInput {
  // Employee attributes (used for condition evaluation)
  id: string;
  is_epf_applicable: boolean;
  is_etf_applicable: boolean;
  is_paye_applicable: boolean;
  employment_type?: string;
  // Manual inputs for this run
  basic_salary: number;
  overtime_pay?: number;
  bonuses?: number;
  allowances?: number;
  other_deductions?: number;
}

export type PayrollContext = Record<string, number>;

/* ---------------- Condition Engine ---------------- */
function evaluateCondition(
  condition: PayrollRule["condition_json"],
  employee: EmployeePayrollInput
): boolean {
  if (!condition) return true;
  const { field, operator, value } = condition;
  const actual = (employee as any)[field];
  switch (operator) {
    case "==": return actual === value;
    case "!=": return actual !== value;
    case ">": return actual > value;
    case ">=": return actual >= value;
    case "<": return actual < value;
    case "<=": return actual <= value;
    case "in": return Array.isArray(value) && value.includes(actual);
    default: return false;
  }
}

/* ---------------- Expression Evaluator ----------------
 * Safely evaluates expressions like "BASIC + OVERTIME + BONUS"
 * Only supports + - * / ( ) numbers and component codes from context.
 */
function evaluateExpression(expr: string, context: PayrollContext): number {
  // Replace component codes with their numeric values
  const tokens = expr.match(/[A-Z_][A-Z0-9_]*|[0-9.]+|[+\-*/()]/g) || [];
  const safeExpr = tokens.map((t) => {
    if (/^[A-Z_]/.test(t)) {
      const v = context[t];
      if (typeof v !== "number" || !isFinite(v)) return "0";
      return String(v);
    }
    if (/^[0-9.]+$/.test(t)) return t;
    if ("+-*/()".includes(t)) return t;
    return "0";
  }).join(" ");
  // eslint-disable-next-line no-new-func
  try { return Number(new Function(`return (${safeExpr});`)()) || 0; }
  catch { return 0; }
}

/* ---------------- Engine ---------------- */
export interface PayrollComputationResult {
  context: PayrollContext;
  applied_rules: { rule_id: string; rule_name: string; target: string; result: number; skipped?: boolean; reason?: string }[];
  // Convenience aggregates
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  employee_epf: number;
  employer_epf: number;
  employer_etf: number;
}

export function runPayrollForEmployee(
  employee: EmployeePayrollInput,
  rules: PayrollRule[],
  components: PayrollComponent[]
): PayrollComputationResult {
  // 1. Initialize context with manual inputs
  const context: PayrollContext = {};
  for (const c of components) context[c.code] = 0;
  context.BASIC = employee.basic_salary || 0;
  context.OVERTIME = employee.overtime_pay || 0;
  context.BONUS = employee.bonuses || 0;
  context.ALLOWANCES = employee.allowances || 0;
  context.OTHER_DEDUCTIONS = employee.other_deductions || 0;

  const applied: PayrollComputationResult["applied_rules"] = [];

  // 2. Sort rules by priority (lower runs first - derived/gross first, net last)
  const sorted = [...rules]
    .filter((r) => r.is_active)
    .sort((a, b) => a.priority - b.priority);

  // 3. Execute each rule
  for (const rule of sorted) {
    if (!evaluateCondition(rule.condition_json, employee)) {
      applied.push({ rule_id: rule.id, rule_name: rule.name, target: rule.target_component_code, result: 0, skipped: true, reason: "condition not met" });
      // Don't overwrite if rule didn't apply — context value stays at default (0)
      continue;
    }

    let result = 0;
    switch (rule.formula_type) {
      case "PERCENTAGE": {
        const base = rule.base_component_code ? (context[rule.base_component_code] || 0) : 0;
        result = round2(base * (Number(rule.formula_value) / 100));
        break;
      }
      case "FIXED": {
        result = Number(rule.formula_value) || 0;
        break;
      }
      case "DERIVED":
      case "EXPRESSION": {
        result = round2(evaluateExpression(rule.expression || "0", context));
        break;
      }
      case "CONDITIONAL": {
        // Conditional rules can use expression or a fixed value once condition passes
        result = rule.expression
          ? round2(evaluateExpression(rule.expression, context))
          : Number(rule.formula_value) || 0;
        break;
      }
    }

    context[rule.target_component_code] = result;
    applied.push({ rule_id: rule.id, rule_name: rule.name, target: rule.target_component_code, result });
  }

  return {
    context,
    applied_rules: applied,
    gross_pay: context.GROSS_PAY || 0,
    total_deductions: (context.EPF_EMPLOYEE || 0) + (context.OTHER_DEDUCTIONS || 0),
    net_pay: context.NET_PAY || 0,
    employee_epf: context.EPF_EMPLOYEE || 0,
    employer_epf: context.EPF_EMPLOYER || 0,
    employer_etf: context.ETF_EMPLOYER || 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
