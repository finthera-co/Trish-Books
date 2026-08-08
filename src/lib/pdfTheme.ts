import type { jsPDF } from "jspdf";
import { formatInvoiceDate } from "@/lib/format";

/**
 * "Steel Statement" — the shared visual language of Finthera's vector
 * documents (invoices, estimates). Bank-statement precision: one deep navy
 * accent, tabular monospace figures, minimal colour everywhere else.
 *
 * Fixed RGB so output is independent of the app theme.
 */
export const NAVY = [11, 59, 96] as const;   // the one accent — top bar, table header, total chip
export const INK = [11, 27, 51] as const;    // near-navy body text
export const MUTED = [91, 107, 130] as const; // secondary text
export const MUTED2 = [139, 152, 171] as const; // eyebrow labels — lightest text on the page
export const RULE = [220, 227, 236] as const; // hairlines
export const ALT_ROW = [247, 249, 251] as const; // table zebra striping
export const WHITE = [255, 255, 255] as const;
export const GREEN = [21, 128, 61] as const; // paid / credited / accepted
export const RED = [185, 28, 28] as const;   // overdue / declined
export const AMBER = [180, 130, 20] as const; // partially paid / expiring

export type RGB = readonly [number, number, number];

export const setText = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
export const setDraw = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
export const setFill = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);

/** Plain grouped number (no currency prefix) — used where the label already names the currency. */
export const num = (n: unknown) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

/**
 * Trim `text` to fit `maxW`, adding an ellipsis when it has to cut. Call with
 * the intended font and size already set — jsPDF measures against current state.
 *
 * Footers put a company name, a centred note and a page number on one line, and
 * jsPDF happily draws text straight through whatever is next to it. A long name
 * has to be cut rather than allowed to overprint.
 */
export function fitText(d: jsPDF, text: string, maxW: number): string {
  const s = String(text ?? "");
  if (!s || maxW <= 0) return "";
  if (d.getTextWidth(s) <= maxW) return s;
  let cut = s;
  while (cut.length > 1 && d.getTextWidth(`${cut}…`) > maxW) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Filename-safe slug for a document number. */
export const sanitize = (s: string) => (s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");

export const prettyDate = (d?: string | null) => (d ? formatInvoiceDate(d) : "—");

export const prettyTerms = (t?: string | null) =>
  t ? t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "";

/**
 * Compose the product/description cell for a line-items table. Never falls
 * back to the line's GL account name — a chart-of-accounts label (e.g. "Sales
 * Revenue") is an internal posting detail and must not appear on a
 * customer-facing document, even for a manually-mapped line with no product.
 */
export function buildItemCell(it: any): string {
  const name = it.products?.name || "";
  const desc = it.description || "";
  if (name && desc && name !== desc) return `${name}\n${desc}`;
  return name || desc || "—";
}

/**
 * Per-line discount cell: the money figure, plus the percentage the user
 * actually entered when the discount was given as a %.
 */
export function discountCellText(it: any): string {
  const amt = Number(it.discount_amount) || 0;
  if (amt <= 0) return "—";
  const pct = Number(it.discount_percent) || 0;
  // discount_amount can also carry this line's share of an invoice-level
  // discount, in which case it no longer equals the line's own percentage —
  // printing the two together would state something untrue, so the percentage
  // is shown only while it still describes the figure beside it.
  const gross = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const matches = pct > 0 && Math.abs(gross * (pct / 100) - amt) < 0.005;
  return matches ? `-${num(amt)} (${pct}%)` : `-${num(amt)}`;
}
