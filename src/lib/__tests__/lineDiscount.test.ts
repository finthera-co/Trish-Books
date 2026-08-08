import { describe, it, expect } from "vitest";
import {
  apportionDiscount, discountFromPercent, percentFromDiscount, lineGross,
} from "@/lib/lineDiscount";

const sum = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) * 100) / 100;

describe("line discount %/amount pairing", () => {
  it("converts between a percentage and its money value", () => {
    expect(discountFromPercent(2, 20000, 10)).toBe(4000);
    expect(percentFromDiscount(2, 20000, 4000)).toBe(10);
  });

  it("clamps the percentage and never discounts a zero-value line", () => {
    expect(discountFromPercent(1, 1000, 150)).toBe(1000);
    expect(discountFromPercent(1, 1000, -5)).toBe(0);
    expect(percentFromDiscount(0, 0, 500)).toBe(0);
    expect(lineGross(3, 33.335)).toBe(100.01);
  });
});

describe("invoice-level discount apportionment", () => {
  it("splits pro-rata on line net", () => {
    expect(apportionDiscount([6000, 4000], 1000)).toEqual([600, 400]);
  });

  it("always sums to exactly the discount given, despite rounding", () => {
    // Three equal lines can't take a third of 100 each without a residual cent.
    const shares = apportionDiscount([100, 100, 100], 100);
    expect(sum(shares)).toBe(100);
    // …and the residual lands on a line that can absorb it.
    shares.forEach((s, i) => expect(s).toBeLessThanOrEqual([100, 100, 100][i]));
  });

  it("keeps the total exact on awkward ratios", () => {
    for (const total of [33.33, 999.99, 1, 0.01]) {
      expect(sum(apportionDiscount([1234.56, 7.89, 4321], total))).toBe(total);
    }
  });

  it("never gives a line more discount than it has left", () => {
    const shares = apportionDiscount([10, 990], 500);
    expect(shares[0]).toBeLessThanOrEqual(10);
    expect(sum(shares)).toBe(500);
  });

  it("caps at the net total — an invoice cannot go below zero", () => {
    expect(sum(apportionDiscount([100, 100], 5000))).toBe(200);
  });

  it("gives nothing away when there is nothing to discount", () => {
    expect(apportionDiscount([0, 0], 100)).toEqual([0, 0]);
    expect(apportionDiscount([100, 50], 0)).toEqual([0, 0]);
    expect(apportionDiscount([100, 50], -10)).toEqual([0, 0]);
  });

  it("skips lines that are already fully discounted", () => {
    // Second line's own discount wiped it out, so it takes no share.
    expect(apportionDiscount([500, 0], 100)).toEqual([100, 0]);
  });
});
