import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Pure validation logic (extracted from JournalEntries component) ──

const EPSILON = 0.005;

interface JournalLine {
  account_id: string;
  debit: number;
  credit: number;
}

function isBalanced(lines: JournalLine[]): boolean {
  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
  return Math.abs(totalDebit - totalCredit) < EPSILON && totalDebit > 0;
}

function hasDuplicateAccounts(lines: JournalLine[]): boolean {
  const active = lines.filter(l => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
  const ids = active.map(l => l.account_id);
  return new Set(ids).size !== ids.length;
}

function hasInvalidLines(lines: JournalLine[]): boolean {
  return lines.some(l => Number(l.debit) > 0 && Number(l.credit) > 0);
}

function updateLine(lines: JournalLine[], index: number, field: string, value: any): JournalLine[] {
  const newLines = lines.map(l => ({ ...l }));
  if (field === "debit" && Number(value) > 0) {
    newLines[index].credit = 0;
  } else if (field === "credit" && Number(value) > 0) {
    newLines[index].debit = 0;
  }
  (newLines[index] as any)[field] = value;
  return newLines;
}

// ── Tests ──

describe("Journal Entry Validation", () => {
  describe("Balance check", () => {
    it("returns true for balanced debits and credits", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 1000, credit: 0 },
        { account_id: "a2", debit: 0, credit: 1000 },
      ];
      expect(isBalanced(lines)).toBe(true);
    });

    it("returns false when debits != credits", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 1000, credit: 0 },
        { account_id: "a2", debit: 0, credit: 500 },
      ];
      expect(isBalanced(lines)).toBe(false);
    });

    it("returns false when totals are zero", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 0, credit: 0 },
      ];
      expect(isBalanced(lines)).toBe(false);
    });

    it("allows tiny floating point differences within EPSILON", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 100.001, credit: 0 },
        { account_id: "a2", debit: 0, credit: 100.004 },
      ];
      expect(isBalanced(lines)).toBe(true);
    });

    it("rejects differences beyond EPSILON", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 100.00, credit: 0 },
        { account_id: "a2", debit: 0, credit: 100.01 },
      ];
      expect(isBalanced(lines)).toBe(false);
    });

    it("handles multi-line balanced entries", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 500, credit: 0 },
        { account_id: "a2", debit: 300, credit: 0 },
        { account_id: "a3", debit: 200, credit: 0 },
        { account_id: "a4", debit: 0, credit: 1000 },
      ];
      expect(isBalanced(lines)).toBe(true);
    });
  });

  describe("Duplicate accounts", () => {
    it("detects duplicate account IDs", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 500, credit: 0 },
        { account_id: "a1", debit: 0, credit: 500 },
      ];
      expect(hasDuplicateAccounts(lines)).toBe(true);
    });

    it("allows unique account IDs", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 500, credit: 0 },
        { account_id: "a2", debit: 0, credit: 500 },
      ];
      expect(hasDuplicateAccounts(lines)).toBe(false);
    });

    it("ignores empty lines", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 500, credit: 0 },
        { account_id: "", debit: 0, credit: 0 },
        { account_id: "a2", debit: 0, credit: 500 },
      ];
      expect(hasDuplicateAccounts(lines)).toBe(false);
    });
  });

  describe("Invalid lines (both debit & credit)", () => {
    it("detects a line with both debit and credit", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 100, credit: 50 },
      ];
      expect(hasInvalidLines(lines)).toBe(true);
    });

    it("allows lines with only debit or only credit", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 100, credit: 0 },
        { account_id: "a2", debit: 0, credit: 100 },
      ];
      expect(hasInvalidLines(lines)).toBe(false);
    });
  });

  describe("Line update logic", () => {
    it("clears credit when debit is entered", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 0, credit: 500 },
      ];
      const updated = updateLine(lines, 0, "debit", 300);
      expect(updated[0].debit).toBe(300);
      expect(updated[0].credit).toBe(0);
    });

    it("clears debit when credit is entered", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 500, credit: 0 },
      ];
      const updated = updateLine(lines, 0, "credit", 300);
      expect(updated[0].credit).toBe(300);
      expect(updated[0].debit).toBe(0);
    });

    it("does not clear when entering zero", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 500, credit: 0 },
      ];
      const updated = updateLine(lines, 0, "credit", 0);
      expect(updated[0].debit).toBe(500);
      expect(updated[0].credit).toBe(0);
    });

    it("updates account_id without affecting amounts", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 500, credit: 0 },
      ];
      const updated = updateLine(lines, 0, "account_id", "a2");
      expect(updated[0].account_id).toBe("a2");
      expect(updated[0].debit).toBe(500);
    });

    it("does not mutate the original array", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 0, credit: 500 },
      ];
      const updated = updateLine(lines, 0, "debit", 300);
      expect(lines[0].credit).toBe(500);
      expect(updated[0].credit).toBe(0);
    });
  });

  describe("Edge cases", () => {
    it("single line entry is never balanced", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 100, credit: 0 },
      ];
      expect(isBalanced(lines)).toBe(false);
    });

    it("handles very large amounts", () => {
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 999999999.99, credit: 0 },
        { account_id: "a2", debit: 0, credit: 999999999.99 },
      ];
      expect(isBalanced(lines)).toBe(true);
    });

    it("handles decimal precision", () => {
      // 0.1 + 0.2 = 0.30000000000000004 in JS
      const lines: JournalLine[] = [
        { account_id: "a1", debit: 0.1, credit: 0 },
        { account_id: "a2", debit: 0.2, credit: 0 },
        { account_id: "a3", debit: 0, credit: 0.3 },
      ];
      expect(isBalanced(lines)).toBe(true);
    });
  });
});
