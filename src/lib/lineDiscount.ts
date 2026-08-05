/**
 * Per-line discount helpers shared by invoices and quotes/estimates.
 *
 * A line discount can be entered either way round: as a percentage of the
 * line's gross (qty × rate) or as a flat money amount. Whichever the user
 * types, `discount_amount` is what gets stored and calculated on — the tax
 * engine and the server-side post-invoice recompute only ever see the amount.
 * `discount_percent` rides along so documents can print "10%" and so an edited
 * draft rehydrates with the figure the user actually entered.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Gross line value before any discount. */
export const lineGross = (qty: number, rate: number) => round2((Number(qty) || 0) * (Number(rate) || 0));

/**
 * Money value of a percentage discount, clamped to 0–100% and never more than
 * the line gross.
 */
export function discountFromPercent(qty: number, rate: number, percent: number): number {
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const gross = lineGross(qty, rate);
  if (gross <= 0 || pct === 0) return 0;
  return round2((gross * pct) / 100);
}

/**
 * Percentage a flat discount amount represents. Returns 0 for a zero-value
 * line (no meaningful percentage) so the field simply stays blank.
 */
export function percentFromDiscount(qty: number, rate: number, amount: number): number {
  const gross = lineGross(qty, rate);
  const amt = Math.max(0, Number(amount) || 0);
  if (gross <= 0 || amt === 0) return 0;
  return Math.min(100, Math.round((amt / gross) * 10000) / 100);
}
