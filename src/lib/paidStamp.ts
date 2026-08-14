import type { jsPDF } from "jspdf";
import { RED, setDraw, setText, prettyDate } from "@/lib/pdfTheme";

/**
 * The PAID stamp an invoice carries once a settlement receipt has been issued
 * against it. Driven by the existence of an invoice_receipts row — never by the
 * balance alone — so the stamp always points at a real, numbered document the
 * customer can be shown.
 *
 * Struck in red directly beneath the Balance Due bar: the reader's eye lands on
 * the settled balance and finds the proof of settlement on the next line.
 *
 * Both invoice render paths stamp from this one definition: the vector PDF
 * (drawPaidStamp) and the template renderer (applyPaidStamp in renderInvoice).
 */
export interface PaidStamp {
  receiptNumber: string;
  /** ISO receipt date. */
  receiptDate: string;
}

/** Narrow an invoice_receipts row (or nothing) to a stamp. */
export function paidStampFromReceipt(
  receipt?: { receipt_number?: string | null; receipt_date?: string | null } | null,
): PaidStamp | null {
  if (!receipt?.receipt_number) return null;
  return { receiptNumber: receipt.receipt_number, receiptDate: receipt.receipt_date ?? "" };
}

/** Tilt in degrees, y-down. Negative reads as "stamped up to the right". */
export const STAMP_TILT = -14;

/** Unrotated frame size, in mm. Callers scale it to the column they land in. */
export const STAMP_W = 74;
export const STAMP_H = 30;

/** Stamp colour, as an `r,g,b` CSS triple for the DOM renderer. */
export const STAMP_CSS_COLOR = `rgb(${RED[0]}, ${RED[1]}, ${RED[2]})`;

/**
 * How much room the tilted stamp actually occupies, in mm. The frame is
 * rotated, so its footprint is wider and taller than STAMP_W × STAMP_H — the
 * caller needs this to reserve space rather than let the stamp collide with
 * whatever comes next.
 */
export function paidStampBounds(scale = 1) {
  const a = (Math.abs(STAMP_TILT) * Math.PI) / 180;
  const w = STAMP_W * scale;
  const h = STAMP_H * scale;
  return {
    w: w * Math.cos(a) + h * Math.sin(a),
    h: w * Math.sin(a) + h * Math.cos(a),
  };
}

/** The two lines printed under the word PAID. */
export function paidStampSublines(stamp: PaidStamp): string[] {
  return [
    `RECEIPT ${stamp.receiptNumber}`,
    stamp.receiptDate ? prettyDate(stamp.receiptDate) : "",
  ].filter(Boolean);
}

/** Outline of a rectangle rotated about its own centre, in PDF units. */
function rotatedRect(doc: jsPDF, cx: number, cy: number, w: number, h: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos] as const);
  const deltas: [number, number][] = [];
  for (let i = 1; i < corners.length; i++) {
    deltas.push([corners[i][0] - corners[i - 1][0], corners[i][1] - corners[i - 1][1]]);
  }
  deltas.push([corners[0][0] - corners[3][0], corners[0][1] - corners[3][1]]);
  doc.lines(deltas, corners[0][0], corners[0][1], [1, 1], "S", true);
}

/**
 * Draw the rubber stamp onto the CURRENT page of `doc`, centred on (cx, cy) in
 * mm. It lands in space the caller has reserved for it (see paidStampBounds),
 * so it prints solid — nothing underneath to keep readable.
 */
export function drawPaidStamp(doc: jsPDF, stamp: PaidStamp, cx: number, cy: number, scale = 1) {
  const w = STAMP_W * scale;
  const h = STAMP_H * scale;
  const textAngle = -STAMP_TILT; // jsPDF text rotates counter-clockwise

  setDraw(doc, RED);
  doc.setLineWidth(1.1 * scale);
  rotatedRect(doc, cx, cy, w, h, STAMP_TILT);
  doc.setLineWidth(0.35 * scale);
  rotatedRect(doc, cx, cy, w - 3.4 * scale, h - 3.4 * scale, STAMP_TILT);

  setText(doc, RED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24 * scale);
  // Lifted above centre so the receipt reference below stays inside the frame.
  const a = (STAMP_TILT * Math.PI) / 180;
  const offset = (dx: number, dy: number) =>
    [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)] as const;
  const [tx, ty] = offset(0, -3.2 * scale);
  doc.text("PAID", tx, ty, { align: "center", baseline: "middle", angle: textAngle, charSpace: 1.2 });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8 * scale);
  paidStampSublines(stamp).forEach((line, i) => {
    const [sx, sy] = offset(0, (6.2 + i * 4.2) * scale);
    doc.text(line, sx, sy, { align: "center", baseline: "middle", angle: textAngle, charSpace: 0.4 });
  });
}
