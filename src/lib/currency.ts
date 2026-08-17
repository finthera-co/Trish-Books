// Display prefixes per ISO currency. Symbols where widely recognised, otherwise
// the ISO code. Base/functional currency is LKR.
const CURRENCY_PREFIX: Record<string, string> = {
  LKR: "LKR",
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  AUD: "A$",
  SGD: "S$",
  JPY: "¥",
  AED: "AED",
};

/** Prefix used for a currency code (defaults to the code itself). */
export function currencyPrefix(currency = "LKR"): string {
  const c = (currency || "LKR").toUpperCase();
  return CURRENCY_PREFIX[c] || c;
}

/**
 * Format a number as currency. Defaults to LKR so existing call sites are
 * unchanged; pass a currency code (e.g. "USD") for foreign-currency documents.
 * JPY has no minor units.
 */
export function formatCurrency(amount: number, currency = "LKR"): string {
  const prefix = currencyPrefix(currency);
  const frac = (currency || "LKR").toUpperCase() === "JPY" ? 0 : 2;
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: frac, maximumFractionDigits: frac });
  return amount < 0 ? `(${prefix} ${formatted})` : `${prefix} ${formatted}`;
}

/**
 * Short format without decimals for KPI cards.
 *
 * Negatives keep the accounting parentheses used by `formatCurrency` — a loss
 * must never render with the same glyphs as a profit of the same magnitude.
 */
export function formatCurrencyShort(amount: number, currency = "LKR"): string {
  const prefix = currencyPrefix(currency);
  const formatted = Math.abs(amount).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return amount < 0 ? `(${prefix} ${formatted})` : `${prefix} ${formatted}`;
}

/**
 * Compact magnitude for chart axis ticks — "1.2M", "-450k". No currency prefix:
 * axis ticks are already scoped by the chart's own title and tooltip.
 */
export function formatCompactAmount(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export const CURRENCY_SYMBOL = "LKR";
