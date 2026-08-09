import { describe, expect, it } from "vitest";
import {
  runPayrollForEmployee,
  type EmployeePayrollInput,
  type PayrollComponent,
  type PayrollRule,
} from "@/lib/payrollRuleEngine";

/* The expression evaluator is module-private, so it is exercised through the
 * engine: one EXPRESSION rule whose result lands in context.RESULT. */
function evalExpression(expression: string, context: Record<string, number> = {}) {
  const components: PayrollComponent[] = [
    { id: "c-result", code: "RESULT", name: "Result", kind: "derived", is_active: true },
    ...Object.keys(context).map((code) => ({
      id: `c-${code}`,
      code,
      name: code,
      kind: "earning" as const,
      is_active: true,
    })),
  ];

  const rules: PayrollRule[] = [
    // Seed each context value via a FIXED rule so it is in scope for the
    // expression, which runs last.
    ...Object.entries(context).map(([code, value], i) => ({
      id: `seed-${code}`,
      name: `Seed ${code}`,
      target_component_code: code,
      formula_type: "FIXED" as const,
      formula_value: value,
      base_component_code: null,
      expression: null,
      condition_json: null,
      priority: i + 1,
      is_active: true,
    })),
    {
      id: "r-expr",
      name: "Expression under test",
      target_component_code: "RESULT",
      formula_type: "EXPRESSION",
      formula_value: 0,
      base_component_code: null,
      expression,
      condition_json: null,
      priority: 100,
      is_active: true,
    },
  ];

  const employee: EmployeePayrollInput = {
    id: "e1",
    is_epf_applicable: true,
    is_etf_applicable: true,
    is_paye_applicable: true,
    basic_salary: 0,
  };

  const out = runPayrollForEmployee(employee, rules, components);
  return {
    value: out.context.RESULT,
    steps: out.traces.RESULT.evaluation_steps,
    inputs: out.traces.RESULT.inputs,
  };
}

describe("payroll expression evaluator", () => {
  it("applies operator precedence rather than left-to-right", () => {
    expect(evalExpression("2 + 3 * 4").value).toBe(14);
    expect(evalExpression("100 - 20 / 4").value).toBe(95);
  });

  it("honours parentheses, including nesting", () => {
    expect(evalExpression("(2 + 3) * 4").value).toBe(20);
    expect(evalExpression("((1 + 2) * (3 + 4)) / 3").value).toBe(7);
  });

  it("substitutes component codes from the payroll context", () => {
    const { value, inputs } = evalExpression("BASIC * 0.08", { BASIC: 50000 });
    expect(value).toBe(4000);
    expect(inputs.BASIC).toBe(50000);
  });

  it("treats an unknown component code as zero", () => {
    expect(evalExpression("BASIC + NOT_A_COMPONENT").value).toBe(0);
  });

  it("handles unary minus, both leading and after an operator", () => {
    expect(evalExpression("-5 + 8").value).toBe(3);
    expect(evalExpression("10 * -2").value).toBe(-20);
    expect(evalExpression("-(3 + 4)").value).toBe(-7);
  });

  it("computes a realistic gross-to-net expression", () => {
    const { value } = evalExpression("(BASIC + ALLOWANCES) - EPF_EMPLOYEE", {
      BASIC: 80000,
      ALLOWANCES: 12000,
      EPF_EMPLOYEE: 9600,
    });
    expect(value).toBe(82400);
  });

  it("returns 0 and records the reason for malformed input", () => {
    for (const bad of ["(1 + 2", "1 +", "* 5", "1.2.3 + 1", ")"]) {
      const { value, steps } = evalExpression(bad);
      expect(value, `expected 0 for "${bad}"`).toBe(0);
      expect(steps.some((s) => s.startsWith("Eval error")), `expected a trace for "${bad}"`).toBe(true);
    }
  });

  it("returns 0 rather than Infinity when dividing by zero", () => {
    const { value, steps } = evalExpression("BASIC / 0", { BASIC: 1000 });
    expect(value).toBe(0);
    expect(steps.some((s) => s.includes("division by zero"))).toBe(true);
  });

  it("records the resolved expression in the audit trace", () => {
    const { steps } = evalExpression("BASIC * 2", { BASIC: 500 });
    expect(steps).toContain("Expression: BASIC * 2");
    expect(steps).toContain("Resolved:   500 * 2");
    expect(steps).toContain("= 1000");
  });
});

describe("runPayrollForEmployee", () => {
  const components: PayrollComponent[] = [
    { id: "1", code: "BASIC", name: "Basic Salary", kind: "base", is_active: true },
    { id: "2", code: "ALLOWANCES", name: "Allowances", kind: "earning", is_active: true },
    { id: "3", code: "GROSS_PAY", name: "Gross Pay", kind: "derived", is_active: true },
    { id: "4", code: "EPF_EMPLOYEE", name: "EPF (Employee)", kind: "deduction", is_active: true },
    { id: "5", code: "NET_PAY", name: "Net Pay", kind: "derived", is_active: true },
  ];

  const rules: PayrollRule[] = [
    {
      id: "r1", name: "Gross", target_component_code: "GROSS_PAY",
      formula_type: "EXPRESSION", formula_value: 0, base_component_code: null,
      expression: "BASIC + ALLOWANCES", condition_json: null, priority: 1, is_active: true,
    },
    {
      id: "r2", name: "EPF 8%", target_component_code: "EPF_EMPLOYEE",
      formula_type: "PERCENTAGE", formula_value: 8, base_component_code: "BASIC",
      expression: null, condition_json: { field: "is_epf_applicable", operator: "==", value: true },
      priority: 2, is_active: true,
    },
    {
      id: "r3", name: "Net", target_component_code: "NET_PAY",
      formula_type: "EXPRESSION", formula_value: 0, base_component_code: null,
      expression: "GROSS_PAY - EPF_EMPLOYEE", condition_json: null, priority: 3, is_active: true,
    },
  ];

  const employee: EmployeePayrollInput = {
    id: "e1",
    is_epf_applicable: true,
    is_etf_applicable: true,
    is_paye_applicable: true,
    basic_salary: 100000,
    allowances: 15000,
  };

  it("computes a full gross → EPF → net chain", () => {
    const out = runPayrollForEmployee(employee, rules, components);
    expect(out.gross_pay).toBe(115000);
    expect(out.employee_epf).toBe(8000);
    expect(out.net_pay).toBe(107000);
  });

  it("skips a rule whose condition fails", () => {
    const out = runPayrollForEmployee(
      { ...employee, is_epf_applicable: false },
      rules,
      components,
    );
    expect(out.employee_epf).toBe(0);
    expect(out.net_pay).toBe(115000);
    expect(out.traces.EPF_EMPLOYEE.condition_passed).toBe(false);
    expect(out.traces.EPF_EMPLOYEE.formula_applied).toBe("(skipped — condition failed)");
  });

  it("emits a trace for every applied rule", () => {
    const out = runPayrollForEmployee(employee, rules, components);
    expect(out.applied_rules).toHaveLength(3);
    expect(out.traces.NET_PAY.inputs).toEqual({ GROSS_PAY: 115000, EPF_EMPLOYEE: 8000 });
  });
});
