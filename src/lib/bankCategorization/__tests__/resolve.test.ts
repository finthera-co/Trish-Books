import { describe, it, expect } from "vitest";
import { classifyLine } from "../resolve";
import { ACC, makeCtx, makeLine, makeAccountMap, makeAccounts, rule } from "./helpers";
import type { AccountMapEntry } from "../types";

describe("classifyLine — Blocked gates (corrupt data posts nowhere)", () => {
  it("blocks both-sides populated", () => {
    const r = classifyLine(makeLine({ debit: 100, credit: 50, rawAccountType: "salary" }), makeCtx());
    expect(r).toEqual({ kind: "blocked", reason: "both_sides_populated" });
  });

  it("blocks zero amount", () => {
    const r = classifyLine(makeLine({ debit: 0, credit: 0, rawAccountType: "salary" }), makeCtx());
    expect(r).toEqual({ kind: "blocked", reason: "no_amount" });
  });

  it("blocks negative amount", () => {
    const r = classifyLine(makeLine({ debit: -5, rawAccountType: "salary" }), makeCtx());
    expect(r).toEqual({ kind: "blocked", reason: "invalid_amount" });
  });

  it("blocks non-finite (NaN) amount", () => {
    const r = classifyLine(makeLine({ debit: NaN, rawAccountType: "salary" }), makeCtx());
    expect(r).toEqual({ kind: "blocked", reason: "invalid_amount" });
  });

  it("blocks unparseable date", () => {
    const r = classifyLine(makeLine({ debit: 100, txnDate: null, rawAccountType: "salary" }), makeCtx());
    expect(r).toEqual({ kind: "blocked", reason: "unparseable_date" });
  });

  it("blocked gates take priority over resolvable content", () => {
    // Valid category but both sides populated → still blocked, never posted.
    const r = classifyLine(makeLine({ debit: 100, credit: 100, rawAccountType: "salary" }), makeCtx());
    expect(r.kind).toBe("blocked");
  });
});

describe("classifyLine — Tier 1 (account_type → canonical → mapping)", () => {
  it("resolves a known category on the correct side", () => {
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary" }), makeCtx());
    expect(r).toEqual({ kind: "resolved", accountId: ACC.salary, ruleId: "map-salary", tier: 1 });
  });

  it("resolves a spelling variant (harvset → harvest)", () => {
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Harvset" }), makeCtx());
    expect(r).toMatchObject({ kind: "resolved", accountId: ACC.harvest, tier: 1 });
  });

  it("unknown variant → suspense unknown_category_variant", () => {
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Mystery Expense" }), makeCtx());
    expect(r).toMatchObject({ kind: "suspense", reason: "unknown_category_variant" });
  });

  it("source-marked suspense → suspense source_marked_suspense", () => {
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Suspense" }), makeCtx());
    expect(r).toMatchObject({ kind: "suspense", reason: "source_marked_suspense" });
  });

  it("known category but no tenant mapping → suspense unmapped_category", () => {
    const ctx = makeCtx({ accountMap: new Map() });
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "unmapped_category" });
  });

  it("side mismatch → suspense side_mismatch (salary expected debit, on credit)", () => {
    const r = classifyLine(makeLine({ credit: 5000, rawAccountType: "Salary" }), makeCtx());
    expect(r).toMatchObject({ kind: "suspense", reason: "side_mismatch" });
    expect((r as any).suggestions[0].accountId).toBe(ACC.salary);
  });

  it("reversal category sits on the opposite side (salary_reversal on credit resolves)", () => {
    const r = classifyLine(makeLine({ credit: 5000, rawAccountType: "Salary Reverse" }), makeCtx());
    expect(r).toMatchObject({ kind: "resolved", accountId: ACC.salary, tier: 1 });
  });

  it("inactive mapping → suspense inactive_account_mapping", () => {
    const entries: AccountMapEntry[] = [
      { id: "m1", canonicalCategory: "salary", accountId: ACC.salary, expectedSide: "debit", isActive: false },
    ];
    const ctx = makeCtx({ accountMap: makeAccountMap(entries) });
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "inactive_account_mapping" });
  });

  it("mapping to an inactive account → suspense inactive_account_mapping", () => {
    const entries: AccountMapEntry[] = [
      { id: "m1", canonicalCategory: "salary", accountId: ACC.inactive, expectedSide: "debit", isActive: true },
    ];
    const ctx = makeCtx({ accountMap: makeAccountMap(entries) });
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "inactive_account_mapping" });
  });

  it("mapping to a non-postable (header) account → suspense inactive_account_mapping", () => {
    const entries: AccountMapEntry[] = [
      { id: "m1", canonicalCategory: "salary", accountId: ACC.header, expectedSide: "debit", isActive: true },
    ];
    const ctx = makeCtx({ accountMap: makeAccountMap(entries) });
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "inactive_account_mapping" });
  });
});

describe("classifyLine — suspense gates that apply even when a rule would match", () => {
  it("amount over ceiling → suspense amount_over_ceiling", () => {
    const ctx = makeCtx({ amountCeiling: 1000 });
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "amount_over_ceiling" });
  });

  it("out-of-period date → suspense out_of_period_date", () => {
    // Line dated January inside a May sheet (real file has such keying errors).
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary", txnDate: "2024-01-07" }), makeCtx());
    expect(r).toMatchObject({ kind: "suspense", reason: "out_of_period_date" });
  });
});

describe("classifyLine — Tier 2 (no account_type: exact description/name rule)", () => {
  it("exact description rule resolves to tier 2", () => {
    const ctx = makeCtx({ rules: [rule({ matchValue: "cash deposit", accountId: ACC.capital, expectedSide: "credit" })] });
    const r = classifyLine(makeLine({ credit: 10000, description: "Cash Deposit" }), ctx);
    expect(r).toMatchObject({ kind: "resolved", accountId: ACC.capital, tier: 2 });
  });

  it("matches on name when description is empty", () => {
    const ctx = makeCtx({ rules: [rule({ matchValue: "investor a", accountId: ACC.capital, matchField: "name", expectedSide: "credit" })] });
    const r = classifyLine(makeLine({ credit: 10000, name: "Investor A" }), ctx);
    expect(r).toMatchObject({ kind: "resolved", accountId: ACC.capital, tier: 2 });
  });

  it("no rule match → suspense no_category_no_rule", () => {
    const r = classifyLine(makeLine({ credit: 10000, description: "Unrecognized inflow" }), makeCtx());
    expect(r).toMatchObject({ kind: "suspense", reason: "no_category_no_rule" });
  });

  it("empty description and name → suspense no_category_no_rule", () => {
    const r = classifyLine(makeLine({ credit: 10000 }), makeCtx());
    expect(r).toMatchObject({ kind: "suspense", reason: "no_category_no_rule" });
  });

  it("conflicting same-priority rules → suspense conflicting_rules (never silent first-wins)", () => {
    const ctx = makeCtx({
      rules: [
        rule({ matchValue: "transfer", accountId: ACC.capital, expectedSide: "either", priority: 10 }),
        rule({ matchValue: "transfer", accountId: ACC.arClearing, expectedSide: "either", priority: 10 }),
      ],
    });
    const r = classifyLine(makeLine({ credit: 500, description: "Transfer" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "conflicting_rules" });
    expect((r as any).suggestions).toHaveLength(2);
  });

  it("different-priority rules → highest priority wins (no conflict)", () => {
    const ctx = makeCtx({
      rules: [
        rule({ matchValue: "transfer", accountId: ACC.capital, expectedSide: "either", priority: 1 }),
        rule({ matchValue: "transfer", accountId: ACC.arClearing, expectedSide: "either", priority: 50 }),
      ],
    });
    const r = classifyLine(makeLine({ credit: 500, description: "Transfer" }), ctx);
    expect(r).toMatchObject({ kind: "resolved", accountId: ACC.capital, tier: 2 });
  });

  it("rule side mismatch → suspense side_mismatch", () => {
    const ctx = makeCtx({ rules: [rule({ matchValue: "cash deposit", accountId: ACC.capital, expectedSide: "credit" })] });
    const r = classifyLine(makeLine({ debit: 10000, description: "Cash Deposit" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "side_mismatch" });
  });

  it("rule to inactive account → suspense inactive_account_mapping", () => {
    const ctx = makeCtx({ rules: [rule({ matchValue: "cash deposit", accountId: ACC.inactive, expectedSide: "credit" })] });
    const r = classifyLine(makeLine({ credit: 10000, description: "Cash Deposit" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "inactive_account_mapping" });
  });

  it("inactive rules are ignored", () => {
    const ctx = makeCtx({ rules: [rule({ matchValue: "cash deposit", accountId: ACC.capital, expectedSide: "credit", isActive: false })] });
    const r = classifyLine(makeLine({ credit: 10000, description: "Cash Deposit" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "no_category_no_rule" });
  });
});

describe("classifyLine — determinism", () => {
  it("is deterministic across 1000 shuffled rule orders", () => {
    const baseRules = [
      rule({ matchValue: "cash deposit", accountId: ACC.capital, expectedSide: "credit", priority: 5 }),
      rule({ matchValue: "loan", accountId: ACC.arClearing, expectedSide: "credit", priority: 5 }),
      rule({ matchValue: "fee", accountId: ACC.bankCharges, expectedSide: "debit", priority: 20 }),
    ];
    const line = makeLine({ credit: 10000, description: "Cash Deposit" });
    const expected = classifyLine(line, makeCtx({ rules: baseRules }));
    for (let i = 0; i < 1000; i++) {
      const shuffled = [...baseRules].sort(() => Math.random() - 0.5);
      const r = classifyLine(line, makeCtx({ rules: shuffled }));
      expect(r).toEqual(expected);
    }
  });
});
