import { describe, it, expect } from "vitest";
import {
  calculateLineTax,
  calculateWht,
  calculateReverseCharge,
  calculateApit,
  allocateDocumentRounding,
  type TaxMemberInput,
  type WhtRuleInput,
  type ApitSchedule,
} from "../taxEngine";

const SSCL: TaxMemberInput = {
  taxCodeId: "sscl",
  code: "SSCL",
  rate: 2.5,
  isCompound: false,
  applyOrder: 1,
  collectionMode: "output",
};
const VAT: TaxMemberInput = {
  taxCodeId: "vat",
  code: "VAT18",
  rate: 18,
  isCompound: true,
  applyOrder: 2,
  collectionMode: "output",
};

const slMembers = [SSCL, VAT];

describe("calculateLineTax — compound SL case", () => {
  it("computes the canonical 100,000 → 120,950 chain", () => {
    const r = calculateLineTax({
      lineAmount: 100000,
      isInclusive: false,
      members: slMembers,
      roundingMethod: "half_up",
      roundingLevel: "line",
      documentDate: "2026-06-13",
    });
    expect(r.exclusiveBase).toBe(100000);
    expect(r.taxes.find((t) => t.code === "SSCL")!.amount).toBe(2500);
    const vat = r.taxes.find((t) => t.code === "VAT18")!;
    expect(vat.base).toBe(102500);
    expect(vat.amount).toBe(18450);
    expect(r.lineTotal).toBe(120950);
  });

  it("applies members by apply_order regardless of input order", () => {
    const r = calculateLineTax({
      lineAmount: 100000,
      isInclusive: false,
      members: [VAT, SSCL],
      roundingMethod: "half_up",
      roundingLevel: "line",
      documentDate: "2026-06-13",
    });
    expect(r.lineTotal).toBe(120950);
  });
});

describe("calculateLineTax — inclusive round-trip", () => {
  it("back-calculates the exclusive base algebraically", () => {
    // 120,950 inclusive must round-trip to base 100,000
    const r = calculateLineTax({
      lineAmount: 120950,
      isInclusive: true,
      members: slMembers,
      roundingMethod: "half_up",
      roundingLevel: "line",
      documentDate: "2026-06-13",
    });
    expect(r.exclusiveBase).toBe(100000);
    expect(r.taxes.find((t) => t.code === "SSCL")!.amount).toBe(2500);
    expect(r.taxes.find((t) => t.code === "VAT18")!.amount).toBe(18450);
    expect(r.lineTotal).toBe(120950);
  });

  it("single-code inclusive: 118 inclusive of VAT 18% → base 100", () => {
    const r = calculateLineTax({
      lineAmount: 118,
      isInclusive: true,
      members: [{ ...VAT, isCompound: false, applyOrder: 1 }],
      roundingMethod: "half_up",
      roundingLevel: "line",
      documentDate: "2026-06-13",
    });
    expect(r.exclusiveBase).toBe(100);
    expect(r.taxes[0].amount).toBe(18);
    expect(r.lineTotal).toBe(118);
  });
});

describe("document-level rounding reconciliation", () => {
  it("rounds once at document level and pushes drift onto the largest line", () => {
    // Three lines whose individually-rounded taxes drift from the document round
    const unrounded = [10.005, 10.005, 33.335];
    const { perLine, documentTotal } = allocateDocumentRounding(unrounded, "half_up");
    expect(documentTotal).toBe(53.35);
    expect(roundTo2(perLine.reduce((s, a) => s + a, 0))).toBe(documentTotal);
    // drift landed on the largest line
    expect(perLine[2]).not.toBe(33.34);
  });

  function roundTo2(n: number) {
    return Math.round(n * 100) / 100;
  }
});

describe("calculateWht — AIT thresholds (settlement-based)", () => {
  const rule: WhtRuleInput = {
    id: "r1",
    taxCodeId: "wht-svc",
    paymentNature: "service_fee",
    payeeType: "resident_individual",
    rate: 5,
    thresholdAmount: 100000,
    thresholdPeriod: "per_month",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    certificateRequired: true,
  };
  const vendor = {
    payeeType: "resident_individual",
    defaultPaymentNature: "service_fee",
    whtExempt: false,
  };

  it("returns null at 99,999 (below threshold)", () => {
    expect(calculateWht(99999, vendor, [rule], "2026-06-13", 0)).toBeNull();
  });

  it("withholds only on the excess at 100,001", () => {
    const r = calculateWht(100001, vendor, [rule], "2026-06-13", 0)!;
    expect(r.taxableAmount).toBe(1);
    expect(r.whtAmount).toBe(0.05);
    expect(r.netPayable).toBe(100000.95);
  });

  it("withholds subsequent payments in full once the threshold is crossed", () => {
    const r = calculateWht(50000, vendor, [rule], "2026-06-13", 120000)!;
    expect(r.taxableAmount).toBe(50000);
    expect(r.whtAmount).toBe(2500);
    expect(r.netPayable).toBe(47500);
  });

  it("partial payments: WHT per payment, crossing mid-stream", () => {
    // Bill 150k paid 80k then 70k. First: 80k ≤ 100k → null.
    expect(calculateWht(80000, vendor, [rule], "2026-06-13", 0)).toBeNull();
    // Second: cumulative 150k → taxable portion 50k.
    const second = calculateWht(70000, vendor, [rule], "2026-06-13", 80000)!;
    expect(second.taxableAmount).toBe(50000);
    expect(second.whtAmount).toBe(2500);
  });

  it("respects vendor wht_exempt", () => {
    expect(
      calculateWht(500000, { ...vendor, whtExempt: true }, [rule], "2026-06-13", 0)
    ).toBeNull();
  });

  it("ignores rules outside their effective window", () => {
    const expired = { ...rule, effectiveTo: "2025-12-31" };
    expect(calculateWht(200000, vendor, [expired], "2026-06-13", 0)).toBeNull();
  });
});

describe("calculateReverseCharge", () => {
  it("emits symmetric output and input legs", () => {
    const { outputTax, inputTax } = calculateReverseCharge(100000, 18);
    expect(outputTax).toBe(18000);
    expect(inputTax).toBe(18000);
    expect(outputTax).toBe(inputTax);
  });
});

describe("calculateApit — 2025/26 indicative schedule", () => {
  const schedule: ApitSchedule = {
    id: "s1",
    annualRelief: 1800000,
    brackets: [
      { bracketOrder: 1, annualAmountUpTo: 1000000, rate: 6 },
      { bracketOrder: 2, annualAmountUpTo: 1500000, rate: 18 },
      { bracketOrder: 3, annualAmountUpTo: 2000000, rate: 24 },
      { bracketOrder: 4, annualAmountUpTo: 2500000, rate: 30 },
      { bracketOrder: 5, annualAmountUpTo: null, rate: 36 },
    ],
  };

  it("is zero at the relief boundary (150,000/month = 1.8M/yr)", () => {
    const r = calculateApit(150000, schedule);
    expect(r.annualTaxable).toBe(0);
    expect(r.monthlyApit).toBe(0);
  });

  it("taxes only the first slice just above relief", () => {
    // 200,000/month → annual 2.4M − 1.8M relief = 600k taxable @6% = 36k/yr = 3k/month
    const r = calculateApit(200000, schedule);
    expect(r.annualTaxable).toBe(600000);
    expect(r.annualTax).toBe(36000);
    expect(r.monthlyApit).toBe(3000);
  });

  it("reaches the top bracket for high earners", () => {
    // 500,000/month → annual 6M − 1.8M = 4.2M taxable
    // 1M@6%=60k + 500k@18%=90k + 500k@24%=120k + 500k@30%=150k + 1.7M@36%=612k = 1,032k
    const r = calculateApit(500000, schedule);
    expect(r.annualTaxable).toBe(4200000);
    expect(r.annualTax).toBe(1032000);
    expect(r.monthlyApit).toBe(86000);
    expect(r.trace.evaluation_steps.some((s) => s.includes("top bracket"))).toBe(true);
  });

  it("emits a payroll-compatible trace", () => {
    const r = calculateApit(300000, schedule);
    expect(r.trace.formula_type).toBe("CONDITIONAL");
    expect(r.trace.base_component).toBe("GROSS_PAY");
    expect(r.trace.result).toBe(r.monthlyApit);
    expect(r.trace.evaluation_steps.length).toBeGreaterThan(2);
  });

  it("taxes a one-off bonus once (not annualized ×12)", () => {
    // Regular 200,000/mo → 3,000/mo APIT (as above). A 100,000 bonus this month
    // sits on top of annual regular 2.4M: it falls in the 6% band (still below the
    // 2.8M gross / 1M-taxable ceiling), so bonus tax = 100,000 × 6% = 6,000 — once.
    const base = calculateApit(200000, schedule);
    const withBonus = calculateApit(300000, schedule, 100000); // 200k regular + 100k bonus
    expect(withBonus.monthlyApit).toBe(base.monthlyApit + 6000);
  });

  it("does NOT push the whole bonus through 12× annualization", () => {
    // The naive ×12 bug would annualize 300,000 → 3.6M, taxing far more than the
    // correct regular(3,000) + bonus(6,000) = 9,000.
    const r = calculateApit(300000, schedule, 100000);
    expect(r.monthlyApit).toBe(9000);
    // Naive ×12 would have produced ~18,000+/month.
    expect(r.monthlyApit).toBeLessThan(12000);
  });

  it("with zero lump sum matches the pure-regular result", () => {
    const a = calculateApit(300000, schedule);
    const b = calculateApit(300000, schedule, 0);
    expect(b.monthlyApit).toBe(a.monthlyApit);
    expect(b.annualTax).toBe(a.annualTax);
  });

  it("cumulative month 1 (no history) equals the single-month result", () => {
    const single = calculateApit(300000, schedule);
    const cumulative = calculateApit(300000, schedule, 0, { priorGross: 0, priorPaye: 0, monthIndex: 1 });
    expect(cumulative.monthlyApit).toBe(single.monthlyApit);
  });

  it("cumulative is flat across months for a constant salary", () => {
    // 300k/month constant: every month should withhold the same as the single-month figure.
    const base = calculateApit(300000, schedule).monthlyApit;
    let priorGross = 0, priorPaye = 0;
    for (let m = 1; m <= 12; m++) {
      const r = calculateApit(300000, schedule, 0, { priorGross, priorPaye, monthIndex: m });
      expect(r.monthlyApit).toBe(base);
      priorGross += 300000;
      priorPaye += r.monthlyApit;
    }
  });

  it("cumulative weekly (yearFraction) converges to the annual tax", () => {
    // 52 equal weekly pays; using yearFraction = week/52, the full-year PAYE must
    // equal the annual tax on the year's total.
    const weekly = 60000; // ~260k/month equivalent
    let priorGross = 0, priorPaye = 0, total = 0;
    for (let w = 1; w <= 52; w++) {
      const r = calculateApit(weekly, schedule, 0, { priorGross, priorPaye, monthIndex: 1, yearFraction: w / 52 });
      total += r.monthlyApit;
      priorGross += weekly;
      priorPaye += r.monthlyApit;
    }
    const annualTax = calculateApit((weekly * 52) / 12, schedule).annualTax;
    expect(Math.abs(total - annualTax)).toBeLessThanOrEqual(2);
  });

  it("cumulative self-corrects a mid-year raise over the remaining months", () => {
    // 200k for 6 months then 400k for 6 months. The full-year tax must equal the
    // tax on the actual annual total, regardless of the monthly path.
    let priorGross = 0, priorPaye = 0, totalPaye = 0;
    for (let m = 1; m <= 12; m++) {
      const gross = m <= 6 ? 200000 : 400000;
      const r = calculateApit(gross, schedule, 0, { priorGross, priorPaye, monthIndex: m });
      totalPaye += r.monthlyApit;
      priorGross += gross;
      priorPaye += r.monthlyApit;
    }
    const annualGross = 200000 * 6 + 400000 * 6; // 3.6M
    const annualTax = calculateApit(annualGross / 12, schedule).annualTax; // tax on annual total
    expect(Math.abs(totalPaye - annualTax)).toBeLessThanOrEqual(2); // rupee rounding only
  });
});
