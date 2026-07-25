import { describe, it, expect } from "vitest";
import { findColumnMap, parseDateCell, parseSheetPeriod, parseSheetMatrix, isBroughtForwardText } from "../parser";

describe("parseSheetPeriod", () => {
  it("parses full month + 4-digit year", () => {
    expect(parseSheetPeriod("May 2024")).toEqual({ month: 5, year: 2024 });
  });
  it("parses abbreviated month + 2-digit year", () => {
    expect(parseSheetPeriod("June 24")).toEqual({ month: 6, year: 2024 });
  });
  it("tolerates a trailing space", () => {
    expect(parseSheetPeriod("October 2024 ")).toEqual({ month: 10, year: 2024 });
  });
  it("returns null when undecidable", () => {
    expect(parseSheetPeriod("Sheet1")).toBeNull();
  });
});

describe("isBroughtForwardText", () => {
  it("detects b/f and opening-balance variants", () => {
    expect(isBroughtForwardText("B/F")).toBe(true);
    expect(isBroughtForwardText("Opening Balance")).toBe(true);
    expect(isBroughtForwardText("openning balance")).toBe(true);
    expect(isBroughtForwardText("Salary")).toBe(false);
  });
});

describe("findColumnMap — locate columns by header name, never position", () => {
  it("finds headers regardless of order", () => {
    const matrix = [
      ["Some title"],
      ["Date", "Description", "Credit", "Debit", "Account Type", "Balance"],
      ["2024-05-01", "x", "", "100", "salary", "900"],
    ];
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(false);
    if (!("error" in map)) {
      expect(map.headerRowIndex).toBe(1);
      expect(map.debit).toBe(3);
      expect(map.credit).toBe(2);
      expect(map.accountType).toBe(4);
      expect(map.balance).toBe(5);
    }
  });

  it("recognizes a Cheque Number header as the reference field", () => {
    const matrix = [
      ["Date", "Description", "Account Type", "Debit", "Credit", "Cheque Number"],
      ["2024-05-01", "x", "salary", "100", "", "CHQ-00123"],
    ];
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(false);
    if (!("error" in map)) expect(map.voucherNo).toBe(5);
  });

  it("also accepts 'Cheque No' and 'Voucher No' spellings", () => {
    for (const h of ["Cheque No", "Voucher No", "Chq No", "Check Number"]) {
      const map = findColumnMap([["Date", "Description", "Account Type", "Debit", "Credit", h]]);
      expect("error" in map).toBe(false);
      if (!("error" in map)) expect(map.voucherNo).toBe(5);
    }
  });

  it("errors when a required column is missing", () => {
    const matrix = [["Date", "Description", "Debit"]]; // no Credit, no Account Type
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(true);
  });

  it("errors when no Date header exists in first 5 rows", () => {
    const matrix = [["a"], ["b"], ["c"], ["d"], ["e"], ["Date", "Description", "Account Type", "Debit", "Credit"]];
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(true);
  });

  it("ignores repeated one-hot category columns (first occurrence wins)", () => {
    const matrix = [
      ["Date", "Description", "Account Type", "Debit", "Credit", "Salary", "Rent", "Harvest"],
    ];
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(false);
    if (!("error" in map)) expect(map.accountType).toBe(2);
  });
});

describe("parseDateCell", () => {
  it("parses ISO", () => {
    expect(parseDateCell("2024-05-10")).toBe("2024-05-10");
  });
  it("parses day-first dd/mm/yyyy", () => {
    expect(parseDateCell("10/05/2024")).toBe("2024-05-10");
  });
  it("parses dd-mm-yy", () => {
    expect(parseDateCell("07-06-24")).toBe("2024-06-07");
  });
  it("parses Excel serial numbers", () => {
    expect(parseDateCell(45422)).toBe("2024-05-10");
  });
  it("parses Date instances", () => {
    expect(parseDateCell(new Date(Date.UTC(2024, 4, 10)))).toBe("2024-05-10");
  });
  it("returns null for unparseable / empty", () => {
    expect(parseDateCell("not a date")).toBeNull();
    expect(parseDateCell("")).toBeNull();
    expect(parseDateCell(null)).toBeNull();
    expect(parseDateCell("2024-13-40")).toBeNull();
  });
});

describe("parseSheetMatrix — end to end on a small sheet", () => {
  const matrix = [
    ["Payment Analysis — May"],
    ["Date", "Name", "Description", "Account Type", "Debit", "Credit", "Balance"],
    ["2024-05-01", "", "b/f", "", "", "", "10000"],       // B/F excluded
    ["2024-05-02", "Staff A", "May salary", "Salary", "5000", "", "5000"],
    ["2024-05-03", "Investor", "Capital injection", "", "", "20000", "25000"],
    ["", "", "", "", "", "", ""],                          // fully empty → skipped
    ["2024-05-04", "", "Bank charge", "Bank Fee", "150", "", "24850"],
  ];

  it("skips empty rows, marks B/F excluded, parses the rest", () => {
    const { lines, errors } = parseSheetMatrix(matrix, "May 2024", { month: 5, year: 2024 });
    expect(errors).toHaveLength(0);
    expect(lines).toHaveLength(4); // b/f + 3 data (empty row skipped)
    const bf = lines.find((l) => l.description === "b/f");
    expect(bf?.isExcluded).toBe(true);
    const salary = lines.find((l) => l.rawAccountType === "Salary");
    expect(salary?.debit).toBe(5000);
    expect(salary?.txnDate).toBe("2024-05-02");
    expect(salary?.name).toBe("Staff A");
    const capital = lines.find((l) => l.description === "Capital injection");
    expect(capital?.credit).toBe(20000);
    expect(capital?.rawAccountType).toBe("");
  });

  it("carries the declared period onto every line", () => {
    const { lines } = parseSheetMatrix(matrix, "May 2024", { month: 5, year: 2024 });
    for (const l of lines) {
      expect(l.periodMonth).toBe(5);
      expect(l.periodYear).toBe(2024);
    }
  });
});
