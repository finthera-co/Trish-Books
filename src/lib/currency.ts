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
 */
export function formatCurrencyShort(amount: number, currency = "LKR"): string {
  return `${currencyPrefix(currency)} ${Math.abs(amount).toLocaleString()}`;
}

export const CURRENCY_SYMBOL = "LKR";
