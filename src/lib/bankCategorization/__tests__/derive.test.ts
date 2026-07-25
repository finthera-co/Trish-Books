import { describe, it, expect } from "vitest";
import { deriveAccountName, deriveAccountKey } from "../derive";
import { classifyLine } from "../resolve";
import { makeLine, makeCtx, makeAccountMap, ACC } from "./helpers";

describe("deriveAccountName — clean ledger names from descriptions", () => {
  it("strips reference numbers and trailing codes", () => {
    expect(deriveAccountName("KEELLS SUPER PMT REF 88213")).toBe("Keells Super");
    expect(deriveAccountName("KEELLS SUPER 000451")).toBe("Keells Super");
  });

  it("collapses variants of the same payee onto one name (and key)", () => {
    const a = deriveAccountName("Payment to Ceylon Electricity Board ref 991");
    const b = deriveAccountName("CEYLON ELECTRICITY BOARD  0007742");
    expect(a).toBe("Ceylon Electricity Board");
    expect(b).toBe("Ceylon Electricity Board");
    expect(deriveAccountKey(a)).toBe(deriveAccountKey(b));
  });

  it("keeps the nature of the payment, not just the payee", () => {
    expect(deriveAccountName("Water bill March")).toBe("Water Bill March");
    expect(deriveAccountName("Internet connection charge")).toBe("Internet Connection Charge");
  });

  it("preserves an ampersand between real words", () => {
    expect(deriveAccountName("Legal & Compliance fees")).toBe("Legal & Compliance Fees");
  });

  it("caps very long memos to a tidy label", () => {
    const name = deriveAccountName("groceries vegetables fruits dairy meat bread rice sugar salt");
    expect(name.split(" ").length).toBeLessThanOrEqual(6);
  });

  it("returns empty for all-numeric or all-noise descriptions", () => {
    expect(deriveAccountName("88213")).toBe("");
    expect(deriveAccountName("payment ref 000451")).toBe("");
    expect(deriveAccountName("")).toBe("");
    expect(deriveAccountName(null)).toBe("");
  });

  it("falls back to the payee name when the description is unusable", () => {
    expect(deriveAccountName("REF 8842", "Keells Super")).toBe("Keells Super");
  });

  it("is idempotent through its own key", () => {
    const n = deriveAccountName("SAMPATH IPG SETTLEMENT 5567");
    expect(deriveAccountKey(n)).toBe(deriveAccountKey(deriveAccountName(n)));
  });
});

describe("classifyLine — Tier 4 auto-generate (derive)", () => {
  it("unknown account_type + usable description → derive, classified by direction (out = debit)", () => {
    const r = classifyLine(makeLine({ debit: 900, rawAccountType: "Mystery Category", description: "Odd Expense" }), makeCtx());
    expect(r).toMatchObject({ kind: "derive", accountName: "Odd Expense", side: "debit" });
  });

  it("no account_type, no rule, money in → derive on the credit side", () => {
    const r = classifyLine(makeLine({ credit: 700, description: "Unknown Inflow" }), makeCtx());
    expect(r).toMatchObject({ kind: "derive", accountName: "Unknown Inflow", side: "credit" });
  });

  it("known category with no tenant mapping → derive from description", () => {
    const ctx = makeCtx({ accountMap: makeAccountMap([]) }); // salary canonical exists, no account mapped
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary", description: "June wages crew" }), ctx);
    expect(r).toMatchObject({ kind: "derive", side: "debit" });
  });

  it("all-numeric description → stays in Suspense, never a junk ledger", () => {
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Mystery Category", description: "884211" }), makeCtx());
    expect(r).toMatchObject({ kind: "suspense", reason: "unknown_category_variant" });
  });

  it("mapped category still wins over deriving (existing mapping is authoritative)", () => {
    const r = classifyLine(makeLine({ debit: 5000, rawAccountType: "Salary", description: "Anything at all" }), makeCtx());
    expect(r).toMatchObject({ kind: "resolved", accountId: ACC.salary, tier: 1 });
  });

  it("structurally risky rows are never auto-generated (future date → Suspense)", () => {
    const ctx = makeCtx({ maxDate: "2024-05-15" });
    const r = classifyLine(makeLine({ debit: 100, txnDate: "2024-05-20", description: "New Payee", rawAccountType: "" }), ctx);
    expect(r).toMatchObject({ kind: "suspense", reason: "future_date" });
  });
});
