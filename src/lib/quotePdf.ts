import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { registerPdfFonts, fontFamilyFor, NOTO_SANS, JETBRAINS_MONO } from "@/lib/pdfFonts";
import { loadLogo, type LoadedLogo } from "@/lib/invoicePdf";
import {
  NAVY, INK, MUTED, MUTED2, RULE, ALT_ROW, WHITE, GREEN, RED, AMBER,
  type RGB, setText, setDraw, setFill, num, sanitize, prettyDate, prettyTerms,
  buildItemCell, discountCellText, fitText,
} from "@/lib/pdfTheme";
import type { Database } from "@/integrations/supabase/types";

type CompanyProfileRow = Database["public"]["Tables"]["company_profiles"]["Row"];
type TenantRow = Pick<
  Database["public"]["Tables"]["tenants"]["Row"],
  "company_name" | "country" | "registration_number" | "logo_url" | "address" | "phone" | "tax_id"
>;

/**
 * Self-contained vector ESTIMATE PDF — the quote counterpart of invoicePdf.ts,
 * sharing its "Steel Statement" palette and typography so a customer receives
 * one visual identity across the estimate and the invoice it becomes.
 *
 * A quote has no GL impact and no settlement: there is no balance-due chip and
 * no payment details block. What replaces them is validity — the expiry date is
 * the figure that matters on an offer, so it gets the chip and the footnote.
 *
 * Vector text only (no html2canvas) — crisp, theme-independent, selectable.
 */

interface QuotePdfData {
  quote: any;
  customer: any;
  items: any[];
  tenant: TenantRow;
  profile: CompanyProfileRow | null;
}

/** Fetch everything the PDF needs for one quote. */
export async function loadQuotePdfData(quoteId: string, tenantId: string): Promise<QuotePdfData> {
  const [quoteRes, tenantRes, profileRes] = await Promise.all([
    (supabase as any)
      .from("quotes")
      .select("*, customers(*), quote_items(*, products(name))")
      .eq("id", quoteId)
      .single(),
    supabase
      .from("tenants")
      .select("company_name, country, registration_number, logo_url, address, phone, tax_id")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase
      .from("company_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  const { data: quote, error } = quoteRes;
  if (error || !quote) throw new Error(error?.message || "Quote not found");

  const items = [...(quote.quote_items || [])].sort(
    (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  return {
    quote,
    customer: quote.customers || {},
    items,
    tenant: tenantRes.data || ({} as TenantRow),
    profile: profileRes.data,
  };
}

/**
 * Status chip for an offer. 'sent' past its expiry reads as EXPIRED — the same
 * derivation the quotes list uses, so the PDF never contradicts the screen.
 */
function quoteStatus(quote: any): { label: string; color: RGB } {
  const today = new Date().toISOString().slice(0, 10);
  const expired = quote.expiry_date && quote.expiry_date < today;
  switch (quote.status) {
    case "accepted": return { label: "ACCEPTED", color: GREEN };
    case "converted": return { label: "CONVERTED", color: GREEN };
    case "declined": return { label: "DECLINED", color: RED };
    case "sent": return expired ? { label: "EXPIRED", color: AMBER } : { label: "SENT", color: NAVY };
    default: return expired ? { label: "EXPIRED", color: AMBER } : { label: "DRAFT", color: MUTED };
  }
}

/** Render a quote to a jsPDF document (no save). */
export async function buildQuotePdf(
  { quote, customer, items, tenant, profile }: QuotePdfData,
  logo?: LoadedLogo | null,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16; // page margin
  const right = pageW - M;
  const contentW = right - M;
  // Quotes are raised in the base currency; formatCurrency defaults to LKR.
  const currency = String(quote.currency || "LKR");
  const fmt = (n: unknown) => formatCurrency(Number(n) || 0, currency);

  const status = quoteStatus(quote);
  const t: any = tenant || {};
  const p = profile;
  const legalName = t.company_name || "";
  const tradingName = p?.trading_name || t.company_name;
  const termsText = quote.terms || p?.invoice_terms || null;

  // WinAnsi-encoded base-14 fonts can't render Sinhala/Tamil at all — register
  // the embedded Unicode fonts before any text draws, lazy-loading Sinhala /
  // Tamil only if this document's actual text needs them.
  const documentText = [
    tradingName, legalName, t.address, p?.address_line2, p?.city, p?.postal_code, t.country, t.phone, p?.email,
    customer?.legal_name, customer?.name, customer?.address, customer?.email, customer?.phone, customer?.mobile,
    ...items.map((it) => buildItemCell(it)),
    quote.notes, termsText, p?.invoice_footer_note,
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
    title: quote.quote_number ? `Estimate ${quote.quote_number}` : "Estimate",
    subject: `Estimate for ${customer?.legal_name || customer?.name || "customer"}`,
    author: legalName,
    creator: legalName || "Trish Books",
  });

  // ── Top accent bar — the one full-bleed use of the accent colour ─────
  setFill(doc, NAVY);
  doc.rect(0, 0, pageW, 3, "F");

  // ── Header: logo + company (left) · doc type + number (right) ────────
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
  // next to a wide mark runs into the ESTIMATE block on the right of the page.
  const cx = M;
  let cy = logo ? logoBottom + 7 : hy + 5;
  if (tradingName) {
    useFont(String(tradingName), "bold");
    doc.setFontSize(14);
    setText(doc, INK);
    // Stacked under the logo the name owns the full column; with no logo it sits
    // level with the ESTIMATE block, so it wraps instead of running under it.
    const nameLines = doc.splitTextToSize(String(tradingName), logo ? contentW : contentW * 0.56);
    doc.text(nameLines, cx, cy);
    cy += nameLines.length * 5.8;
  }
  if (p?.trading_name && t.company_name && p.trading_name !== t.company_name) {
    useFont(String(t.company_name), "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    doc.text(String(t.company_name), cx, cy);
    cy += 4.2;
  }
  doc.setFontSize(8.5);
  setText(doc, MUTED);
  const contact: string[] = [];
  const addressParts = [
    t.address,
    p?.address_line2,
    [p?.city, p?.postal_code].filter(Boolean).join(" ") || null,
    t.country,
  ].filter(Boolean) as string[];
  if (addressParts.length) {
    useFont(addressParts.join(", "), "normal");
    // Stacked under the logo the block owns the full column; unstacked it must
    // still clear the document title on the right.
    for (const l of doc.splitTextToSize(addressParts.join(", "), logo ? 120 : 90)) contact.push(l);
  }
  if (t.phone) contact.push(String(t.phone));
  if (p?.email) contact.push(String(p.email));
  if (t.registration_number) contact.push(`Reg. No. ${t.registration_number}`);
  if (p?.is_vat_registered && p?.vat_registration_no) contact.push(`VAT Reg. No.: ${p.vat_registration_no}`);
  else if (t.tax_id) contact.push(`TIN: ${t.tax_id}`);
  contact.forEach((l) => { useFont(l, "normal"); doc.text(l, cx, cy); cy += 4.2; });

  // Right: the document type, set large and baseline-aligned with the company
  // name opposite it — an offer leads with WHAT it is, where an invoice leads
  // with its number. Below it the quote number, then the status chip: an
  // offer's state (sent / accepted / expired) is worth stating outright.
  useFont("ESTIMATE", "bold");
  doc.setFontSize(20);
  setText(doc, NAVY);
  doc.text("ESTIMATE", right, hy + 5, { align: "right", charSpace: 0.8 });
  useMono("bold");
  doc.setFontSize(12);
  setText(doc, INK);
  doc.text(String(quote.quote_number || "—"), right, hy + 13, { align: "right" });

  useFont(status.label, "bold");
  doc.setFontSize(7.5);
  // getTextWidth ignores charSpace, so the tracking has to be added by hand —
  // without it a long label ("CONVERTED") prints past its own border. Centring
  // is measured on the untracked width, hence the half-tracking nudge left.
  const track = 0.3;
  const trackW = status.label.length * track;
  const chipW = doc.getTextWidth(status.label) + trackW + 7;
  const chipY = hy + 16.5;
  setDraw(doc, status.color); doc.setLineWidth(0.4);
  doc.roundedRect(right - chipW, chipY, chipW, 6, 1.2, 1.2, "S");
  setText(doc, status.color);
  doc.text(status.label, right - chipW / 2 - trackW / 2, chipY + 4.1, { align: "center", charSpace: track });

  const headerBottom = Math.max(cy - 2, logoBottom, chipY + 6);
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(M, headerBottom + 4, right, headerBottom + 4);

  // ── Prepared For (left) + estimate meta grid (right) ─────────────────
  let y = headerBottom + 15;

  const dLabelX = right - 70;
  const meta: [string, string][] = [["Estimate Date", prettyDate(quote.issue_date)]];
  const termsLabel = prettyTerms(quote.payment_terms);
  if (termsLabel) meta.push(["Payment Terms", termsLabel]);
  meta.push(["Valid Until", prettyDate(quote.expiry_date)]);

  let my = y;
  meta.forEach(([label, value]) => {
    useFont(label, "normal");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text(label, dLabelX, my);
    useMono("bold");
    setText(doc, INK);
    doc.text(value, right, my, { align: "right" });
    my += 6;
  });
  const metaBottom = my;

  // Left: Prepared For — an estimate is addressed to a prospect, not billed.
  const billW = contentW * 0.5 - 8;
  useFont("PREPARED FOR", "bold");
  doc.setFontSize(8.5);
  setText(doc, MUTED2);
  doc.text("PREPARED FOR", M, y, { charSpace: 0.35 });
  const partyAddr = customer?.address ? doc.splitTextToSize(String(customer.address), billW) : [];
  const customerTaxId = customer?.tin || customer?.vat_number;
  const billLines: { t: string; bold?: boolean }[] = [
    { t: customer?.legal_name || customer?.name || "—", bold: true },
    ...partyAddr.map((tt: string) => ({ t: tt })),
    ...[customer?.email, customer?.phone || customer?.mobile].filter(Boolean).map((tt: any) => ({ t: String(tt) })),
    ...(customerTaxId ? [{ t: `TIN: ${customerTaxId}` }] : []),
  ];
  let by = y + 7;
  billLines.forEach((ln) => {
    useFont(ln.t, ln.bold ? "bold" : "normal");
    doc.setFontSize(ln.bold ? 12 : 9);
    setText(doc, ln.bold ? INK : MUTED);
    doc.text(ln.t, M, by);
    by += ln.bold ? 6 : 4.8;
  });

  y = Math.max(by, metaBottom) + 8;

  // ── Line items table — navy header, tabular-mono figures ─────────────
  // The Discount column appears only when a line is actually discounted, and
  // carries the entered percentage beside the money figure.
  const hasLineDiscount = items.some((it) => Number(it.discount_amount) > 0);
  const head = hasLineDiscount
    ? ["ITEM & DESCRIPTION", "QTY", `RATE (${currency})`, `DISCOUNT (${currency})`, `AMOUNT (${currency})`]
    : ["ITEM & DESCRIPTION", "QTY", `RATE (${currency})`, `AMOUNT (${currency})`];
  const body = items.map((it) => {
    const row = [
      buildItemCell(it),
      Number(it.quantity) ? String(Number(it.quantity)) : "—",
      num(it.unit_price),
    ];
    if (hasLineDiscount) row.push(discountCellText(it));
    row.push(num(it.total));
    return row;
  });
  const amtCol = hasLineDiscount ? 4 : 3;
  const colStyles: any = {
    0: { cellWidth: "auto" },
    1: { halign: "center", cellWidth: 16, font: JETBRAINS_MONO },
    2: { halign: "right", cellWidth: 28, font: JETBRAINS_MONO },
    [amtCol]: { halign: "right", cellWidth: 32, font: JETBRAINS_MONO, fontStyle: "bold" },
  };
  // A cell carrying "(10%)" alongside the figure needs a few extra millimetres.
  const hasDiscountPct = items.some((it) => Number(it.discount_percent) > 0);
  if (hasLineDiscount) colStyles[3] = { halign: "right", cellWidth: hasDiscountPct ? 38 : 33, font: JETBRAINS_MONO };

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [head],
    body,
    styles: {
      font: NOTO_SANS, fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 3.5, right: 3.5 },
      textColor: [INK[0], INK[1], INK[2]], lineColor: [RULE[0], RULE[1], RULE[2]], lineWidth: 0, valign: "middle",
    },
    headStyles: {
      fillColor: [NAVY[0], NAVY[1], NAVY[2]], textColor: [WHITE[0], WHITE[1], WHITE[2]],
      fontStyle: "bold", fontSize: 8, halign: "left", cellPadding: { top: 4.5, bottom: 4.5, left: 3.5, right: 3.5 },
    },
    alternateRowStyles: { fillColor: [ALT_ROW[0], ALT_ROW[1], ALT_ROW[2]] },
    columnStyles: colStyles,
    theme: "plain",
    // Item & Description is the one column that can hold Sinhala/Tamil —
    // switch that cell's font family; those scripts ship Regular only, so a
    // bold cell falls back to Regular rather than drawing nothing.
    didParseCell: (data: any) => {
      if (data.column.index !== 0) return;
      const raw = Array.isArray(data.cell.raw) ? data.cell.raw.join(" ") : String(data.cell.raw ?? "");
      const family = fontFamilyFor(raw);
      if (family !== NOTO_SANS) {
        data.cell.styles.font = family;
        data.cell.styles.fontStyle = "normal";
      }
    },
  });

  // ── Totals block (right), navy rule + a filled Estimate Total chip ───
  let ty = (doc as any).lastAutoTable.finalY + 8;
  const totalsW = 74;
  const labelX = right - totalsW;
  const valX = right;
  const totalsTop = ty;

  const totalRow = (label: string, value: string, opts: { color?: RGB; bold?: boolean } = {}) => {
    useFont(label, opts.bold ? "bold" : "normal");
    doc.setFontSize(9.5);
    setText(doc, opts.color ?? MUTED);
    doc.text(label, labelX, ty);
    useMono(opts.bold ? "bold" : "normal");
    setText(doc, opts.color ?? INK);
    doc.text(value, valX, ty, { align: "right" });
    ty += 6.2;
  };

  // quote.subtotal is stored NET of line discounts. Present the breakdown so
  // Total = (gross subtotal) − discount + tax always reconciles on the page.
  const lineDiscount = Number(quote.discount_amount) || 0;
  const grossSubtotal = (Number(quote.subtotal) || 0) + lineDiscount;
  totalRow("Sub Total", fmt(grossSubtotal));
  if (lineDiscount > 0) {
    totalRow("Discount", `-${fmt(lineDiscount)}`);
    totalRow("Taxable amount", fmt(quote.subtotal));
  }
  if (Number(quote.tax_amount) > 0) totalRow("Tax", fmt(quote.tax_amount));
  ty += 2;
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(labelX, ty - 4.5, right, ty - 4.5);

  // Vertical accent rule along the totals column — echoes the top bar.
  setDraw(doc, NAVY); doc.setLineWidth(0.7);
  doc.line(labelX - 5, totalsTop - 4, labelX - 5, ty - 3);

  // Estimate Total — filled navy chip, the counterpart of the invoice's
  // Balance Due. Nothing is owed on an offer, so the figure is the quote.
  const bH = 11;
  setFill(doc, NAVY);
  doc.roundedRect(labelX - 1, ty, totalsW + 1, bH, 1.5, 1.5, "F");
  useFont("Estimate Total", "bold");
  doc.setFontSize(9.5);
  setText(doc, WHITE);
  doc.text("Estimate Total", labelX + 4, ty + 7);
  useMono("bold");
  doc.setFontSize(11);
  doc.text(fmt(quote.total_amount), valX - 4, ty + 7.2, { align: "right" });
  ty += bH + 4;

  // ── Notes / terms (left column) ──────────────────────────────────────
  // No bank details here: an estimate is not a request for payment.
  let ny = (doc as any).lastAutoTable.finalY + 9;
  const notesW = contentW - totalsW - 12;
  for (const [heading, text] of [
    ["Notes", quote.notes],
    ["Terms & Conditions", termsText],
  ] as [string, string | null][]) {
    if (!text) continue;
    useFont(heading, "bold");
    doc.setFontSize(8.5);
    setText(doc, MUTED2);
    doc.text(heading.toUpperCase(), M, ny, { charSpace: 0.25 });
    ny += 5;
    useFont(String(text), "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    const wrapped = doc.splitTextToSize(String(text), notesW);
    doc.text(wrapped, M, ny);
    ny += wrapped.length * 4.2 + 5;
  }

  // Validity note — set bold, since the deadline is the one condition attached
  // to the prices above it.
  const validity = quote.expiry_date
    ? `Prices are valid only if accepted on or before ${prettyDate(quote.expiry_date)}.`
    : "Prices are subject to change until accepted in writing.";
  const noteY = Math.max(ny, ty) + 2;
  useFont(validity, "bold");
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text(doc.splitTextToSize(validity, contentW), M, noteY);

  // ── Footer on every page: rule + logo · company · thank-you · page ───
  const pageCount = doc.getNumberOfPages();
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    doc.setPage(pageNum);
    const fy = pageH - 14; // lifted clear of the physical page edge / printer margin
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
    const footerNote = p?.invoice_footer_note || "Thank you for the opportunity to quote";
    useFont(footerNote, "normal");
    doc.setFontSize(8.5);
    const leftRoom = pageW / 2 - doc.getTextWidth(footerNote) / 2 - fx - 4;

    useFont(t.company_name || "", "bold");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    doc.text(fitText(doc, t.company_name || "", leftRoom), fx, fy - 1);
    const sub = [t.country, t.registration_number ? `BR No: ${t.registration_number}` : null]
      .filter(Boolean).join("  ·  ");
    if (sub) {
      useFont(sub, "normal");
      doc.setFontSize(7.5);
      setText(doc, MUTED2);
      doc.text(fitText(doc, sub, leftRoom), fx, fy + 3);
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

const quoteFileName = (quote: any, fallbackId: string) =>
  `Estimate-${sanitize(quote?.quote_number || fallbackId)}.pdf`;

/** Fetch, render, and trigger a browser download of the estimate PDF. */
export async function downloadQuotePdf(quoteId: string, tenantId: string): Promise<void> {
  const data = await loadQuotePdfData(quoteId, tenantId);
  const logo = await loadLogo(data.tenant?.logo_url);
  const doc = await buildQuotePdf(data, logo);
  doc.save(quoteFileName(data.quote, quoteId));
}

/** Fetch and render the estimate PDF, returning it as a named File for sharing/attaching. */
export async function getQuotePdfFile(quoteId: string, tenantId: string): Promise<File> {
  const data = await loadQuotePdfData(quoteId, tenantId);
  const logo = await loadLogo(data.tenant?.logo_url);
  const doc = await buildQuotePdf(data, logo);
  return new File([doc.output("blob")], quoteFileName(data.quote, quoteId), { type: "application/pdf" });
}
