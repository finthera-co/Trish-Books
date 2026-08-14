import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { registerPdfFonts, fontFamilyFor, NOTO_SANS, JETBRAINS_MONO } from "@/lib/pdfFonts";
import {
  NAVY, INK, MUTED, MUTED2, RULE, ALT_ROW, WHITE, GREEN, RED, AMBER,
  type RGB, setText, setDraw, setFill, num, sanitize, prettyDate, prettyTerms,
  buildItemCell, discountCellText, fitText,
} from "@/lib/pdfTheme";
import { drawPaidStamp, paidStampBounds, paidStampFromReceipt, type PaidStamp } from "@/lib/paidStamp";
import type { Database } from "@/integrations/supabase/types";

type CompanyProfileRow = Database["public"]["Tables"]["company_profiles"]["Row"];
type TenantRow = Pick<
  Database["public"]["Tables"]["tenants"]["Row"],
  "company_name" | "country" | "registration_number" | "logo_url" | "address" | "phone" | "tax_id"
>;

/**
 * Self-contained vector invoice PDF. Unlike the invoice-designer download
 * (html2canvas of a saved template layout), this needs no template — it always
 * produces a clean, professional, selectable PDF straight from the invoice
 * record. Used directly from the invoice detail dialog and as the fallback in
 * invoiceDownload.ts when a tenant has not built a custom template.
 *
 * Vector text only (no html2canvas) — crisp, theme-independent output.
 */

// Palette and shared helpers live in pdfTheme.ts — the estimate PDF renders
// from the same "Steel Statement" language, so the two documents stay identical
// in colour, type and figure formatting.
const BLUE = NAVY; // reserved — see invoiceStatus()

interface InvoicePdfData {
  invoice: any;
  customer: any;
  items: any[];
  tenant: TenantRow;
  profile: CompanyProfileRow | null;
  /** Set once a settlement receipt has been issued — drives the PAID stamp. */
  paidStamp: PaidStamp | null;
}

export interface LoadedLogo {
  dataUrl: string;
  /** Natural pixel dimensions, used to preserve aspect ratio in the PDF. */
  w: number;
  h: number;
}

// A logo is placed at most ~60mm wide in the PDF (≈700px at print resolution).
// Uploads come in at up to 1024×1024 uncompressed, which embeds at several MB
// for a document meant to stay well under 500KB — downscale before embedding.
const MAX_LOGO_PX = 500;

/**
 * Load the company logo into a PNG data URL plus its natural dimensions.
 * Downscales to MAX_LOGO_PX on the long edge so the embedded image is sized
 * for how small it's actually placed. Returns null on any failure (missing,
 * CORS-tainted, decode error) so the invoice still renders without it.
 */
export async function loadLogo(url?: string | null): Promise<LoadedLogo | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_LOGO_PX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL("image/png"), w, h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * The settlement receipt issued against an invoice, if any.
 *
 * Read on its own rather than embedded in the invoice select: an embed on a
 * relation PostgREST hasn't cached yet fails the WHOLE query, which would take
 * every invoice download down if the app ships ahead of the migration. A
 * missing receipt and an unreachable table mean the same thing here — no stamp.
 */
export async function loadInvoiceReceipt(invoiceId: string) {
  const { data, error } = await supabase
    .from("invoice_receipts")
    .select("receipt_number, receipt_date")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  return error ? null : data;
}

/** Fetch everything the PDF needs for one invoice. */
export async function loadInvoicePdfData(invoiceId: string, tenantId: string): Promise<InvoicePdfData> {
  const [invoiceRes, tenantRes, profileRes, receipt] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, customers(*), invoice_items(*, products(name)), payments_received(amount), ar_credit_notes(amount, status)")
      .eq("id", invoiceId)
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
    loadInvoiceReceipt(invoiceId),
  ]);
  const { data: invoice, error } = invoiceRes;
  if (error || !invoice) throw new Error(error?.message || "Invoice not found");

  // Settle figures: payments + non-voided discount credit notes reduce the balance.
  const amountPaid = (invoice.payments_received || []).reduce(
    (s: number, p) => s + Number(p.amount || 0), 0);
  const discountTotal = (invoice.ar_credit_notes || [])
    .filter((c) => c.status !== "voided")
    .reduce((s: number, c) => s + Number(c.amount || 0), 0);
  const total = Number(invoice.total_amount || 0);
  const balanceDue = Math.max(0, total - amountPaid - discountTotal);

  return {
    invoice: { ...invoice, amount_paid: amountPaid, discount_total: discountTotal, balance_due: balanceDue },
    customer: invoice.customers || {},
    items: invoice.invoice_items || [],
    tenant: tenantRes.data || ({} as TenantRow),
    profile: profileRes.data,
    paidStamp: paidStampFromReceipt(receipt),
  };
}

/** Map a settlement state to a labelled, colour-coded status chip. */
function invoiceStatus(invoice: any): { label: string; color: RGB } {
  const total = Number(invoice.total_amount) || 0;
  const paid = Number(invoice.amount_paid) || 0;
  const balance = Number(invoice.balance_due ?? total - paid);
  if (invoice.status === "voided") return { label: "VOID", color: MUTED };
  if (total > 0 && balance <= 0.005) return { label: "PAID", color: GREEN };
  if (paid > 0 || Number(invoice.discount_total) > 0) return { label: "PARTIALLY PAID", color: AMBER };
  if (invoice.due_date && new Date(invoice.due_date) < new Date(new Date().toDateString()))
    return { label: "OVERDUE", color: RED };
  return { label: "DUE", color: BLUE };
}

/** Render an invoice to a jsPDF document (no save). */
export async function buildInvoicePdf({ invoice, customer, items, tenant, profile, paidStamp }: InvoicePdfData, logo?: LoadedLogo | null): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16; // page margin
  const right = pageW - M;
  const contentW = right - M;
  const currency = String(invoice.currency || "LKR");
  // Shadow the module-level LKR formatter with one bound to this invoice's currency.
  const fmt = (n: unknown) => formatCurrency(Number(n) || 0, currency);

  const status = invoiceStatus(invoice);
  const paid = Number(invoice.amount_paid) || 0;
  const disc = Number(invoice.discount_total) || 0;
  const balance = Number(invoice.balance_due ?? Number(invoice.total_amount) - paid - disc);
  const t: any = tenant || {};
  const p = profile;
  const legalName = t.company_name || "";
  const tradingName = p?.trading_name || t.company_name;
  // Remittance details for the payment panel at the foot of the invoice, in the
  // order a payer works through them: who to pay, into which account, at which
  // bank. Anything the tenant hasn't set in Settings is simply left out.
  const bankFields = ([
    ["Account Holder", p?.bank_account_name],
    ["Account No.", p?.bank_account_no],
    ["Bank", p?.bank_name],
    ["Branch", p?.bank_branch],
    ["SWIFT", p?.bank_swift],
  ] as [string, string | null | undefined][]).filter(([, v]) => !!String(v ?? "").trim()) as [string, string][];
  const bankDetails = bankFields.length ? bankFields.map(([k, v]) => `${k}: ${v}`).join("\n") : null;
  const termsText = invoice.terms || p?.invoice_terms || null;

  // WinAnsi-encoded base-14 fonts can't render Sinhala/Tamil at all (blank or
  // garbage glyphs) — register the embedded Unicode fonts before any text
  // draws, lazy-loading Sinhala/Tamil only if this document's actual text
  // (every dynamic/user-entered field) needs them.
  const documentText = [
    tradingName, legalName, t.address, p?.address_line2, p?.city, p?.postal_code, t.country, t.phone, p?.email,
    customer?.legal_name, customer?.name, customer?.address, customer?.email, customer?.phone, customer?.mobile,
    ...items.map((it) => buildItemCell(it)),
    invoice.notes, termsText, bankDetails, p?.invoice_footer_note,
  ].filter(Boolean).join(" ");
  await registerPdfFonts(doc, documentText);
  // Sinhala/Tamil ship Regular only — bold/italic requests on those scripts
  // fall back to Regular rather than drawing nothing.
  const useFont = (text: string, weight: "normal" | "bold" | "italic" = "normal") => {
    const family = fontFamilyFor(text);
    doc.setFont(family, family === NOTO_SANS ? weight : "normal");
  };
  // Tabular figures (dates, amounts, the invoice number) always render in
  // JetBrains Mono — the "bank statement" identity of this design. They're
  // always plain ASCII, so no script fallback is needed here.
  const useMono = (weight: "normal" | "bold" = "normal") => doc.setFont(JETBRAINS_MONO, weight);

  doc.setProperties({
    title: invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Invoice",
    subject: `Invoice for ${customer?.legal_name || customer?.name || "customer"}`,
    author: legalName,
    creator: legalName || "Trish Books",
  });
  const invTitle = Number(invoice.tax_amount) > 0 ? "TAX INVOICE" : "INVOICE";

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
  // next to a wide mark runs into the document block on the right of the page.
  // Stacked, the name gets the full column width whatever the logo's shape.
  const cx = M;
  let cy = logo ? logoBottom + 7 : hy + 5;
  // Trading name in the logo lockup; legal name underneath when it differs —
  // a tax invoice must still show the registered legal entity name.
  if (tradingName) {
    useFont(String(tradingName), "bold");
    doc.setFontSize(14);
    setText(doc, INK);
    // Stacked under the logo the name owns the full column; with no logo it sits
    // level with the document title, so it wraps instead of running under it.
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

  // Right: small tracked eyebrow + the invoice number in bold mono —
  // the number is the one thing a reader scans for first on a statement.
  useFont(invTitle, "bold");
  doc.setFontSize(10);
  setText(doc, NAVY);
  doc.text(invTitle, right, hy + 2, { align: "right", charSpace: 0.5 });
  useMono("bold");
  doc.setFontSize(15);
  setText(doc, INK);
  doc.text(String(invoice.invoice_number || "—"), right, hy + 9, { align: "right" });

  const headerBottom = Math.max(cy - 2, logoBottom, hy + 9);
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(M, headerBottom + 4, right, headerBottom + 4);

  // ── Billed To (left) + invoice meta grid (right) ──────────────────────
  let y = headerBottom + 15;

  // Right: label (muted sans) / value (bold mono) rows, right-aligned.
  const dLabelX = right - 70;
  const meta: [string, string][] = [["Invoice Date", prettyDate(invoice.issue_date)]];
  const termsLabel = prettyTerms(invoice.payment_terms);
  if (termsLabel) meta.push(["Terms", termsLabel]);
  meta.push(["Due Date", prettyDate(invoice.due_date)]);

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

  // Left: Billed To
  const billW = contentW * 0.5 - 8;
  useFont("BILLED TO", "bold");
  doc.setFontSize(8.5);
  setText(doc, MUTED2);
  doc.text("BILLED TO", M, y, { charSpace: 0.35 });
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
  // Show a per-line Discount column only when at least one line is discounted.
  // Currency lives in the column headers, not repeated in every cell — the
  // old per-cell "LKR 40,000.00" / "-LKR 5,000.00" wrapped onto two lines.
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
    // The cell carries the percentage the user entered beside the money
    // figure; a flat discount (no percentage) just prints the amount.
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
  // Discount is a reduction in the customer's favour, not an error — keep it
  // in the neutral body colour, not red. Red is reserved for Balance Due.
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
    // Item & Description is the one column that can hold Sinhala/Tamil
    // (product name / description) — switch that cell's font family; Sinhala
    // and Tamil only ship Regular, so a bold cell falls back to Regular
    // rather than drawing nothing.
    didParseCell: (data: any) => {
      if (data.column.index !== 0) return; // other columns are always plain ASCII figures
      const raw = Array.isArray(data.cell.raw) ? data.cell.raw.join(" ") : String(data.cell.raw ?? "");
      const family = fontFamilyFor(raw);
      if (family !== NOTO_SANS) {
        data.cell.styles.font = family;
        data.cell.styles.fontStyle = "normal";
      }
    },
  });

  // ── Totals block (right), navy rule + a filled Balance Due chip ──────
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

  // invoice.subtotal is stored NET of line discounts. Present the breakdown so
  // Total = (gross subtotal) − discount + tax always reconciles on the page.
  // discount_amount is every discount on the invoice; document_discount is the
  // part given on the total rather than line by line. Both are already inside
  // the lines (apportioned at save time), so they are only ever presented here —
  // never subtracted again.
  const totalDiscount = Number(invoice.discount_amount) || 0;
  const docDiscount = Math.min(Number(invoice.document_discount) || 0, totalDiscount);
  const lineDiscount = Math.round((totalDiscount - docDiscount) * 100) / 100;
  const grossSubtotal = (Number(invoice.subtotal) || 0) + totalDiscount;
  totalRow("Sub Total", fmt(grossSubtotal));
  if (lineDiscount > 0) totalRow("Discount", `-${fmt(lineDiscount)}`);
  if (docDiscount > 0) {
    const pct = Number(invoice.document_discount_percent) || 0;
    totalRow(pct > 0 ? `Discount on Total (${pct}%)` : "Discount on Total", `-${fmt(docDiscount)}`);
  }
  if (totalDiscount > 0) totalRow("Taxable amount", fmt(invoice.subtotal));
  if (Number(invoice.tax_amount) > 0) totalRow("Tax", fmt(invoice.tax_amount));
  ty += 2;
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(labelX, ty - 4.5, right, ty - 4.5);
  totalRow("Total", `${fmt(invoice.total_amount)}`, { bold: true, color: INK });
  if (paid > 0) totalRow("Amount Paid", `-${fmt(paid)}`, { color: GREEN });
  if (disc > 0) totalRow("Credit Notes / Discounts", `-${fmt(disc)}`, { color: GREEN });

  // Vertical accent rule along the totals column — echoes the top bar.
  setDraw(doc, NAVY); doc.setLineWidth(0.7);
  doc.line(labelX - 5, totalsTop - 4, labelX - 5, ty + 1);

  // Balance Due — filled chip (navy; a muted green once settled in full)
  ty += 1;
  const bH = 11;
  setFill(doc, balance > 0.005 ? NAVY : GREEN);
  doc.roundedRect(labelX - 1, ty, totalsW + 1, bH, 1.5, 1.5, "F");
  useFont("Balance Due", "bold");
  doc.setFontSize(9.5);
  setText(doc, WHITE);
  doc.text("Balance Due", labelX + 4, ty + 7);
  useMono("bold");
  doc.setFontSize(11);
  doc.text(fmt(balance), valX - 4, ty + 7.2, { align: "right" });
  ty += bH + 4;

  // ── PAID stamp, struck under the Balance Due bar ─────────────────────
  // Sized to the totals column and drawn inline, so `ty` carries its footprint
  // forward and the payment panel below settles beneath it instead of into it.
  if (paidStamp) {
    const stampScale = 0.76;
    const bounds = paidStampBounds(stampScale);
    drawPaidStamp(doc, paidStamp, labelX + totalsW / 2, ty + bounds.h / 2, stampScale);
    ty += bounds.h + 4;
  }

  // ── Notes / terms / payment details (left column) ────────────────────
  // Fills the space left blank under the totals block and gives the customer
  // what they need to actually pay: bank name, branch, account, SWIFT.
  let ny = (doc as any).lastAutoTable.finalY + 9;
  const notesW = contentW - totalsW - 12;
  for (const [heading, text] of [
    ["Notes", invoice.notes],
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

  // ── Payment details — pinned to the foot of the invoice ──────────────
  // Where a payer looks for it, and the last thing read before the total is
  // acted on. Laid out as labelled columns rather than a stacked list so the
  // account number is scannable; only the fields the tenant has filled in
  // appear. Set them in Settings → Company Profile → Bank Details.
  if (bankFields.length > 0) {
    const padX = 5;
    const colGap = 4;
    const colW = (contentW - padX * 2 - colGap * (bankFields.length - 1)) / bankFields.length;
    // Wrap each value to its column first — the panel is as tall as its
    // deepest cell, so a long account name can't spill outside the border.
    const cells = bankFields.map(([label, value]) => {
      useFont(String(value), "bold");
      doc.setFontSize(9);
      return { label, lines: doc.splitTextToSize(String(value), colW) as string[] };
    });
    const deepest = Math.max(...cells.map((c) => c.lines.length));
    const panelH = 9 + 4 + deepest * 4.6 + 5;

    // Keep it at the bottom, but never let it ride over the footer or collide
    // with the notes above — a content-heavy invoice pushes it to a new page.
    const footTop = pageH - 24;
    let panelY = Math.max(Math.max(ny, ty) + 6, footTop - panelH);
    if (panelY + panelH > footTop) {
      doc.addPage();
      panelY = M + 6;
    }

    setFill(doc, ALT_ROW); setDraw(doc, RULE); doc.setLineWidth(0.2);
    doc.roundedRect(M, panelY, contentW, panelH, 1.5, 1.5, "FD");
    // Navy edge — the same accent that opens the page closes it.
    setFill(doc, NAVY);
    doc.rect(M, panelY + 1, 1.2, panelH - 2, "F");

    useFont("PAYMENT DETAILS", "bold");
    doc.setFontSize(8);
    setText(doc, NAVY);
    doc.text("PAYMENT DETAILS", M + padX, panelY + 6.5, { charSpace: 0.4 });

    let bx = M + padX;
    cells.forEach((cell, i) => {
      useFont(cell.label, "normal");
      doc.setFontSize(7);
      setText(doc, MUTED2);
      doc.text(cell.label.toUpperCase(), bx, panelY + 13, { charSpace: 0.2 });
      // The account number is a figure to transcribe — mono, like every other
      // number on the document.
      if (cell.label === "Account No.") useMono("bold");
      else useFont(cell.lines.join(" "), "bold");
      doc.setFontSize(9);
      setText(doc, INK);
      doc.text(cell.lines, bx, panelY + 18);
      bx += colW + colGap;
      if (i < cells.length - 1) {
        setDraw(doc, RULE); doc.setLineWidth(0.2);
        doc.line(bx - colGap / 2, panelY + 9.5, bx - colGap / 2, panelY + panelH - 3);
      }
    });
  }

  // ── Footer on every page: rule + logo · company · thank-you · page ───
  const pageCount = doc.getNumberOfPages();
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    doc.setPage(pageNum);
    const fy = pageH - 14; // lifted clear of the physical page edge / printer margin
    setDraw(doc, RULE);
    doc.setLineWidth(0.2);
    doc.line(M, fy - 5, right, fy - 5);

    // Left: small logo (if any) + company name / BR
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
    const footerNote = p?.invoice_footer_note || "Thank you for your business";
    useFont(footerNote, "normal");
    doc.setFontSize(8.5);
    const leftRoom = pageW / 2 - doc.getTextWidth(footerNote) / 2 - fx - 4;

    useFont(tenant?.company_name || "", "bold");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    doc.text(fitText(doc, tenant?.company_name || "", leftRoom), fx, fy - 1);
    const sub = [tenant?.country, tenant?.registration_number ? `BR No: ${tenant.registration_number}` : null]
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

/** Fetch, render, and trigger a browser download of the invoice PDF. */
export async function downloadInvoiceVectorPdf(invoiceId: string, tenantId: string): Promise<void> {
  const data = await loadInvoicePdfData(invoiceId, tenantId);
  const logo = await loadLogo(data.tenant?.logo_url);
  const doc = await buildInvoicePdf(data, logo);
  doc.save(`Invoice-${sanitize(data.invoice.invoice_number || invoiceId)}.pdf`);
}

/** Fetch and render the invoice PDF, returning it as a named File for sharing/attaching. */
export async function getInvoiceVectorPdfFile(invoiceId: string, tenantId: string): Promise<File> {
  const data = await loadInvoicePdfData(invoiceId, tenantId);
  const logo = await loadLogo(data.tenant?.logo_url);
  const doc = await buildInvoicePdf(data, logo);
  const blob = doc.output("blob");
  return new File([blob], `Invoice-${sanitize(data.invoice.invoice_number || invoiceId)}.pdf`, {
    type: "application/pdf",
  });
}
