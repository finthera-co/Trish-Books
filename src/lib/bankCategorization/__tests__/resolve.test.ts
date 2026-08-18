import { describe, it, expect } from "vitest";
import { classifyLine } from "../resolve";
import { ACC, makeCtx, makeLine, makeAccountMap, makeAccounts, rule } from "./helpers";
import type { AccountMapEntry, AccountMeta } from "../types";

describe("classifyLine — Tier 1b direct account-name / code match", () => {
  const acct = (id: string, accountName: string, accountCode: string, over: Partial<AccountMeta> = {}): [string, AccountMeta] =>
    [id, { id, isActive: true, isPostable: true, isControlAccount: false, accountName, accountCode, ...over }];
  const named = new Map<string, AccountMeta>([
    acct("a-bankchg", "Bank Charges", "8010"),
    acct("a-wht", "WHT Receivable", "1310"),
    acct("a-header", "Administration Expenses", "6000", { isPostable: false }),
  ]);
  // Empty account map so the curated path can't match — exercises Tier 1b.
  const ctx = makeCtx({ accountMap: makeAccountMap([]), accounts: named });

  it("matches an exact account name that is not in the variant map", () => {
    const r = classifyLine(makeLine({ debit: 150, rawAccountType: "Bank Charges", description: "misc" }), ctx);
    expect(r).toMatchObject({ kind: "resolved", accountId: "a-bankchg", tier: 1, ruleId: null });
  });

  it("matches across plural/singular (WHT Receivables → WHT Receivable)", () => {
    const r = classifyLine(makeLine({ debit: 500, rawAccountType: "WHT Receivables" }), ctx);
    expect(r).toMatchObject({ kind: "resolved", accountId: "a-wht", tier: 1 });
  });

  it("matches WHT across spelling variants (industrial-grade)", () => {
    for (const t of ["WHT Receivable", "W.H.T Receivable", "W H T Receivables", "Withholding Tax Receivable", "Withholding Tax Receivables"]) {
      const r = classifyLine(makeLine({ debit: 500, rawAccountType: t }), ctx);
      expect(r, `account_type "${t}"`).toMatchObject({ kind: "resolved", accountId: "a-wht", tier: 1 });
    }
  });

  it("matches a WHT account even when the account itself is named 'Withholding Tax Receivable'", () => {
    const acc2 = (id: string, accountName: string, accountCode: string): [string, AccountMeta] =>
      [id, { id, isActive: true, isPostable: true, isControlAccount: false, accountName, accountCode }];
    const c2 = makeCtx({ accountMap: makeAccountMap([]), accounts: new Map([acc2("wht", "Withholding Tax Receivable", "1310")]) });
    const r = classifyLine(makeLine({ debit: 500, rawAccountType: "WHT Receivables" }), c2);
    expect(r).toMatchObject({ kind: "resolved", accountId: "wht", tier: 1 });
  });

  it("matches by account code", () => {
    const r = classifyLine(makeLine({ debit: 500, rawAccountType: "8010" }), ctx);
    expect(r).toMatchObject({ kind: "resolved", accountId: "a-bankchg", tier: 1 });
  });

  it("matches via the DESCRIPTION when the category landed there (Bank Charges case)", () => {
    // account_type column holds the specific nature, "Bank Charges" is in the
    // description column — all such rows must still post to Bank Charges.
    for (const t of ["SSCL /NBT", "statement charges", "VAT misc", "bill payment", "Withholding"]) {
      const r = classifyLine(makeLine({ debit: 3080, rawAccountType: t, description: "Bank Charges" }), ctx);
      expect(r, `account_type "${t}"`).toMatchObject({ kind: "resolved", accountId: "a-bankchg", tier: 1 });
    }
  });

  it("matches via the description when there is no account_type column at all", () => {
    const r = classifyLine(makeLine({ credit: 500, rawAccountType: "", description: "WHT Receivables" }), ctx);
    expect(r).toMatchObject({ kind: "resolved", accountId: "a-wht", tier: 1 });
  });

  it("ignores non-postable (header) accounts — falls through to derive", () => {
    const r = classifyLine(makeLine({ debit: 500, rawAccountType: "Administration Expenses", description: "sundry" }), ctx);
    expect(r).toMatchObject({ kind: "derive" });
  });

  it("a curated canonical mapping still wins over a direct name match", () => {
    // Default ctx maps 'salary' → ACC.salary via the account map.
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary" }), makeCtx());
    expect(r).toMatchObject({ kind: "resolved", accountId: ACC.salary, tier: 1, ruleId: "map-salary" });
  });

  it("a ledger literally named '... Suspenses' is NOT direct-matched — still routes to Suspense for review", () => {
    // Regression: a real "HNB - Suspenses" account word-matched Tier 1b and
    // posted there directly, skipping needs_reclassification entirely — the
    // row was never visible for manual review even though it landed in an
    // account named "Suspenses".
    const c2 = makeCtx({
      accountMap: makeAccountMap([]),
      accounts: new Map([acct("a-hnbsusp", "HNB - Suspenses", "9010")]),
    });
    const r = classifyLine(makeLine({ debit: 18030, rawAccountType: "HNB - Suspenses" }), c2);
    expect(r).toMatchObject({ kind: "suspense", reason: "source_marked_suspense" });
  });
});

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

  it("unknown variant → derive a ledger named from the account_type label", () => {
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Mystery Expense" }), makeCtx());
    expect(r).toMatchObject({ kind: "derive", accountName: "Mystery Expense" });
  });

  it("source-marked suspense → suspense source_marked_suspense", () => {
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Suspense" }), makeCtx());
    expect(r).toMatchObject({ kind: "suspense", reason: "source_marked_suspense" });
  });

  it("plural 'Suspenses' also routes to suspense (word-boundary regex must allow the trailing s)", () => {
    for (const t of ["Suspenses", "HNB - Suspenses", "Suspense Peoples Saving"]) {
      const r = classifyLine(makeLine({ debit: 5000, rawAccountType: t }), makeCtx());
      expect(r, `account_type "${t}"`).toMatchObject({ kind: "suspense", reason: "source_marked_suspense" });
    }
  });

  it("'Suspend'/'Suspension' do NOT trip the suspense gate (word boundary still holds)", () => {
    const ctx = makeCtx({ accountMap: new Map() });
    for (const t of ["Suspend", "Suspension"]) {
      const r = classifyLine(makeLine({ debit: 5000, rawAccountType: t }), ctx);
      expect(r.kind, `account_type "${t}"`).not.toBe("suspense");
    }
  });

  it("known category but no tenant mapping → derive from the label", () => {
    const ctx = makeCtx({ accountMap: new Map() });
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary" }), ctx);
    expect(r).toMatchObject({ kind: "derive", accountName: "Salary" });
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

  it("side mismatch + reversal wording in the description falls back to the _reversal sibling, even when account_type is unchanged", () => {
    // Real Sampath rows never relabel the Account Type column for a reversal —
    // "Salary" stays "Salary", only the description says "reverse", on credit.
    const r = classifyLine(
      makeLine({ credit: 5000, rawAccountType: "Salary", description: "Salary reverse" }),
      makeCtx()
    );
    expect(r).toMatchObject({ kind: "resolved", accountId: ACC.salary, tier: 1 });
  });

  it("side mismatch without reversal wording still goes to suspense (no false-positive fallback)", () => {
    const r = classifyLine(
      makeLine({ credit: 5000, rawAccountType: "Salary", description: "Bonus payment" }),
      makeCtx()
    );
    expect(r).toMatchObject({ kind: "suspense", reason: "side_mismatch" });
  });

  it("side mismatch + reversal wording but no _reversal mapping configured → still suspense", () => {
    const entries: AccountMapEntry[] = [
      { id: "map-rent", canonicalCategory: "building_rent", accountId: ACC.rent, expectedSide: "debit", isActive: true },
    ];
    const ctx = makeCtx({ accountMap: makeAccountMap(entries) });
    const r = classifyLine(
      makeLine({ credit: 5000, rawAccountType: "Rent", description: "Rent reverse" }),
      ctx
    );
    expect(r).toMatchObject({ kind: "suspense", reason: "side_mismatch" });
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

  it("no rule match but usable description → derive (Tier 4)", () => {
    const r = classifyLine(makeLine({ credit: 10000, description: "Unrecognized inflow" }), makeCtx());
    expect(r).toMatchObject({ kind: "derive", accountName: "Unrecognized Inflow", side: "credit" });
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

  it("inactive rules are ignored (line derives instead of using the dead rule)", () => {
    const ctx = makeCtx({ rules: [rule({ matchValue: "cash deposit", accountId: ACC.capital, expectedSide: "credit", isActive: false })] });
    const r = classifyLine(makeLine({ credit: 10000, description: "Cash Deposit" }), ctx);
    expect(r).toMatchObject({ kind: "derive", accountName: "Cash Deposit", side: "credit" });
    expect((r as any).accountId).toBeUndefined(); // never resolved via the inactive rule
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
