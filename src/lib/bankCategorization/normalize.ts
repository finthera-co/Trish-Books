/**
 * Text normalization for deterministic matching.
 *
 * normalizeText is the single normalization used everywhere: canonical map
 * keys, rule match values, and incoming cell text. It is idempotent —
 * normalizeText(normalizeText(x)) === normalizeText(x) — which is enforced by
 * a property test.
 */

export function normalizeText(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  let s = String(input);
  // Unicode compatibility normalization first (full-width chars, ligatures…).
  s = s.normalize("NFKC");
  s = s.toLowerCase();
  // Collapse all whitespace runs (incl. NBSP, tabs, newlines) to single spaces.
  s = s.replace(/\s+/g, " ").trim();
  // Strip trailing punctuation (.,;:!-) — common in hand-keyed sheets.
  s = s.replace(/[.,;:!\-]+$/g, "").trim();
  return s;
}

/**
 * Round to exactly 2 decimals — the ledger's stored scale.
 *
 * Applied at PARSE time so that the statement line and the journal line hold
 * byte-identical values. Without this, a 3-decimal cell would be stored raw on
 * the line, rounded on the journal, and the batch control totals would drift
 * apart by fractions of a cent per row. Uses an epsilon nudge so that values
 * like 1.005 (which is 1.00499999… in IEEE-754) round half-up as an accountant
 * expects rather than down.
 */
export function roundAmount(n: number): number {
  if (!Number.isFinite(n)) return n;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  return (sign * Math.round((abs + Number.EPSILON * abs) * 100)) / 100;
}

/** Parse an amount cell: numbers pass through; strings tolerate thousands
 * separators, currency prefixes, and accounting negatives "(1,234.50)".
 * Empty/null → 0. Anything else → NaN (the caller blocks the line). */
export function parseAmountCell(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return NaN;
  let s = String(value).trim();
  if (s === "" || s === "-") return 0;
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  // Strip currency markers and thousands separators.
  s = s.replace(/(lkr|rs\.?|\/=)/gi, "").replace(/[,\s]/g, "").trim();
  if (s === "") return 0;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}
