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

/**
 * Split an invoice-level discount across the lines, pro-rata on each line's net
 * (gross less its own discount).
 *
 * A discount on the whole invoice still has to land on the lines: tax is charged
 * on the discounted value of the supply, and revenue posts per line account, so
 * a figure held only on the header would leave both wrong. Lines with nothing
 * left to discount take no share.
 *
 * The shares are rounded to cents and the rounding residual is given to the
 * largest line, so they always sum to exactly `total` — an invoice whose parts
 * don't add up to its own discount is worse than a cent in the wrong place.
 */
export function apportionDiscount(lineNets: number[], total: number): number[] {
  const nets = lineNets.map((n) => Math.max(0, Number(n) || 0));
  const sum = nets.reduce((s, n) => s + n, 0);
  const target = round2(Math.min(Math.max(0, Number(total) || 0), sum));
  if (sum <= 0 || target <= 0) return nets.map(() => 0);

  const shares = nets.map((n) => Math.min(n, round2((n / sum) * target)));
  const residual = round2(target - shares.reduce((s, v) => s + v, 0));
  if (residual !== 0) {
    // Give the leftover cent(s) to the line with the most room to absorb it.
    let best = 0;
    for (let i = 1; i < shares.length; i++) {
      if (nets[i] - shares[i] > nets[best] - shares[best]) best = i;
    }
    shares[best] = Math.min(nets[best], round2(shares[best] + residual));
  }
  return shares;
}
