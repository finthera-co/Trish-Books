import { describe, it, expect } from "vitest";
import { netAccountBalance } from "@/lib/accountBalances";

const z = { debit: 0, credit: 0 };

describe("netAccountBalance", () => {
  it("debit-normal account with a positive net reports the debit side", () => {
    const r = netAccountBalance({
      accountType: "Asset",
      isContra: false,
      opening: { debit: 1000, credit: 0 },
      movements: { debit: 500, credit: 200 },
    });
    expect(r).toEqual({ balance: 1300, type: "debit" });
  });

  it("credit-normal account with a positive net reports the credit side", () => {
    const r = netAccountBalance({
      accountType: "Liability",
      isContra: false,
      opening: { debit: 0, credit: 800 },
      movements: { debit: 100, credit: 300 },
    });
    expect(r).toEqual({ balance: 1000, type: "credit" });
  });

  it("contra-asset (Accumulated Depreciation) nets to the credit side", () => {
    // Asset type + isContra → credit-normal. A pure credit movement should
    // display on the credit side, NOT be treated as a debit-normal asset.
    const r = netAccountBalance({
      accountType: "Asset",
      isContra: true,
      opening: z,
      movements: { debit: 0, credit: 4500 },
    });
    expect(r).toEqual({ balance: 4500, type: "credit" });
  });

  it("movements can flip an opening-debit account to the credit side", () => {
    const r = netAccountBalance({
      accountType: "Asset",
      isContra: false,
      opening: { debit: 100, credit: 0 },
      movements: { debit: 0, credit: 300 },
    });
    expect(r).toEqual({ balance: 200, type: "credit" });
  });

  it("exact-zero net reports the normal side, not the opposite", () => {
    const r = netAccountBalance({
      accountType: "Asset",
      isContra: false,
      opening: { debit: 100, credit: 0 },
      movements: { debit: 0, credit: 100 },
    });
    expect(r).toEqual({ balance: 0, type: "debit" });
  });
});
