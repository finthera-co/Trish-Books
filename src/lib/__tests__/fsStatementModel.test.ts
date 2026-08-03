import { describe, it, expect } from "vitest";
import { fmtStatement, fmtEps, fmtMargin, rowClasses } from "../fsStatementModel";

describe("fmtStatement", () => {
  it("blanks zero on detail lines (blankZero=true)", () => {
    expect(fmtStatement(0, true)).toBe("");
    expect(fmtStatement(null, true)).toBe("");
    expect(fmtStatement(undefined, true)).toBe("");
  });

  it("shows a genuine zero subtotal as 0.00 when blankZero=false", () => {
    expect(fmtStatement(0, false)).toBe("0.00");
  });

  it("wraps negatives in parentheses with no minus sign", () => {
    expect(fmtStatement(-1629561652.68, false)).toBe("(1,629,561,652.68)");
  });

  it("formats positives with thousands separators, no currency symbol", () => {
    expect(fmtStatement(2150487725.11, false)).toBe("2,150,487,725.11");
  });
});

describe("fmtEps", () => {
  it("renders 2dp with no thousands separator, matching the reference (793.58)", () => {
    expect(fmtEps(793.58)).toBe("793.58");
  });

  it("wraps a loss-per-share in parentheses", () => {
    expect(fmtEps(-12.34)).toBe("(12.34)");
  });

  it("blanks when the parameter was missing (null)", () => {
    expect(fmtEps(null)).toBe("");
  });
});

describe("fmtMargin", () => {
  // Reference file's three margin lines: GROSS_PROFIT, PBT, PROFIT_FOR_YEAR.
  it("matches the reference margins to 2dp", () => {
    expect(fmtMargin(24.22)).toBe("24.22");
    expect(fmtMargin(9.48)).toBe("9.48");
    expect(fmtMargin(6.27)).toBe("6.27");
  });

  it("blanks when null (base was zero, not Infinity, not 0)", () => {
    expect(fmtMargin(null)).toBe("");
  });
});

describe("rowClasses", () => {
  it("maps each emphasis level to its expected rule/weight classes", () => {
    expect(rowClasses("normal")).toBe("");
    expect(rowClasses("bold")).toBe("font-bold");
    expect(rowClasses("bold_rule")).toContain("border-t");
    expect(rowClasses("bold_rule")).toContain("font-bold");
    expect(rowClasses("total_rule")).toContain("border-t-2");
    expect(rowClasses("total_rule")).toContain("border-double");
  });
});
