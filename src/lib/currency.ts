/**
 * Format a number as LKR currency.
 */
export function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `(LKR ${formatted})` : `LKR ${formatted}`;
}

/**
 * Short format without decimals for KPI cards.
 */
export function formatCurrencyShort(amount: number): string {
  return `LKR ${Math.abs(amount).toLocaleString()}`;
}

export const CURRENCY_SYMBOL = "LKR";
