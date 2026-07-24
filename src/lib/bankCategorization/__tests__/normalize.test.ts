import { describe, it, expect } from "vitest";
import { normalizeText, parseAmountCell } from "../normalize";

describe("normalizeText", () => {
  it("trims, collapses whitespace, lowercases", () => {
    expect(normalizeText("  Bank   FEE  ")).toBe("bank fee");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeText("Salary.")).toBe("salary");
    expect(normalizeText("ORC & Travel Allowance,")).toBe("orc & travel allowance");
  });

  it("applies NFKC (full-width → ascii)", () => {
    expect(normalizeText("ｈａｒｖｅｓｔ")).toBe("harvest");
  });

  it("handles null / undefined / empty", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText("")).toBe("");
    expect(normalizeText("   ")).toBe("");
  });

  it("collapses NBSP and tabs", () => {
    expect(normalizeText("bank \tfee")).toBe("bank fee");
  });

  // Property: idempotence — normalizing twice equals normalizing once.
  it("is idempotent over a sample of inputs", () => {
    const samples = [
      "  Harvest ", "SALARY REVERSE.", "orc/travelling allowance,,,",
      "ｄｅｌｅｃｔａ  Bottle", "Legal & Compliance Cost!", "  ", "Bank Fee\t\n",
      "…mixed—punct;", "Trainning & Devolopment", "green   crest",
    ];
    for (const s of samples) {
      const once = normalizeText(s);
      expect(normalizeText(once)).toBe(once);
    }
  });
});

describe("parseAmountCell", () => {
  it("passes numbers through", () => {
    expect(parseAmountCell(1234.5)).toBe(1234.5);
    expect(parseAmountCell(0)).toBe(0);
  });

  it("empty / null → 0", () => {
    expect(parseAmountCell("")).toBe(0);
    expect(parseAmountCell(null)).toBe(0);
    expect(parseAmountCell(undefined)).toBe(0);
    expect(parseAmountCell("-")).toBe(0);
  });

  it("parses thousands separators and currency", () => {
    expect(parseAmountCell("1,234.50")).toBe(1234.5);
    expect(parseAmountCell("LKR 2,000")).toBe(2000);
    expect(parseAmountCell("Rs. 500")).toBe(500);
  });

  it("parses accounting negatives", () => {
    expect(parseAmountCell("(1,234.50)")).toBe(-1234.5);
  });

  it("non-numeric → NaN", () => {
    expect(Number.isNaN(parseAmountCell("abc"))).toBe(true);
    expect(Number.isNaN(parseAmountCell(true))).toBe(true);
  });
});
