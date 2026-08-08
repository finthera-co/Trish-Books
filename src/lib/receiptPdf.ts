import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency } from "@/lib/currency";
import { amountInWords } from "@/lib/numberToWords";
import { loadLogo, type LoadedLogo } from "@/lib/invoicePdf";
import { registerPdfFonts, fontFamilyFor, NOTO_SANS, JETBRAINS_MONO } from "@/lib/pdfFonts";
import {
  NAVY, INK, MUTED, MUTED2, RULE, ALT_ROW, WHITE, GREEN,
  type RGB, setText, setDraw, setFill, num, prettyDate, fitText,
} from "@/lib/pdfTheme";
import { methodLabel, receiptStatusLabel, type ReceiptModel } from "@/components/receipts/ReceiptDocument";

/**
 * Payment receipt in the shared "Steel Statement" language — the same palette,
 * typography and figure formatting as the invoice and estimate PDFs, so the
 * three documents a customer receives read as one set.
 *
 * A receipt's job is narrower than an invoice's: it proves money arrived and
 * says what is left owing. So the received amount is the hero band, and the
 * settlement ladder (invoice total → received → balance) carries the detail
 * rather than repeating the same figure three times.
 */

/**
 * Status chip colour for the label the on-screen receipt already derives.
 * `balanceDue` is null when the receipt isn't tied to an invoice — there is
 * nothing to settle, so no chip is drawn.
 */
function receiptStatus(balanceDue?: number | null): { label: string; color: RGB } | null {
  const label = receiptStatusLabel(balanceDue);
  if (!label) return null;
  return { label, color: label === "PAID IN FULL" ? GREEN : NAVY };
}

/** Render a payment receipt to a jsPDF document (no save). */
export async function buildReceiptPdf(
  model: ReceiptModel,
  company: any,
  logo?: LoadedLogo | null,
): Promise<jsPDF> {
  const cur = model.currency || "LKR";
  const wordsUnit = cur === "LKR" ? "Rupees" : cur;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16; // page margin
  const right = pageW - M;
  const contentW = right - M;
  const fmt = (n: unknown) => formatCurrency(Number(n) || 0, cur);
  const c = company || {};

  // WinAnsi-encoded base-14 fonts cannot represent Sinhala or Tamil at all — a
  // customer name in either script drew blank before. Register the embedded
  // Unicode fonts, lazy-loading those scripts only when this receipt uses them.
  const documentText = [
    c.company_name, c.address, c.phone, c.tax_id,
    model.receivedFrom, model.customerAddress, model.notes, model.reference,
  ].filter(Boolean).join(" ");
  await registerPdfFonts(doc, documentText);
  // Sinhala/Tamil ship Regular only — bold requests on those scripts fall back
  // to Regular rather than drawing nothing.
  const useFont = (text: string, weight: "normal" | "bold" | "italic" = "normal") => {
    const family = fontFamilyFor(text);
    doc.setFont(family, family === NOTO_SANS ? weight : "normal");
  };
  const useMono = (weight: "normal" | "bold" = "normal") => doc.setFont(JETBRAINS_MONO, weight);

  doc.setProperties({
    title: model.receiptNumber ? `Receipt ${model.receiptNumber}` : "Payment Receipt",
    subject: `Payment receipt for ${model.receivedFrom || "customer"}`,
    author: c.company_name || "",
    creator: c.company_name || "Finthera",
  });

  // ── Top accent bar — the one full-bleed use of the accent colour ─────
  setFill(doc, NAVY);
  doc.rect(0, 0, pageW, 3, "F");

  // ── Header: logo + company (left) · doc type + number + status (right) ──
  const hy = 18;
  let logoBottom = hy;
  if (logo) {
    // Fit inside 28×60mm preserving aspect ratio — capping only the width
    // squashes wide logos into a smudge.
    const ratio = logo.w / logo.h || 1;
    let lh = 28;
    let lw = ratio * lh;
    if (lw > 60) { lw = 60; lh = lw / ratio; }
    try { doc.addImage(logo.dataUrl, "PNG", M, hy, lw, lh, "company-logo", "FAST"); } catch { /* skip */ }
    logoBottom = hy + lh;
  }
  // The company block sits BELOW the logo, never beside it: a long company name
  // next to a wide mark runs into the PAYMENT RECEIPT block on the right.
  const cx = M;
  let cy = logo ? logoBottom + 7 : hy + 5;
  if (c.company_name) {
    useFont(String(c.company_name), "bold");
    doc.setFontSize(14);
    setText(doc, INK);
    // Stacked under the logo the name owns the full column; with no logo it sits
    // level with the PAYMENT RECEIPT block, so it wraps instead of running under it.
    const nameLines = doc.splitTextToSize(String(c.company_name), logo ? contentW : contentW * 0.56);
    doc.text(nameLines, cx, cy);
    cy += nameLines.length * 5.8;
  }
  doc.setFontSize(8.5);
  setText(doc, MUTED);
  const contact: string[] = [];
  if (c.address) for (const l of String(c.address).split("\n")) contact.push(l);
  if (c.phone) contact.push(String(c.phone));
  if (c.tax_id) contact.push(`TIN: ${c.tax_id}`);
  contact.forEach((l) => { useFont(l, "normal"); doc.text(l, cx, cy); cy += 4.2; });

  useFont("PAYMENT RECEIPT", "bold");
  doc.setFontSize(16);
  setText(doc, NAVY);
  doc.text("PAYMENT RECEIPT", right, hy + 5, { align: "right", charSpace: 0.6 });
  useMono("bold");
  doc.setFontSize(12);
  setText(doc, INK);
  doc.text(String(model.receiptNumber || "—"), right, hy + 13, { align: "right" });

  const status = receiptStatus(model.balanceDue);
  let chipBottom = hy + 13;
  if (status) {
    useFont(status.label, "bold");
    doc.setFontSize(7.5);
    // getTextWidth ignores charSpace, so the tracking has to be added by hand —
    // without it a long label ("PART PAYMENT") prints past its own border.
    const track = 0.3;
    const trackW = status.label.length * track;
    const chipW = doc.getTextWidth(status.label) + trackW + 7;
    const chipY = hy + 16.5;
    setDraw(doc, status.color); doc.setLineWidth(0.4);
    doc.roundedRect(right - chipW, chipY, chipW, 6, 1.2, 1.2, "S");
    setText(doc, status.color);
    // Centring is measured on the untracked width, so nudge left by half the
    // tracking to keep the label optically centred in the chip.
    doc.text(status.label, right - chipW / 2 - trackW / 2, chipY + 4.1, { align: "center", charSpace: track });
    chipBottom = chipY + 6;
  }

  const headerBottom = Math.max(cy - 2, logoBottom, chipBottom);
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(M, headerBottom + 4, right, headerBottom + 4);

  // ── Received From (left) + receipt meta grid (right) ─────────────────
  let y = headerBottom + 15;

  const dLabelX = right - 70;
  const meta: [string, string][] = [["Receipt Date", prettyDate(model.receiptDate)]];
  if (model.paymentMethod) meta.push(["Payment Method", methodLabel(model.paymentMethod)]);
  if (model.reference) meta.push(["Reference", String(model.reference)]);
  if (model.invoiceNumber) meta.push(["Against Invoice", String(model.invoiceNumber)]);

  let my = y;
  meta.forEach(([label, value]) => {
    useFont(label, "normal");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text(label, dLabelX, my);
    // Values are short identifiers and dates — mono keeps the column aligned,
    // but a reference can carry any script, so it falls back to the text font.
    const family = fontFamilyFor(value);
    if (family === NOTO_SANS) useMono("bold");
    else { doc.setFont(family, "normal"); }
    setText(doc, INK);
    doc.text(value, right, my, { align: "right" });
    my += 6;
  });
  const metaBottom = my;

  const partyW = contentW * 0.5 - 8;
  useFont("RECEIVED FROM", "bold");
  doc.setFontSize(8.5);
  setText(doc, MUTED2);
  doc.text("RECEIVED FROM", M, y, { charSpace: 0.35 });
  const partyAddr = model.customerAddress ? doc.splitTextToSize(String(model.customerAddress), partyW) : [];
  const partyLines: { t: string; bold?: boolean }[] = [
    { t: model.receivedFrom || "—", bold: true },
    ...partyAddr.map((tt: string) => ({ t: tt })),
  ];
  let by = y + 7;
  partyLines.forEach((ln) => {
    useFont(ln.t, ln.bold ? "bold" : "normal");
    doc.setFontSize(ln.bold ? 12 : 9);
    setText(doc, ln.bold ? INK : MUTED);
    doc.text(ln.t, M, by);
    by += ln.bold ? 6 : 4.8;
  });

  y = Math.max(by, metaBottom) + 6;

  // ── The hero band: what this document exists to prove ────────────────
  // Full width rather than a corner chip — on a receipt the amount received is
  // the headline, not a subtotal in a ladder.
  const bandH = 20;
  setFill(doc, NAVY);
  doc.roundedRect(M, y, contentW, bandH, 2, 2, "F");
  useFont("AMOUNT RECEIVED", "bold");
  doc.setFontSize(9);
  setText(doc, WHITE);
  doc.text("AMOUNT RECEIVED", M + 6, y + 12, { charSpace: 0.5 });
  useMono("bold");
  doc.setFontSize(17);
  doc.text(fmt(model.amount), right - 6, y + 13, { align: "right" });
  y += bandH + 5;

  // Amount in words — the line that makes a receipt hard to alter.
  const words = `${amountInWords(model.amount || 0, wordsUnit)}`;
  useFont(words, "italic");
  doc.setFontSize(8.5);
  const wordsLines = doc.splitTextToSize(`In words: ${words}`, contentW - 8);
  const wordsH = wordsLines.length * 4.4 + 5;
  setFill(doc, ALT_ROW); setDraw(doc, RULE); doc.setLineWidth(0.2);
  doc.roundedRect(M, y, contentW, wordsH, 1.5, 1.5, "FD");
  setText(doc, INK);
  doc.text(wordsLines, M + 4, y + 5.8);
  y += wordsH + 9;

  // ── Payment detail table ─────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["AGAINST INVOICE", "PAYMENT METHOD", "REFERENCE", `AMOUNT (${cur})`]],
    body: [[
      model.invoiceNumber || "—",
      methodLabel(model.paymentMethod),
      model.reference || "—",
      num(model.amount),
    ]],
    styles: {
      font: NOTO_SANS, fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 3.5, right: 3.5 },
      textColor: [INK[0], INK[1], INK[2]], lineColor: [RULE[0], RULE[1], RULE[2]], lineWidth: 0, valign: "middle",
    },
    headStyles: {
      fillColor: [NAVY[0], NAVY[1], NAVY[2]], textColor: [WHITE[0], WHITE[1], WHITE[2]],
      fontStyle: "bold", fontSize: 8, halign: "left", cellPadding: { top: 4.5, bottom: 4.5, left: 3.5, right: 3.5 },
    },
    alternateRowStyles: { fillColor: [ALT_ROW[0], ALT_ROW[1], ALT_ROW[2]] },
    columnStyles: {
      0: { font: JETBRAINS_MONO },
      3: { halign: "right", cellWidth: 34, font: JETBRAINS_MONO, fontStyle: "bold" },
    },
    theme: "plain",
    didParseCell: (data: any) => {
      // Reference / method can carry Sinhala or Tamil; the figure columns can't.
      if (data.column.index === 0 || data.column.index === 3) return;
      const raw = String(data.cell.raw ?? "");
      const family = fontFamilyFor(raw);
      if (family !== NOTO_SANS) {
        data.cell.styles.font = family;
        data.cell.styles.fontStyle = "normal";
      }
    },
  });

  // ── Settlement ladder (right) ────────────────────────────────────────
  // Only meaningful when the receipt is tied to an invoice, so the customer can
  // see the whole position without pulling the invoice back out. The invoice
  // total is taken from the invoice itself — never derived as received +
  // balance, which double-counts whenever the balance already excludes this
  // payment (the usual case).
  let ty = (doc as any).lastAutoTable.finalY + 9;
  const laddered = model.balanceDue != null;
  if (laddered) {
    const balance = Number(model.balanceDue) || 0;
    const received = Number(model.amount) || 0;
    const invoiceTotal = model.invoiceTotal == null ? null : Number(model.invoiceTotal) || 0;
    const totalsW = 74;
    const labelX = right - totalsW;
    const totalsTop = ty;

    const totalRow = (label: string, value: string, opts: { color?: RGB; bold?: boolean } = {}) => {
      useFont(label, opts.bold ? "bold" : "normal");
      doc.setFontSize(9.5);
      setText(doc, opts.color ?? MUTED);
      doc.text(label, labelX, ty);
      useMono(opts.bold ? "bold" : "normal");
      setText(doc, opts.color ?? INK);
      doc.text(value, right, ty, { align: "right" });
      ty += 6.2;
    };

    if (invoiceTotal != null) {
      totalRow("Invoice Total", fmt(invoiceTotal));
      // Anything settled before this receipt (earlier payments, credit notes)
      // is stated outright — otherwise the ladder wouldn't add up on an invoice
      // that was already part-paid.
      const settledEarlier = Math.round((invoiceTotal - received - balance) * 100) / 100;
      if (settledEarlier > 0.005) totalRow("Previously Settled", `-${fmt(settledEarlier)}`, { color: GREEN });
    }
    totalRow("Amount Received", `-${fmt(received)}`, { color: GREEN });
    ty += 2;
    setDraw(doc, RULE); doc.setLineWidth(0.3);
    doc.line(labelX, ty - 4.5, right, ty - 4.5);

    // Vertical accent rule along the totals column — echoes the top bar.
    setDraw(doc, NAVY); doc.setLineWidth(0.7);
    doc.line(labelX - 5, totalsTop - 4, labelX - 5, ty - 3);

    // Balance chip — navy while something is owed, green once settled.
    const bH = 11;
    setFill(doc, balance > 0.005 ? NAVY : GREEN);
    doc.roundedRect(labelX - 1, ty, totalsW + 1, bH, 1.5, 1.5, "F");
    useFont("Balance Due", "bold");
    doc.setFontSize(9.5);
    setText(doc, WHITE);
    doc.text("Balance Due", labelX + 4, ty + 7);
    useMono("bold");
    doc.setFontSize(11);
    doc.text(fmt(balance), right - 4, ty + 7.2, { align: "right" });
    ty += bH + 4;
  }

  // ── Notes (left column, beside the ladder) ───────────────────────────
  let ny = (doc as any).lastAutoTable.finalY + 9;
  if (model.notes) {
    const notesW = laddered ? contentW - 74 - 12 : contentW;
    useFont("Notes", "bold");
    doc.setFontSize(8.5);
    setText(doc, MUTED2);
    doc.text("NOTES", M, ny, { charSpace: 0.25 });
    ny += 5;
    useFont(String(model.notes), "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    const wrapped = doc.splitTextToSize(String(model.notes), notesW);
    doc.text(wrapped, M, ny);
    ny += wrapped.length * 4.2 + 5;
  }

  // ── Signature block, anchored above the footer ───────────────────────
  // Kept on the page's own baseline rather than floating after the content, so
  // a short receipt doesn't leave it stranded mid-page.
  const sigY = Math.max(Math.max(ny, ty) + 18, pageH - 46);
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(right - 52, sigY, right, sigY);
  useFont("Authorized signature", "normal");
  doc.setFontSize(8);
  setText(doc, MUTED2);
  doc.text("Authorized signature", right - 26, sigY + 4.5, { align: "center" });

  // ── Footer on every page: rule + logo · company · thank-you · page ───
  const pageCount = doc.getNumberOfPages();
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    doc.setPage(pageNum);
    const fy = pageH - 14;
    setDraw(doc, RULE);
    doc.setLineWidth(0.2);
    doc.line(M, fy - 5, right, fy - 5);

    let fx = M;
    if (logo) {
      const ratio = logo.w / logo.h || 1;
      let lh = 6;
      let lw = lh * ratio;
      if (lw > 14) { lw = 14; lh = lw / ratio; }
      // Bottom-aligned with the company name so a taller mark doesn't ride up
      // through the footer rule.
      doc.addImage(logo.dataUrl, "PNG", fx, fy + 1 - lh, lw, lh, "company-logo", "FAST");
      fx += lw + 3;
    }
    // Measure the centred note first: it fixes how much room the company name
    // on the left actually has before the two would overprint each other.
    const footerNote = "Thank you for your payment";
    useFont(footerNote, "normal");
    doc.setFontSize(8.5);
    const leftRoom = pageW / 2 - doc.getTextWidth(footerNote) / 2 - fx - 4;

    useFont(c.company_name || "", "bold");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    doc.text(fitText(doc, c.company_name || "", leftRoom), fx, fy - 1);
    if (c.tax_id) {
      useFont(`TIN: ${c.tax_id}`, "normal");
      doc.setFontSize(7.5);
      setText(doc, MUTED2);
      doc.text(fitText(doc, `TIN: ${c.tax_id}`, leftRoom), fx, fy + 3);
    }

    useFont(footerNote, "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED2);
    doc.text(footerNote, pageW / 2, fy, { align: "center" });
    useMono("normal");
    doc.setFontSize(7.5);
    setText(doc, MUTED2);
    doc.text(`Page ${pageNum} of ${pageCount}`, right, fy, { align: "right" });
  }

  return doc;
}

export async function downloadReceiptPdf(model: ReceiptModel, company: any) {
  const logo = await loadLogo(company?.logo_url);
  const doc = await buildReceiptPdf(model, company, logo);
  doc.save(`Receipt-${model.receiptNumber || "receipt"}.pdf`);
}

/** Open the generated PDF in a new tab with the print dialog primed. */
export async function printReceiptPdf(model: ReceiptModel, company: any) {
  const logo = await loadLogo(company?.logo_url);
  const doc = await buildReceiptPdf(model, company, logo);
  doc.autoPrint();
  const url = doc.output("bloburl");
  window.open(url, "_blank");
}
