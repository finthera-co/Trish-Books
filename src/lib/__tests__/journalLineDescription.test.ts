import { describe, it, expect } from "vitest";
import {
  deriveEntryDescription,
  isMemoInherited,
  normalizeLineMemo,
  resolveLineMemo,
  validateJournalEntry,
  validateLineDescriptions,
  LINE_MEMO_MAX,
  type AccountInfo,
  type JournalLine,
} from "@/lib/journalValidation";

const acc = (id: string, over: Partial<AccountInfo> = {}): AccountInfo => ({
  id,
  account_code: id,
  account_name: `Account ${id}`,
  account_type: "Expense",
  account_subtype: null,
  is_active: true,
  ...over,
});

const accountsMap = new Map<string, AccountInfo>([
  ["a1", acc("a1")],
  ["a2", acc("a2", { account_type: "Asset" })],
]);

const balancedLines = (memoA: string, memoB: string): JournalLine[] => [
  { account_id: "a1", debit: 1000, credit: 0, memo: memoA },
  { account_id: "a2", debit: 0, credit: 1000, memo: memoB },
];

describe("resolveLineMemo", () => {
  it("prefers the line's own memo", () => {
    expect(resolveLineMemo("Paper for the office", "Sundries")).toBe("Paper for the office");
  });

  it("falls back to the entry description when the line has none", () => {
    expect(resolveLineMemo(null, "Sundries")).toBe("Sundries");
    expect(resolveLineMemo("", "Sundries")).toBe("Sundries");
    expect(resolveLineMemo("   ", "Sundries")).toBe("Sundries");
  });

  it("returns empty rather than null when neither exists", () => {
    expect(resolveLineMemo(null, null)).toBe("");
  });

  it("reports whether what it returned was inherited", () => {
    expect(isMemoInherited("Paper")).toBe(false);
    expect(isMemoInherited("")).toBe(true);
    expect(isMemoInherited(null)).toBe(true);
  });
});

describe("normalizeLineMemo", () => {
  it("trims and turns blank into null so the inherit rule applies", () => {
    expect(normalizeLineMemo("  Paper  ")).toBe("Paper");
    expect(normalizeLineMemo("   ")).toBeNull();
    expect(normalizeLineMemo(undefined)).toBeNull();
  });
});

describe("deriveEntryDescription", () => {
  it("takes the first posting line's description", () => {
    expect(deriveEntryDescription(balancedLines("Paper", "Paid from petty cash"))).toBe("Paper");
  });

  it("skips lines that carry no amount", () => {
    const lines: JournalLine[] = [
      { account_id: "", debit: 0, credit: 0, memo: "" },
      ...balancedLines("Paper", "Paid from petty cash"),
    ];
    expect(deriveEntryDescription(lines)).toBe("Paper");
  });

  it("still finds text on a half-filled form, so the user sees a line error not a header one", () => {
    const lines: JournalLine[] = [{ account_id: "", debit: 0, credit: 0, memo: "Paper" }];
    expect(deriveEntryDescription(lines)).toBe("Paper");
  });

  it("is empty when nothing has been typed", () => {
    expect(deriveEntryDescription(balancedLines("", ""))).toBe("");
  });
});

describe("validateLineDescriptions", () => {
  it("accepts a description on every posting line", () => {
    expect(validateLineDescriptions(balancedLines("Paper", "Paid from petty cash"))).toEqual([]);
  });

  it("flags the line that is missing one, by index", () => {
    const errors = validateLineDescriptions(balancedLines("Paper", ""));
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("lines[1].memo");
    expect(errors[0].message).toContain("Line 2");
  });

  it("ignores an empty spare row", () => {
    const lines: JournalLine[] = [
      ...balancedLines("Paper", "Paid from petty cash"),
      { account_id: "", debit: 0, credit: 0, memo: "" },
    ];
    expect(validateLineDescriptions(lines)).toEqual([]);
  });

  it("flags a line that has an account but no description, even before amounts are typed", () => {
    const lines: JournalLine[] = [{ account_id: "a1", debit: 0, credit: 0, memo: "" }];
    expect(validateLineDescriptions(lines)).toHaveLength(1);
  });

  it("rejects whitespace-only text", () => {
    expect(validateLineDescriptions(balancedLines("   ", "Paid"))).toHaveLength(1);
  });

  it("rejects a description longer than the reports can render", () => {
    const errors = validateLineDescriptions(balancedLines("x".repeat(LINE_MEMO_MAX + 1), "Paid"));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(String(LINE_MEMO_MAX));
  });

  it("accepts a description exactly at the cap", () => {
    expect(validateLineDescriptions(balancedLines("x".repeat(LINE_MEMO_MAX), "Paid"))).toEqual([]);
  });
});

describe("validateJournalEntry with line descriptions", () => {
  const base = {
    entryDate: "2026-08-15",
    accountsMap,
  };

  it("passes when every line is described and the entry balances", () => {
    const lines = balancedLines("Paper for the office", "Paid from petty cash");
    const result = validateJournalEntry({
      ...base,
      description: deriveEntryDescription(lines),
      lines,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports a missing line description once, not twice", () => {
    const lines = balancedLines("", "");
    const result = validateJournalEntry({
      ...base,
      description: deriveEntryDescription(lines),
      lines,
    });
    expect(result.valid).toBe(false);
    // Both lines are flagged; the derived entry description is NOT reported
    // separately, because it is the same missing text said a third time.
    expect(result.errors.map((e) => e.field)).toEqual(["lines[0].memo", "lines[1].memo"]);
  });

  it("still guards the entry description for callers that build one themselves", () => {
    const lines = balancedLines("Paper for the office", "Paid from petty cash");
    const result = validateJournalEntry({ ...base, description: "", lines });
    expect(result.errors.map((e) => e.field)).toContain("description");
  });

  it("keeps reporting balance errors alongside description errors", () => {
    const lines: JournalLine[] = [
      { account_id: "a1", debit: 1000, credit: 0, memo: "Paper" },
      { account_id: "a2", debit: 0, credit: 400, memo: "" },
    ];
    const result = validateJournalEntry({
      ...base,
      description: deriveEntryDescription(lines),
      lines,
    });
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("lines[1].memo");
    expect(fields).toContain("balance");
  });
});
