import { describe, it, expect } from "vitest";
import { parseSheetMatrix } from "../parser";
import { resolveBatch } from "../index";
import { validateBatch } from "../validate";
import { ACC, makeCtx, rule } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Golden full-batch simulation. An anonymized May-2024 sheet modeled on the
// real Sampath workbook shape — payee names replaced with PAYEE_00N so no
// personal data enters the repo. Any change in resolution (tier, account,
// suspense reason, block reason) fails this test loudly.
// ─────────────────────────────────────────────────────────────────────────────

// [Date, Name, Description, Account Type, Debit, Credit, Balance]
const MAY_SHEET: unknown[][] = [
  ["Sampath Payment Analysis"],
  ["Date", "Name", "Description", "Account Type", "Debit", "Credit", "Balance"],
  ["2024-05-01", "", "b/f", "", "", "", "100000"],                       // excluded
  ["2024-05-02", "PAYEE_001", "May salary", "Salary", "5000", "", "95000"],       // T1 salary
  ["2024-05-02", "PAYEE_002", "May salary", "Salary", "5000", "", "90000"],       // T1 salary (dup ok)
  ["2024-05-03", "PAYEE_003", "Basic pay", "Basic Salary", "4000", "", "86000"],  // T1 salary (variant)
  ["2024-05-04", "", "Monthly rent", "Building Rent", "12000", "", "74000"],      // T1 rent
  ["2024-05-05", "", "Sampath charge", "Bank Fee", "150", "", "73850"],           // T1 bank_charges
  ["2024-05-06", "", "Field harvest", "Harvset", "8000", "", "65850"],           // T1 harvest (typo variant)
  ["2024-05-07", "PAYEE_004", "Capital injection", "", "", "50000", "115850"],    // T2 capital
  ["2024-05-08", "", "Reversed salary", "Salary Reverse", "", "5000", "120850"],  // T1 salary_reversal (credit)
  ["2024-05-09", "", "Odd expense", "Mystery Category", "900", "", "119950"],     // suspense unknown_variant
  ["2024-05-10", "", "Unknown inflow", "", "", "700", "120650"],                  // suspense no_category_no_rule
  ["2024-01-07", "", "Wrong month salary", "Salary", "300", "", "120350"],        // suspense out_of_period
  ["2024-05-11", "", "Corrupt both sides", "Salary", "100", "100", "120350"],     // blocked both_sides
];

function runMay() {
  const { lines, errors } = parseSheetMatrix(MAY_SHEET, "May 2024", { month: 5, year: 2024 });
  expect(errors).toHaveLength(0);
  const ctx = makeCtx({
    rules: [rule({ matchValue: "capital injection", accountId: ACC.capital, expectedSide: "credit", priority: 10 })],
  });
  const resolved = resolveBatch(lines, ctx);
  const batch = validateBatch(lines);
  return { lines, resolved, batch };
}

describe("full-batch golden simulation (anonymized May 2024)", () => {
  it("produces the exact expected resolution for every line", () => {
    const { resolved } = runMay();
    const byDesc = (d: string) => resolved.find((r) => r.line.description === d)!;

    // Excluded B/F
    expect(byDesc("b/f").resolution).toBeNull();
    expect(byDesc("b/f").line.isExcluded).toBe(true);

    // Tier 1 resolved
    expect(byDesc("May salary").resolution).toMatchObject({ kind: "resolved", accountId: ACC.salary, tier: 1 });
    expect(byDesc("Basic pay").resolution).toMatchObject({ kind: "resolved", accountId: ACC.salary, tier: 1 });
    expect(byDesc("Monthly rent").resolution).toMatchObject({ kind: "resolved", accountId: ACC.rent, tier: 1 });
    expect(byDesc("Sampath charge").resolution).toMatchObject({ kind: "resolved", accountId: ACC.bankCharges, tier: 1 });
    expect(byDesc("Field harvest").resolution).toMatchObject({ kind: "resolved", accountId: ACC.harvest, tier: 1 });
    expect(byDesc("Reversed salary").resolution).toMatchObject({ kind: "resolved", accountId: ACC.salary, tier: 1 });

    // Tier 2 resolved
    expect(byDesc("Capital injection").resolution).toMatchObject({ kind: "resolved", accountId: ACC.capital, tier: 2 });

    // Suspense
    expect(byDesc("Odd expense").resolution).toMatchObject({ kind: "suspense", reason: "unknown_category_variant" });
    expect(byDesc("Unknown inflow").resolution).toMatchObject({ kind: "suspense", reason: "no_category_no_rule" });
    expect(byDesc("Wrong month salary").resolution).toMatchObject({ kind: "suspense", reason: "out_of_period_date" });

    // Blocked
    expect(byDesc("Corrupt both sides").resolution).toMatchObject({ kind: "blocked", reason: "both_sides_populated" });
  });

  it("aggregate tier counts match", () => {
    const { resolved } = runMay();
    const tally = { resolved: 0, suspense: 0, blocked: 0, excluded: 0 };
    for (const r of resolved) {
      if (r.resolution === null) tally.excluded++;
      else tally[r.resolution.kind]++;
    }
    expect(tally).toEqual({ resolved: 8, suspense: 3, blocked: 1, excluded: 1 });
  });

  it("control totals: Σdebit / Σcredit computed once, stable", () => {
    const { batch } = runMay();
    // Control totals are a raw parse-time check over all non-excluded rows,
    // independent of resolution/block status.
    // Debits: 5000+5000+4000+12000+150+8000+900+300+100 = 35450 (excludes B/F)
    // Credits: 50000+5000+700 + 100 (corrupt row's credit) = 55800
    expect(batch.totalDebit).toBe(35450);
    expect(batch.totalCredit).toBe(55800);
    expect(batch.rowCount).toBe(12); // 13 data rows − 1 excluded B/F
    expect(batch.excludedCount).toBe(1);
  });

  it("flags the legitimate same-day salary duplicate without rejecting it", () => {
    const { batch, resolved } = runMay();
    expect(batch.duplicates.length).toBeGreaterThanOrEqual(1);
    // Both salary lines still resolved — flagged, not rejected.
    const salaries = resolved.filter((r) => r.line.description === "May salary");
    expect(salaries.every((s) => s.resolution?.kind === "resolved")).toBe(true);
  });

  it("every resolved line records the matched map/rule id (auditable)", () => {
    const { resolved } = runMay();
    for (const r of resolved) {
      if (r.resolution?.kind === "resolved") {
        expect(r.resolution.ruleId).toBeTruthy();
      }
    }
  });

  it("no resolved line ever points at the suspense account", () => {
    const { resolved } = runMay();
    for (const r of resolved) {
      if (r.resolution?.kind === "resolved") {
        expect(r.resolution.accountId).not.toBe(ACC.suspense);
      }
    }
  });
});
