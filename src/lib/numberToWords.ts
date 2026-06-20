// Integer-to-words for payslip/document amounts (English, short-scale).
const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      parts.push(o ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(" ");
}

/** "12345" -> "Twelve Thousand Three Hundred Forty-Five". */
export function integerToWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const chunk = threeDigitsToWords(groups[i]);
    words.push(SCALES[i] ? `${chunk} ${SCALES[i]}` : chunk);
  }
  return words.join(" ");
}

/**
 * Amount in words for a currency document, e.g.
 * amountInWords(45200.5, "Rupees") -> "Forty-Five Thousand Two Hundred Rupees and 50/100".
 */
export function amountInWords(amount: number, unit = "Rupees"): string {
  const safe = Number(amount) || 0;
  const whole = Math.floor(Math.abs(safe));
  const cents = Math.round((Math.abs(safe) - whole) * 100);
  const sign = safe < 0 ? "Minus " : "";
  const centPart = cents > 0 ? ` and ${String(cents).padStart(2, "0")}/100` : " only";
  return `${sign}${integerToWords(whole)} ${unit}${centPart}`;
}
