import { describe, it, expect } from "vitest";
import {
  isNonCurrentAssetSubtype,
  isNonCurrentLiabilitySubtype,
  isContraSubtype,
  getNormalBalance,
} from "@/lib/accountTypes";

/**
 * The Statement of Financial Position splits on the DETAIL type, and nets
 * contra accounts against their parent. Both rules used to be inferred from
 * the account type alone, which put every fixed asset in current assets and
 * added accumulated depreciation to net book value instead of deducting it.
 */
describe("non-current asset subtypes", () => {
  it.each([
    "Property, Plant & Equipment",
    "Fixed Asset",
    "Fixed Assets",
    "Furniture & Equipment",
    "Vehicles",
    "Buildings",
    "Intangible Assets",
    "Accumulated Depreciation",
  ])("classifies %s as non-current", (subtype) => {
    expect(isNonCurrentAssetSubtype(subtype)).toBe(true);
  });

  it.each([
    "Cash on Hand",
    "Bank",
    "Checking",
    "Savings",
    "Accounts Receivable",
    "Trade Receivable",
    "Tax Receivable",
    "Other Current Assets",
    "Inventory",
    "Prepaid Expenses",
  ])("leaves %s in current assets", (subtype) => {
    expect(isNonCurrentAssetSubtype(subtype)).toBe(false);
  });

  it("treats a missing subtype as current rather than guessing", () => {
    expect(isNonCurrentAssetSubtype(null)).toBe(false);
    expect(isNonCurrentAssetSubtype("")).toBe(false);
  });
});

describe("non-current liability subtypes", () => {
  it.each(["Long-term Liability", "Long-Term Loan", "Long Term Loan", "Deferred Tax Liability"])(
    "classifies %s as non-current",
    (subtype) => {
      expect(isNonCurrentLiabilitySubtype(subtype)).toBe(true);
    }
  );

  it.each(["Accounts Payable", "Credit Card", "Payroll Liability", "Sales Tax Payable", "Other Payables"])(
    "leaves %s in current liabilities",
    (subtype) => {
      expect(isNonCurrentLiabilitySubtype(subtype)).toBe(false);
    }
  );
});

describe("accumulated depreciation is credit-normal", () => {
  it("inverts the Asset type's debit-normal side", () => {
    expect(isContraSubtype("Accumulated Depreciation")).toBe(true);
    expect(getNormalBalance("Asset", true)).toBe("Credit");
    expect(getNormalBalance("Asset", false)).toBe("Debit");
  });

  it("nets against gross PPE rather than adding to it", () => {
    // Gross cost sits on the debit side, accumulated depreciation on the
    // credit side; net book value is the difference, never the sum.
    const grossPPE = 122_930_035;
    const accumDepDebits = 0;
    const accumDepCredits = 6_603_158.35;
    const accumDep =
      getNormalBalance("Asset", true) === "Debit"
        ? accumDepDebits - accumDepCredits
        : accumDepCredits - accumDepDebits;

    expect(accumDep).toBeCloseTo(6_603_158.35, 2);
    expect(grossPPE - accumDep).toBeCloseTo(116_326_876.65, 2);
  });
});
