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

  it("recognizes a Cheque Number header as its own cheque field", () => {
    const matrix = [
      ["Date", "Description", "Account Type", "Debit", "Credit", "Cheque Number"],
      ["2024-05-01", "x", "salary", "100", "", "CHQ-00123"],
    ];
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(false);
    if (!("error" in map)) { expect(map.cheque).toBe(5); expect(map.voucherNo).toBeNull(); }
  });

  it("classifies cheque vs voucher spellings into the right fields", () => {
    for (const h of ["Cheque No", "Chq No", "Check Number", "CHQ NO."]) {
      const map = findColumnMap([["Date", "Description", "Account Type", "Debit", "Credit", h]]);
      if (!("error" in map)) expect(map.cheque, h).toBe(5);
    }
    for (const h of ["Voucher No", "Ref No", "Instrument No"]) {
      const map = findColumnMap([["Date", "Description", "Account Type", "Debit", "Credit", h]]);
      if (!("error" in map)) expect(map.voucherNo, h).toBe(5);
    }
  });

  it("prefers CHQ NO. over Voucher No when a sheet has both (real Sampath layout)", () => {
    const matrix = [
      ["Date", "Voucher No", "Name ", "CHQ NO.", "Description", "Account Type", "Debit", "Credit"],
      ["2024-05-01", "Jul024", "Payee A", "600123", "salary pmt", "Salary", "100", ""],
      ["2024-05-02", "Aug024", "Payee B", "", "cash withdrawal", "Cash", "50", ""],
    ];
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(false);
    if (!("error" in map)) { expect(map.cheque).toBe(3); expect(map.voucherNo).toBe(1); }
    const { lines } = parseSheetMatrix(matrix, "FINAL", { month: 5, year: 2024 });
    expect(lines[0].voucherNo).toBe("600123"); // the cheque, not "Jul024"
    expect(lines[1].voucherNo).toBe("");        // blank cheque stays blank (not "Aug024")
  });

  it("uses CHQ NO. as the cheque when the Voucher No column is removed", () => {
    // The sheet the user re-imports: only a cheque column, no voucher column.
    const matrix = [
      ["Date", "Name ", "CHQ NO.", "Description", "Account Type", "Debit", "Credit"],
      ["2024-05-01", "Payee A", "600123", "salary pmt", "Salary", "100", ""],
      ["2024-05-02", "Payee B", "", "cash", "Cash", "50", ""],
    ];
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(false);
    if (!("error" in map)) { expect(map.cheque).toBe(2); expect(map.voucherNo).toBeNull(); }
    const { lines } = parseSheetMatrix(matrix, "FINAL", { month: 5, year: 2024 });
    expect(lines[0].voucherNo).toBe("600123");
    expect(lines[1].voucherNo).toBe("");
  });

  it("accepts a debit-only money column (Account Type is optional)", () => {
    const map = findColumnMap([["Date", "Description", "Debit"]]);
    expect("error" in map).toBe(false);
    if (!("error" in map)) { expect(map.debit).toBe(2); expect(map.accountType).toBeNull(); }
  });

  it("errors (with a helpful message) when there is no money column", () => {
    const map = findColumnMap([["Date", "Particulars", "Cheque No"]]);
    expect("error" in map).toBe(true);
    if ("error" in map) expect(map.error).toMatch(/money column/);
  });

  it("finds a header row below a title / account block", () => {
    const matrix = [
      ["ACME BANK PLC"], ["Account No: 123456"], ["Statement for May 2024"], ["", ""],
      ["Date", "Description", "Account Type", "Debit", "Credit"],
      ["2024-05-01", "x", "salary", "100", ""],
    ];
    const map = findColumnMap(matrix);
    expect("error" in map).toBe(false);
    if (!("error" in map)) expect(map.headerRowIndex).toBe(4);
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

  // ── Extended coverage: the shapes real workbooks actually contain ──────────
  it("parses year-first with slash and dot separators", () => {
    expect(parseDateCell("2024/05/10")).toBe("2024-05-10");
    expect(parseDateCell("2024.05.10")).toBe("2024-05-10");
  });
  it("parses day-first with dots", () => {
    expect(parseDateCell("10.05.2024")).toBe("2024-05-10");
  });
  it("recovers a US month-first date when day-first is impossible", () => {
    expect(parseDateCell("05/13/2024")).toBe("2024-05-13"); // 13 can't be a month
  });
  it("treats a fully ambiguous date as day-first (SL convention)", () => {
    expect(parseDateCell("06/05/2024")).toBe("2024-05-06");
  });
  it("parses spelled months in any order, with ordinals and commas", () => {
    expect(parseDateCell("5 Jun 2024")).toBe("2024-06-05");
    expect(parseDateCell("June 5, 2024")).toBe("2024-06-05");
    expect(parseDateCell("05-Jun-24")).toBe("2024-06-05");
    expect(parseDateCell("1st April 2025")).toBe("2025-04-01");
    expect(parseDateCell("2024 June 5")).toBe("2024-06-05");
    expect(parseDateCell("Mon, 05 Jun 2024")).toBe("2024-06-05"); // weekday ignored
  });
  it("tolerates a trailing time component and stray quotes/whitespace", () => {
    expect(parseDateCell("2024-05-10 00:00:00")).toBe("2024-05-10");
    expect(parseDateCell("10/05/2024T13:45")).toBe("2024-05-10");
    expect(parseDateCell("'10/05/2024")).toBe("2024-05-10");
    expect(parseDateCell("  10/05/2024  ")).toBe("2024-05-10");
  });
  it("parses an Excel serial stored as text", () => {
    expect(parseDateCell("45422")).toBe("2024-05-10");
  });
  it("returns null for unparseable / empty / out-of-range", () => {
    expect(parseDateCell("not a date")).toBeNull();
    expect(parseDateCell("")).toBeNull();
    expect(parseDateCell(null)).toBeNull();
    expect(parseDateCell("2024-13-40")).toBeNull();
    expect(parseDateCell("2024")).toBeNull();       // bare year is not a full date
    expect(parseDateCell("32/01/2024")).toBeNull(); // no valid day 32
  });
});

describe("parseSheetMatrix — forward-fills blank date cells (grouped-date layout)", () => {
  const matrix = [
    ["Date", "Name", "Description", "Account Type", "Debit", "Credit", "Balance"],
    ["05/06/2024", "A", "First of the day", "Salary", "100", "", ""],
    ["", "B", "Same day, blank date", "Salary", "200", "", ""],           // inherits 2024-06-05
    ["", "C", "Still same day", "", "", "300", ""],                        // inherits 2024-06-05
    ["06/06/2024", "D", "Next day", "Salary", "400", "", ""],
    ["", "E", "Blank under next day", "", "500", "", ""],                  // inherits 2024-06-06
  ];

  it("carries the last real date onto following blank-date rows", () => {
    const { lines } = parseSheetMatrix(matrix, "Jun 2024", { month: 6, year: 2024 });
    expect(lines.map((l) => l.txnDate)).toEqual([
      "2024-06-05", "2024-06-05", "2024-06-05", "2024-06-06", "2024-06-06",
    ]);
    expect(lines[1].parseFlags).toContain("date_forward_filled");
    expect(lines[3].parseFlags).not.toContain("date_forward_filled"); // it had its own date
  });

  it("does NOT forward-fill a blank-date row that has no amount (stray/near-empty row)", () => {
    const m = [
      ["Date", "Name", "Description", "Account Type", "Debit", "Credit"],
      ["05/06/2024", "A", "real txn", "Salary", "100", ""],
      ["", "", "note with no money", "", "", ""],   // blank date, no amount → not dated
    ];
    const { lines } = parseSheetMatrix(m, "Jun 2024", { month: 6, year: 2024 });
    expect(lines[1].txnDate).toBeNull();
    expect(lines[1].parseFlags).not.toContain("date_forward_filled");
  });

  it("flags a present-but-unreadable date instead of forward-filling it", () => {
    const m = [
      ["Date", "Name", "Description", "Account Type", "Debit", "Credit"],
      ["05/06/2024", "A", "ok", "Salary", "100", ""],
      ["garbage-date", "B", "bad date", "Salary", "200", ""],
    ];
    const { lines } = parseSheetMatrix(m, "Jun 2024", { month: 6, year: 2024 });
    expect(lines[1].txnDate).toBeNull();
    expect(lines[1].parseFlags).toContain("unparseable_date");
  });
});

describe("parseSheetMatrix — bank-agnostic layouts (other banks)", () => {
  it("maps Value Date / Particulars / Withdrawal / Deposit, no Account Type", () => {
    const matrix = [
      ["Value Date", "Particulars", "Withdrawal", "Deposit", "Balance"],
      ["2024-05-02", "ATM CASH", "5000", "", "95000"],
      ["2024-05-03", "SALARY CREDIT", "", "80000", "175000"],
    ];
    const { lines, errors } = parseSheetMatrix(matrix, "May 2024", { month: 5, year: 2024 });
    expect(errors).toHaveLength(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ debit: 5000, credit: 0, rawAccountType: "", description: "ATM CASH" });
    expect(lines[1]).toMatchObject({ debit: 0, credit: 80000, txnDate: "2024-05-03" });
  });

  it("splits a single signed Amount column by sign (negative = money out)", () => {
    const matrix = [
      ["Date", "Narration", "Amount"],
      ["2024-05-02", "POS PURCHASE", "-1500.50"],
      ["2024-05-03", "REFUND", "2000"],
    ];
    const { lines } = parseSheetMatrix(matrix, "May 2024", { month: 5, year: 2024 });
    expect(lines[0]).toMatchObject({ debit: 1500.5, credit: 0 });
    expect(lines[0].parseFlags).toContain("amount_sign_inferred");
    expect(lines[1]).toMatchObject({ debit: 0, credit: 2000 });
  });

  it("uses a Dr/Cr indicator column alongside a single Amount", () => {
    const matrix = [
      ["Txn Date", "Description", "Amount", "Dr/Cr"],
      ["2024-05-02", "FEES", "300", "Dr"],
      ["2024-05-03", "INTEREST", "150", "Cr"],
    ];
    const { lines } = parseSheetMatrix(matrix, "May 2024", { month: 5, year: 2024 });
    expect(lines[0]).toMatchObject({ debit: 300, credit: 0 });
    expect(lines[1]).toMatchObject({ debit: 0, credit: 150 });
    expect(lines[0].parseFlags).not.toContain("amount_sign_inferred");
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
