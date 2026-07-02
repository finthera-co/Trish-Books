/**
 * Sri Lanka Tax Engine — pure, deterministic calculation core.
 *
 * This file is mirrored at supabase/functions/_shared/taxEngine.ts and the
 * two copies MUST stay identical (client previews and server posting must
 * agree to the cent). No imports — fully self-contained.
 *
 * Canonical SL compound case: 100,000 → SSCL 2.5% = 2,500 → VAT 18% on
 * 102,500 = 18,450 → total 120,950.
 */

export type RoundingMethod = "half_up" | "half_even" | "down";
export type RoundingLevel = "line" | "document";
export type CollectionMode =
  | "output"
  | "input"
  | "withholding_payable"
  | "withholding_receivable"
  | "reverse_charge";

export interface TaxMemberInput {
  taxCodeId: string;
  code: string;
  /** Percentage, e.g. 18 for 18% — resolved by DOCUMENT DATE, never "current". */
  rate: number;
  /** True when this member compounds on the previous members' tax (e.g. VAT on SSCL). */
  isCompound: boolean;
  applyOrder: number;
  collectionMode: CollectionMode;
}

export interface LineTaxInput {
  /** qty * unit price after line discount */
  lineAmount: number;
  isInclusive: boolean;
  members: TaxMemberInput[];
  roundingMethod: RoundingMethod;
  roundingLevel: RoundingLevel;
  /** ISO date of the document — informational; rates must already be resolved for it. */
  documentDate: string;
}

export interface LineTaxResult {
  exclusiveBase: number;
  taxes: { taxCodeId: string; code: string; base: number; amount: number; rate: number; collectionMode: CollectionMode }[];
  lineTotal: number;
}

export function roundAmount(value: number, method: RoundingMethod, dp = 2): number {
  const f = Math.pow(10, dp);
  // Guard fp drift before applying the rounding rule
  const scaled = Math.round(value * f * 1e6) / 1e6;
  switch (method) {
    case "down":
      return Math.trunc(scaled) / f;
    case "half_even": {
      const floor = Math.floor(scaled);
      const diff = scaled - floor;
      if (Math.abs(diff - 0.5) < 1e-9) {
        return (floor % 2 === 0 ? floor : floor + 1) / f;
      }
      return Math.round(scaled) / f;
    }
    case "half_up":
    default:
      // JS Math.round rounds -0.5 toward +inf; emulate symmetric half-up
      return (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / f;
  }
}

const sortMembers = (members: TaxMemberInput[]) =>
  [...members].sort((a, b) => a.applyOrder - b.applyOrder);

/**
 * Gross-up factor for inclusive pricing: F = 1 + Σ rᵢ·bᵢ where bᵢ = 1 for
 * simple members and bᵢ = 1 + Σ(previous members' rates) for compound ones.
 * Canonical SL: F = 1 + r_sscl + r_vat·(1 + r_sscl). Algebraic, no iteration.
 */
function grossUpFactor(members: TaxMemberInput[]): number {
  let factor = 1;
  let priorRateSum = 0;
  for (const m of members) {
    const r = m.rate / 100;
    factor += r * (m.isCompound ? 1 + priorRateSum : 1);
    priorRateSum += r;
  }
  return factor;
}

export function calculateLineTax(input: LineTaxInput): LineTaxResult {
  const members = sortMembers(input.members);
  const { roundingMethod, roundingLevel } = input;

  if (members.length === 0) {
    const base = roundAmount(input.lineAmount, roundingMethod);
    return { exclusiveBase: base, taxes: [], lineTotal: base };
  }

  const exclusiveBase = input.isInclusive
    ? input.lineAmount / grossUpFactor(members)
    : input.lineAmount;

  const taxes: LineTaxResult["taxes"] = [];
  let priorTax = 0;
  for (const m of members) {
    const base = m.isCompound ? exclusiveBase + priorTax : exclusiveBase;
    const raw = base * (m.rate / 100);
    // line-level: round each tax now; document-level: keep unrounded and let
    // the caller round the per-code document sums once (see
    // allocateDocumentRounding).
    const amount = roundingLevel === "line" ? roundAmount(raw, roundingMethod) : raw;
    taxes.push({
      taxCodeId: m.taxCodeId,
      code: m.code,
      base: roundAmount(base, roundingMethod),
      amount,
      rate: m.rate,
      collectionMode: m.collectionMode,
    });
    priorTax += amount;
  }

  const roundedBase = roundAmount(exclusiveBase, roundingMethod);
  const taxTotal = taxes.reduce((s, t) => s + t.amount, 0);
  const lineTotal = roundAmount(roundedBase + taxTotal, roundingMethod);
  return { exclusiveBase: roundedBase, taxes, lineTotal };
}

/**
 * Document-level rounding reconciliation: given unrounded per-line tax
 * amounts for ONE tax code, round the document total once and push the
 * difference onto the largest line so the journal balances to the cent.
 * Returns the per-line rounded amounts (same order as input).
 */
export function allocateDocumentRounding(
  lineAmounts: number[],
  method: RoundingMethod
): { perLine: number[]; documentTotal: number } {
  if (lineAmounts.length === 0) return { perLine: [], documentTotal: 0 };
  const documentTotal = roundAmount(
    lineAmounts.reduce((s, a) => s + a, 0),
    method
  );
  const perLine = lineAmounts.map((a) => roundAmount(a, method));
  const drift = roundAmount(documentTotal - perLine.reduce((s, a) => s + a, 0), method);
  if (drift !== 0) {
    let largestIdx = 0;
    for (let i = 1; i < perLine.length; i++) {
      if (Math.abs(lineAmounts[i]) > Math.abs(lineAmounts[largestIdx])) largestIdx = i;
    }
    perLine[largestIdx] = roundAmount(perLine[largestIdx] + drift, method);
  }
  return { perLine, documentTotal };
}

/* ───────────────────────── WHT / AIT ───────────────────────── */

export interface WhtRuleInput {
  id: string;
  taxCodeId: string;
  paymentNature: string;
  payeeType: string;
  rate: number;
  thresholdAmount: number | null;
  thresholdPeriod: "per_payment" | "per_month" | "per_annum" | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  certificateRequired: boolean;
}

export interface WhtVendorInput {
  payeeType: string | null;
  defaultPaymentNature: string | null;
  whtExempt: boolean;
}

export interface WhtResult {
  whtAmount: number;
  netPayable: number;
  ruleId: string;
  taxCodeId: string;
  rate: number;
  /** The portion of this payment the WHT was computed on. */
  taxableAmount: number;
}

/**
 * Settlement-based WHT: computed on each PAYMENT amount, not the bill total.
 * per_month threshold semantics: WHT applies to the portion that, together
 * with monthToDatePaid, exceeds the threshold; once crossed in a month every
 * subsequent payment is withheld in full.
 */
export function calculateWht(
  grossAmount: number,
  vendor: WhtVendorInput,
  rules: WhtRuleInput[],
  documentDate: string,
  monthToDatePaid: number,
  paymentNature?: string
): WhtResult | null {
  if (vendor.whtExempt) return null;
  const nature = paymentNature || vendor.defaultPaymentNature;
  if (!nature || !vendor.payeeType) return null;

  const rule = rules
    .filter(
      (r) =>
        r.paymentNature === nature &&
        r.payeeType === vendor.payeeType &&
        r.effectiveFrom <= documentDate &&
        (r.effectiveTo === null || r.effectiveTo >= documentDate)
    )
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  if (!rule) return null;

  let taxable = grossAmount;
  if (rule.thresholdAmount !== null && rule.thresholdAmount > 0) {
    if (rule.thresholdPeriod === "per_payment") {
      if (grossAmount <= rule.thresholdAmount) return null;
      taxable = grossAmount; // payment exceeding the threshold is withheld in full
    } else {
      // per_month / per_annum: cumulative within the period
      const cumulativeBefore = monthToDatePaid;
      const cumulativeAfter = monthToDatePaid + grossAmount;
      if (cumulativeAfter <= rule.thresholdAmount) return null;
      taxable =
        cumulativeBefore >= rule.thresholdAmount
          ? grossAmount // threshold already crossed → withhold in full
          : cumulativeAfter - rule.thresholdAmount; // only the excess portion
    }
  }

  const whtAmount = roundAmount(taxable * (rule.rate / 100), "half_up");
  if (whtAmount <= 0) return null;
  return {
    whtAmount,
    netPayable: roundAmount(grossAmount - whtAmount, "half_up"),
    ruleId: rule.id,
    taxCodeId: rule.taxCodeId,
    rate: rule.rate,
    taxableAmount: roundAmount(taxable, "half_up"),
  };
}

/* ─────────────────────── Reverse charge ─────────────────────── */

/** Self-assessed VAT on imported services: equal output and input legs. */
export function calculateReverseCharge(
  lineAmount: number,
  rate: number
): { outputTax: number; inputTax: number } {
  const tax = roundAmount(lineAmount * (rate / 100), "half_up");
  return { outputTax: tax, inputTax: tax };
}

/* ───────────────────────── APIT (PAYE) ───────────────────────── */

export interface ApitBracket {
  bracketOrder: number;
  /** Annual taxable income ceiling for this bracket; null = top bracket. */
  annualAmountUpTo: number | null;
  rate: number;
}

export interface ApitSchedule {
  id: string;
  annualRelief: number;
  brackets: ApitBracket[];
}

/** Structurally compatible with payrollRuleEngine's CalculationTrace. */
export interface ApitTrace {
  rule_id: string | null;
  rule_version_id?: string | null;
  rule_name: string;
  formula_type: string;
  formula_applied: string;
  base_component: string | null;
  base_value: number;
  inputs: Record<string, number>;
  condition: unknown;
  condition_passed: boolean;
  result: number;
  evaluation_steps: string[];
  timestamp: string;
}

export interface ApitResult {
  monthlyApit: number;
  annualTax: number;
  annualTaxable: number;
  trace: ApitTrace;
}

// Progressive bracket tax on an annual taxable amount (relief already removed).
function bracketTaxOnAnnual(annualTaxable: number, brackets: ApitBracket[], steps?: string[]): number {
  const sorted = [...brackets].sort((a, b) => a.bracketOrder - b.bracketOrder);
  let tax = 0;
  let prevCeiling = 0;
  for (const b of sorted) {
    if (annualTaxable <= prevCeiling) break;
    const ceiling = b.annualAmountUpTo === null ? annualTaxable : Math.min(b.annualAmountUpTo, annualTaxable);
    const slice = ceiling - prevCeiling;
    if (slice <= 0) { prevCeiling = b.annualAmountUpTo ?? annualTaxable; continue; }
    const sliceTax = slice * (b.rate / 100);
    tax += sliceTax;
    steps?.push(
      `Bracket ${b.bracketOrder}: ${slice} @ ${b.rate}% = ${roundAmount(sliceTax, "half_up")}` +
        (b.annualAmountUpTo === null ? " (top bracket)" : ` (up to ${b.annualAmountUpTo})`)
    );
    prevCeiling = b.annualAmountUpTo ?? annualTaxable;
  }
  return tax;
}

/**
 * APIT (PAYE).
 *
 * Regular remuneration (IRD Table 1): annualize ×12, less relief, run the
 * brackets, ÷12.
 *
 * Lump-sum / irregular pay such as a bonus (IRD Table 2) must NOT be annualized
 * ×12 — that would tax it as if it recurred every month. Instead it is taxed
 * once, at the marginal rate: tax(annual regular + lump sum) − tax(annual
 * regular). Pass the irregular portion (already included in `monthlyGross`) as
 * `monthlyIrregular`; default 0 preserves the pure-regular case.
 */
/**
 * Year-to-date context for the cumulative (IRD) method. When supplied, PAYE is
 * the cumulative tax due to-date minus what was already deducted, which self-
 * corrects for variable monthly pay and bonuses. `monthIndex` is 1-based within
 * the tax year (April = 1 … March = 12).
 */
export interface ApitCumulative {
  priorGross: number;  // sum of gross for earlier periods this tax year
  priorPaye: number;   // PAYE already deducted in those periods
  monthIndex: number;  // 1..12 within the tax year (April = 1) — monthly schedules
  // Fraction of the tax year elapsed through this period (0–1). For non-monthly
  // schedules (weekly, etc.) pass this explicitly; otherwise monthIndex/12 is used.
  yearFraction?: number;
}

// Brackets scaled to a fraction of the year (cumulative method runs partial-year
// ceilings and relief, so a constant salary yields the same monthly tax as Table 1).
function scaleBrackets(brackets: ApitBracket[], scale: number): ApitBracket[] {
  return brackets.map((b) => ({
    ...b,
    annualAmountUpTo: b.annualAmountUpTo === null ? null : b.annualAmountUpTo * scale,
  }));
}

export function calculateApit(
  monthlyGross: number,
  schedule: ApitSchedule,
  monthlyIrregular = 0,
  cumulative?: ApitCumulative,
): ApitResult {
  const steps: string[] = [];

  // ── Cumulative (IRD) method ──────────────────────────────────────────────
  if (cumulative) {
    const m = Math.min(12, Math.max(1, Math.round(cumulative.monthIndex)));
    // Fraction of the tax year elapsed: explicit for non-monthly schedules, else m/12.
    const scale = Math.min(1, Math.max(0, cumulative.yearFraction ?? m / 12));
    const cumGross = Math.max(0, cumulative.priorGross) + monthlyGross;
    const cumRelief = schedule.annualRelief * scale;
    const cumTaxable = Math.max(0, cumGross - cumRelief);
    steps.push(`Cumulative gross (${Math.round(scale * 100)}% of year): ${cumulative.priorGross} + ${monthlyGross} = ${cumGross}`);
    steps.push(`Less pro-rated relief ${schedule.annualRelief} × ${roundAmount(scale, "half_up")} = ${roundAmount(cumRelief, "half_up")} → taxable ${roundAmount(cumTaxable, "half_up")}`);
    const cumTaxDue = bracketTaxOnAnnual(cumTaxable, scaleBrackets(schedule.brackets, scale), steps);
    const cumTaxDueR = roundAmount(cumTaxDue, "half_up", 0);
    const priorPayeR = roundAmount(Math.max(0, cumulative.priorPaye), "half_up", 0);
    const monthlyApit = Math.max(0, cumTaxDueR - priorPayeR);
    steps.push(`Cumulative tax due ${cumTaxDueR} − already deducted ${priorPayeR} = ${monthlyApit} this month`);
    return {
      monthlyApit,
      annualTax: cumTaxDueR,
      annualTaxable: cumTaxable,
      trace: {
        rule_id: null,
        rule_version_id: null,
        rule_name: "APIT (PAYE) cumulative schedule",
        formula_type: "CONDITIONAL",
        formula_applied: `Cumulative APIT to month ${m}: tax(${roundAmount(cumTaxable, "half_up")}) − deducted ${priorPayeR}`,
        base_component: "GROSS_PAY",
        base_value: monthlyGross,
        inputs: { GROSS_PAY: monthlyGross, CUM_GROSS: cumGross, MONTH_INDEX: m, ANNUAL_RELIEF: schedule.annualRelief, PRIOR_PAYE: priorPayeR },
        condition: { field: "is_paye_applicable", operator: "==", value: true },
        condition_passed: true,
        result: monthlyApit,
        evaluation_steps: steps,
        timestamp: new Date().toISOString(),
      },
    };
  }
  // ── Single-month method (no YTD context) ─────────────────────────────────
  const lumpSum = Math.max(0, monthlyIrregular);
  const regularMonthly = Math.max(0, monthlyGross - lumpSum);

  const annualRegular = regularMonthly * 12;
  const regularTaxable = Math.max(0, annualRegular - schedule.annualRelief);
  steps.push(`Regular: ${regularMonthly} × 12 = ${annualRegular}, less relief ${schedule.annualRelief} → taxable ${regularTaxable}`);
  const regularAnnualTax = bracketTaxOnAnnual(regularTaxable, schedule.brackets, steps);
  const monthlyRegularApit = roundAmount(regularAnnualTax / 12, "half_up", 0);
  steps.push(`Regular annual tax ${roundAmount(regularAnnualTax, "half_up")} ÷ 12 = ${monthlyRegularApit}/month`);

  // Lump-sum taxed once at the marginal rate stacked on the regular annual income.
  let lumpSumTax = 0;
  if (lumpSum > 0) {
    const combinedTaxable = Math.max(0, annualRegular + lumpSum - schedule.annualRelief);
    lumpSumTax = roundAmount(Math.max(0, bracketTaxOnAnnual(combinedTaxable, schedule.brackets) - regularAnnualTax), "half_up", 0);
    steps.push(`Lump sum ${lumpSum}: tax on (${annualRegular} + ${lumpSum}) less regular tax = ${lumpSumTax} (taxed once this month)`);
  }

  const monthlyApit = monthlyRegularApit + lumpSumTax;
  const annualTaxable = regularTaxable + (lumpSum > 0 ? lumpSum : 0);
  const annualTax = roundAmount(regularAnnualTax + lumpSumTax, "half_up");

  return {
    monthlyApit,
    annualTax,
    annualTaxable,
    trace: {
      rule_id: null,
      rule_version_id: null,
      rule_name: "APIT (PAYE) bracket schedule",
      formula_type: "CONDITIONAL",
      formula_applied: `APIT on regular ${regularMonthly}/mo (annualized) less relief ${schedule.annualRelief}` +
        (lumpSum > 0 ? `, plus lump-sum ${lumpSum} taxed once` : ``),
      base_component: "GROSS_PAY",
      base_value: monthlyGross,
      inputs: { GROSS_PAY: monthlyGross, LUMP_SUM: lumpSum, ANNUAL_RELIEF: schedule.annualRelief },
      condition: { field: "is_paye_applicable", operator: "==", value: true },
      condition_passed: true,
      result: monthlyApit,
      evaluation_steps: steps,
      timestamp: new Date().toISOString(),
    },
  };
}
