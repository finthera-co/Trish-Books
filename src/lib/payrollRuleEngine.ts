/**
 * Rule-Based Payroll Engine — Level 2 ERP edition
 *
 * - Components define WHAT is calculated (Basic, Gross, EPF, Net Pay...)
 * - Rules define HOW each component is calculated (formula + condition)
 * - Engine executes rules in priority order against an employee context
 * - Every computation emits a deterministic `calculation_trace` for audit
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
  // Optional — present when loaded from payroll_rule_versions
  rule_version_id?: string;
  version_no?: number;
}

export interface EmployeePayrollInput {
  id: string;
  is_epf_applicable: boolean;
  is_etf_applicable: boolean;
  is_paye_applicable: boolean;
  employment_type?: string;
  basic_salary: number;
  overtime_pay?: number;
  bonuses?: number;
  allowances?: number;          // attract EPF/ETF
  non_epf_allowances?: number;  // taxable, but excluded from EPF/ETF
  other_deductions?: number;
  loan_deduction?: number;      // salary-advance / loan repayment this run
}

export type PayrollContext = Record<string, number>;

/** Deterministic trace emitted per computed component */
export interface CalculationTrace {
  rule_id: string | null;
  rule_version_id?: string | null;
  rule_name: string;
  formula_type: FormulaType | "INPUT";
  formula_applied: string;          // human readable: "BASIC * 8%"
  base_component: string | null;
  base_value: number;
  inputs: Record<string, number>;   // snapshot of context values referenced
  condition: any;
  condition_passed: boolean;
  result: number;
  evaluation_steps: string[];       // step-by-step explanation
  timestamp: string;
}

/* ---------------- Condition Engine ---------------- */
function evaluateCondition(
  condition: PayrollRule["condition_json"],
  employee: EmployeePayrollInput,
  steps: string[]
): boolean {
  if (!condition) {
    steps.push("No condition → applies unconditionally");
    return true;
  }
  const { field, operator, value } = condition;
  const actual = (employee as any)[field];
  steps.push(`Eval condition: employee.${field} (${JSON.stringify(actual)}) ${operator} ${JSON.stringify(value)}`);
  let result = false;
  switch (operator) {
    case "==": result = actual === value; break;
    case "!=": result = actual !== value; break;
    case ">": result = actual > value; break;
    case ">=": result = actual >= value; break;
    case "<": result = actual < value; break;
    case "<=": result = actual <= value; break;
    case "in": result = Array.isArray(value) && value.includes(actual); break;
  }
  steps.push(`Condition result: ${result}`);
  return result;
}

/* ---------------- Expression Evaluator ----------------
 * Supports +, -, *, /, unary +/-, parentheses, numbers, and component codes.
 *
 * This is a hand-written recursive-descent parser rather than `new Function`.
 * The tokeniser already reduces an expression to digits and operators, so eval
 * was not an injection risk — but it *is* a Content-Security-Policy risk: our
 * `script-src 'self'` (vercel.json) has no `'unsafe-eval'`, so `new Function`
 * throws in production. That throw was caught and turned into 0, which meant
 * every EXPRESSION/DERIVED rule silently computed as zero once deployed.
 * Parsing the tokens ourselves needs no CSP exemption.
 */

/** Recursive-descent parser over an already-substituted numeric token list. */
function parseTokens(tokens: string[]): number {
  let pos = 0;
  const peek = () => tokens[pos];

  // expr := term (('+' | '-') term)*
  function expr(): number {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[pos++];
      const rhs = term();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  // term := factor (('*' | '/') factor)*
  function term(): number {
    let value = factor();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[pos++];
      const rhs = factor();
      if (op === "/" && rhs === 0) throw new Error("division by zero");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  // factor := ('+' | '-') factor | '(' expr ')' | number
  function factor(): number {
    const tok = peek();
    if (tok === undefined) throw new Error("unexpected end of expression");
    if (tok === "+" || tok === "-") {
      pos++;
      const operand = factor();
      return tok === "-" ? -operand : operand;
    }
    if (tok === "(") {
      pos++;
      const inner = expr();
      if (peek() !== ")") throw new Error("missing closing parenthesis");
      pos++;
      return inner;
    }
    if (tok === ")") throw new Error("unexpected ')'");
    pos++;
    const num = Number(tok);
    // The tokeniser's [0-9.]+ class admits malformed literals like "1.2.3".
    if (!Number.isFinite(num)) throw new Error(`invalid number "${tok}"`);
    return num;
  }

  const result = expr();
  if (pos < tokens.length) throw new Error(`unexpected token "${tokens[pos]}"`);
  return result;
}

function evaluateExpression(
  expr: string,
  context: PayrollContext,
  refs: Record<string, number>,
  steps: string[]
): number {
  const tokens = expr.match(/[A-Z_][A-Z0-9_]*|[0-9.]+|[+\-*/()]/g) || [];
  const substituted = tokens.map((t) => {
    if (/^[A-Z_]/.test(t)) {
      const v = context[t];
      const num = typeof v === "number" && isFinite(v) ? v : 0;
      refs[t] = num;
      return String(num);
    }
    return t;
  });
  steps.push(`Expression: ${expr}`);
  steps.push(`Resolved:   ${substituted.join(" ")}`);
  try {
    const out = parseTokens(substituted);
    // Overflow or an operand that resolved to a non-number lands here; a
    // non-finite figure must never reach payroll_results.
    if (!Number.isFinite(out)) throw new Error("result is not a finite number");
    steps.push(`= ${out}`);
    return out;
  } catch (err) {
    steps.push(`Eval error: ${(err as Error).message}`);
    return 0;
  }
}

/* ---------------- Engine ---------------- */
export interface PayrollComputationResult {
  context: PayrollContext;
  /** Per-component traces, indexed by component_code. Use for payroll_results inserts. */
  traces: Record<string, CalculationTrace>;
  /** Ordered execution log */
  applied_rules: { rule_id: string; rule_name: string; target: string; result: number; condition_passed: boolean }[];
  // Convenience aggregates
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  employee_epf: number;
  employer_epf: number;
  employer_etf: number;
}

function inputTrace(code: string, name: string, value: number): CalculationTrace {
  return {
    rule_id: null,
    rule_version_id: null,
    rule_name: `Input: ${name}`,
    formula_type: "INPUT",
    formula_applied: `${code} = ${value}`,
    base_component: null,
    base_value: value,
    inputs: {},
    condition: null,
    condition_passed: true,
    result: value,
    evaluation_steps: [`Manual input value: ${value}`],
    timestamp: new Date().toISOString(),
  };
}

export function runPayrollForEmployee(
  employee: EmployeePayrollInput,
  rules: PayrollRule[],
  components: PayrollComponent[]
): PayrollComputationResult {
  const context: PayrollContext = {};
  for (const c of components) context[c.code] = 0;
  context.BASIC = employee.basic_salary || 0;
  context.OVERTIME = employee.overtime_pay || 0;
  context.BONUS = employee.bonuses || 0;
  context.ALLOWANCES = employee.allowances || 0;
  context.NON_EPF_ALLOWANCES = employee.non_epf_allowances || 0;
  context.OTHER_DEDUCTIONS = employee.other_deductions || 0;
  context.LOAN_DEDUCTION = employee.loan_deduction || 0;

  const traces: Record<string, CalculationTrace> = {};
  const compMap = new Map(components.map((c) => [c.code, c]));

  // Trace the inputs
  for (const code of ["BASIC", "OVERTIME", "BONUS", "ALLOWANCES", "NON_EPF_ALLOWANCES", "OTHER_DEDUCTIONS", "LOAN_DEDUCTION"]) {
    const comp = compMap.get(code);
    if (comp) traces[code] = inputTrace(code, comp.name, context[code]);
  }

  const applied: PayrollComputationResult["applied_rules"] = [];
  const sorted = [...rules].filter((r) => r.is_active).sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    const steps: string[] = [];
    const refs: Record<string, number> = {};
    const passed = evaluateCondition(rule.condition_json, employee, steps);

    let result = 0;
    let formulaApplied = "";
    let baseValue = 0;

    if (passed) {
      switch (rule.formula_type) {
        case "PERCENTAGE": {
          baseValue = rule.base_component_code ? (context[rule.base_component_code] || 0) : 0;
          if (rule.base_component_code) refs[rule.base_component_code] = baseValue;
          result = round2(baseValue * (Number(rule.formula_value) / 100));
          formulaApplied = `${rule.base_component_code} (${baseValue}) × ${rule.formula_value}% = ${result}`;
          steps.push(formulaApplied);
          break;
        }
        case "FIXED": {
          result = Number(rule.formula_value) || 0;
          formulaApplied = `FIXED = ${result}`;
          steps.push(formulaApplied);
          break;
        }
        case "DERIVED":
        case "EXPRESSION": {
          result = round2(evaluateExpression(rule.expression || "0", context, refs, steps));
          formulaApplied = rule.expression || "0";
          break;
        }
        case "CONDITIONAL": {
          result = rule.expression
            ? round2(evaluateExpression(rule.expression, context, refs, steps))
            : Number(rule.formula_value) || 0;
          formulaApplied = rule.expression || `FIXED = ${result}`;
          break;
        }
      }
      context[rule.target_component_code] = result;
    } else {
      formulaApplied = "(skipped — condition failed)";
    }

    traces[rule.target_component_code] = {
      rule_id: rule.id,
      rule_version_id: rule.rule_version_id || null,
      rule_name: rule.name,
      formula_type: rule.formula_type,
      formula_applied: formulaApplied,
      base_component: rule.base_component_code,
      base_value: baseValue,
      inputs: refs,
      condition: rule.condition_json,
      condition_passed: passed,
      result,
      evaluation_steps: steps,
      timestamp: new Date().toISOString(),
    };

    applied.push({ rule_id: rule.id, rule_name: rule.name, target: rule.target_component_code, result, condition_passed: passed });
  }

  return {
    context,
    traces,
    applied_rules: applied,
    gross_pay: context.GROSS_PAY || 0,
    total_deductions: (context.EPF_EMPLOYEE || 0) + (context.OTHER_DEDUCTIONS || 0) + (context.LOAN_DEDUCTION || 0),
    net_pay: context.NET_PAY || 0,
    employee_epf: context.EPF_EMPLOYEE || 0,
    employer_epf: context.EPF_EMPLOYER || 0,
    employer_etf: context.ETF_EMPLOYER || 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Deterministic hash of a rule set, used as `rule_set_version_hash`.
 * Two runs with the same hash produce identical output for identical input.
 */
export function hashRuleSet(versionedRules: Array<{ rule_id?: string; id?: string; version_no?: number; priority: number }>): string {
  const stable = [...versionedRules]
    .map((r) => `${r.rule_id || r.id}:v${r.version_no || 1}:p${r.priority}`)
    .sort()
    .join("|");
  // Simple FNV-1a 32-bit hash (deterministic, no deps)
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) {
    h ^= stable.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `rs_${h.toString(16).padStart(8, "0")}`;
}
