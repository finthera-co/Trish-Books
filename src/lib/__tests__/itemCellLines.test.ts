import { describe, it, expect } from "vitest";
import { buildItemCell, itemCellLines } from "@/lib/pdfTheme";

describe("itemCellLines", () => {
  it("drops the product name when the description restates it with a qualifier", () => {
    // The real 26AUG_CHAW_00076 line: the name printed again above the description.
    expect(itemCellLines("Accountancy Charges", "Accountancy Charges - July 2026"))
      .toEqual(["Accountancy Charges - July 2026"]);
  });

  it("collapses an exact duplicate", () => {
    expect(itemCellLines("Hosting", "Hosting")).toEqual(["Hosting"]);
  });

  it("keeps the name when the description is unrelated", () => {
    expect(itemCellLines("Web Development", "Custom website development"))
      .toEqual(["Web Development", "Custom website development"]);
  });

  it("keeps the longer of the two when the name restates the description", () => {
    expect(itemCellLines("Audit Fee — FY2026", "Audit Fee")).toEqual(["Audit Fee — FY2026"]);
  });

  it("does not treat a shared word opening as a restatement", () => {
    expect(itemCellLines("Pen", "Pencil Set")).toEqual(["Pen", "Pencil Set"]);
  });

  it("ignores case and whitespace differences", () => {
    expect(itemCellLines("Accountancy  Charges", "accountancy charges: August"))
      .toEqual(["accountancy charges: August"]);
  });

  it("falls back to whichever side is present", () => {
    expect(itemCellLines("", "Ad-hoc consulting")).toEqual(["Ad-hoc consulting"]);
    expect(itemCellLines("Retainer", "")).toEqual(["Retainer"]);
    expect(itemCellLines("", "")).toEqual([]);
  });
});

describe("buildItemCell", () => {
  it("joins the surviving lines and never leaks the GL account name", () => {
    expect(buildItemCell({ products: { name: "Accountancy Charges" }, description: "Accountancy Charges - July 2026" }))
      .toBe("Accountancy Charges - July 2026");
    expect(buildItemCell({ products: { name: "Hosting" }, description: "Annual hosting package" }))
      .toBe("Hosting\nAnnual hosting package");
    expect(buildItemCell({ account: { name: "Sales Revenue" } })).toBe("—");
  });
});
