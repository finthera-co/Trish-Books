import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency } from "@/lib/currency";
import { amountInWords } from "@/lib/numberToWords";
import { loadLogo, type LoadedLogo } from "@/lib/invoicePdf";
import type { ReceiptModel } from "@/components/receipts/ReceiptDocument";

const INK = [17, 24, 39] as const;
const MUTED = [107, 114, 128] as const;
const RULE = [229, 231, 235] as const;
const DARK = [31, 41, 55] as const; // neutral-800 header/amount box
const RED = [220, 38, 38] as const;
const GREEN = [22, 163, 74] as const;
const WHITE = [255, 255, 255] as const;

const methodLabel = (m?: string | null) =>
  m ? m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

/** Render a payment receipt to a jsPDF document (vector text, crisp + printable). */
export function buildReceiptPdf(model: ReceiptModel, company: any, logo?: LoadedLogo | null): jsPDF {
  const cur = model.currency || "LKR";
  const wordsUnit = cur === "LKR" ? "Rupees" : cur;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 16;
  const right = pageW - M;
  let y = M;

  // ── Header: logo + company (left), title + meta (right) ──
  let leftX = M;
  let logoBottom = y;
  if (logo) {
    // Fit inside 28×54mm preserving aspect ratio — the old code capped the
    // width alone, which squashed a wide logo into a smudge.
    const ratio = logo.w / logo.h || 1;
    let lh = 28;
    let lw = ratio * lh;
    if (lw > 54) { lw = 54; lh = lw / ratio; }
    try { doc.addImage(logo.dataUrl, "PNG", M, y, lw, lh); } catch { /* skip */ }
    leftX = M + lw + 4;
    logoBottom = y + lh;
  }
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(14);
  doc.text(company?.company_name || "Your Company", leftX, y + 5);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  let cy = y + 10;
  for (const line of [company?.address, company?.phone, company?.tax_id ? `TIN: ${company.tax_id}` : null]) {
    if (!line) continue;
    for (const l of String(line).split("\n")) { doc.text(l, leftX, cy); cy += 4; }
  }

  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...INK);
  doc.text("PAYMENT RECEIPT", right, y + 5, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED);
  doc.text(model.receiptNumber || "", right, y + 11, { align: "right" });
  doc.text(model.receiptDate || "", right, y + 16, { align: "right" });

  y = Math.max(cy, logoBottom + 2, y + 20) + 4;
  doc.setDrawColor(...RULE).setLineWidth(0.3).line(M, y, right, y);
  y += 8;

  // ── Received from (left) + amount box (right) ──
  const boxW = 62, boxH = 20, boxX = right - boxW;
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
  doc.text("RECEIVED FROM", M, y);
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK);
  doc.text(model.receivedFrom || "—", M, y + 6);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  let ry = y + 11;
  if (model.customerAddress) for (const l of String(model.customerAddress).split("\n")) { doc.text(l, M, ry); ry += 4; }

  doc.setFillColor(...DARK).roundedRect(boxX, y - 4, boxW, boxH, 2, 2, "F");
  doc.setTextColor(...WHITE).setFont("helvetica", "normal").setFontSize(8);
  doc.text("AMOUNT RECEIVED", boxX + boxW - 4, y + 2, { align: "right" });
  doc.setFont("helvetica", "bold").setFontSize(15);
  doc.text(formatCurrency(model.amount || 0, cur), boxX + boxW - 4, y + 11, { align: "right" });

  y = Math.max(ry, y + boxH) + 6;

  // ── Amount in words ──
  doc.setFillColor(249, 250, 251).setDrawColor(...RULE).roundedRect(M, y - 4, right - M, 9, 1, 1, "FD");
  doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(...INK);
  doc.text(`In words: ${amountInWords(model.amount || 0, wordsUnit)}`, M + 3, y + 1.5);
  y += 12;

  // ── Details table ──
  autoTable(doc, {
    startY: y,
    head: [["Invoice #", "Payment method", "Reference", "Amount"]],
    body: [[
      model.invoiceNumber || "—",
      methodLabel(model.paymentMethod),
      model.reference || "—",
      formatCurrency(model.amount || 0, cur),
    ]],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2.5, textColor: INK as any, lineColor: RULE as any },
    headStyles: { fillColor: DARK as any, textColor: WHITE as any, fontStyle: "bold" },
    columnStyles: { 3: { halign: "right" } },
    margin: { left: M, right: M },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Balance summary ──
  if (model.balanceDue != null) {
    const sx = right - 62;
    doc.setFontSize(9).setFont("helvetica", "normal").setTextColor(...MUTED);
    doc.text("Amount received", sx, y);
    doc.setTextColor(...INK).text(formatCurrency(model.amount || 0, cur), right, y, { align: "right" });
    y += 5;
    doc.setDrawColor(...RULE).line(sx, y, right, y);
    y += 5;
    doc.setFont("helvetica", "bold").setTextColor(...MUTED).text("Balance due", sx, y);
    const bc = model.balanceDue > 0 ? RED : GREEN;
    doc.setTextColor(bc[0], bc[1], bc[2]);
    doc.text(formatCurrency(model.balanceDue, cur), right, y, { align: "right" });
    y += 10;
  }

  // ── Notes ──
  if (model.notes) {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text("NOTES", M, y);
    doc.setFontSize(9).setTextColor(...INK);
    const lines = doc.splitTextToSize(model.notes, right - M);
    doc.text(lines, M, y + 5);
    y += 5 + lines.length * 4;
  }

  // ── Footer: thank-you + signature ──
  const fy = doc.internal.pageSize.getHeight() - 24;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  doc.text("Thank you for your payment.", M, fy);
  doc.setDrawColor(...RULE).line(right - 46, fy, right, fy);
  doc.setFontSize(8).text("Authorized signature", right - 23, fy + 4, { align: "center" });

  return doc;
}

export async function downloadReceiptPdf(model: ReceiptModel, company: any) {
  const logo = await loadLogo(company?.logo_url);
  const doc = buildReceiptPdf(model, company, logo);
  doc.save(`Receipt-${model.receiptNumber || "receipt"}.pdf`);
}

/** Open the generated PDF in a new tab with the print dialog primed. */
export async function printReceiptPdf(model: ReceiptModel, company: any) {
  const logo = await loadLogo(company?.logo_url);
  const doc = buildReceiptPdf(model, company, logo);
  doc.autoPrint();
  const url = doc.output("bloburl");
  window.open(url, "_blank");
}
