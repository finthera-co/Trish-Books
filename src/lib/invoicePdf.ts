import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { formatInvoiceDate } from "@/lib/format";
import { registerPdfFonts, fontFamilyFor, NOTO_SANS } from "@/lib/pdfFonts";
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

// Fixed RGB palette so output is independent of the app theme.
const INK = [17, 24, 39] as const; // gray-900
const MUTED = [107, 114, 128] as const; // gray-500
const RULE = [229, 231, 235] as const; // gray-200
const GREEN = [22, 163, 74] as const; // primary accent
const RED = [220, 38, 38] as const; // balance due
const AMBER = [217, 119, 6] as const; // amber-600 — partial
const BLUE = [37, 99, 235] as const; // blue-600 — due
const WHITE = [255, 255, 255] as const;
// Modern light theme accents
const HEADING = [23, 37, 84] as const; // blue-950 — titles & section labels
const CARD = [237, 240, 251] as const; // soft lavender — summary card / accents
const ACCENT = [47, 102, 235] as const; // blue — the single pop colour (amount due)
const TBL_HEAD_BG = [245, 247, 251] as const; // table header fill

type RGB = readonly [number, number, number];
const setText = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
const setDraw = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
const setFill = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);

const fmt = (n: unknown) => formatCurrency(Number(n) || 0);
/** Plain grouped number (no currency prefix) — used where the label already names the currency. */
const num = (n: unknown) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};
const sanitize = (s: string) => (s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
const prettyDate = (d?: string | null) => (d ? formatInvoiceDate(d) : "—");
const prettyTerms = (t?: string | null) =>
  t ? t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "";

interface InvoicePdfData {
  invoice: any;
  customer: any;
  items: any[];
  tenant: TenantRow;
  profile: CompanyProfileRow | null;
}

export interface LoadedLogo {
  dataUrl: string;
  /** Natural pixel dimensions, used to preserve aspect ratio in the PDF. */
  w: number;
  h: number;
}

// A logo is placed at most ~40mm wide in the PDF (≈450px at print resolution).
// Uploads come in at up to 1024×1024 uncompressed, which embeds at several MB
// for a document meant to stay well under 500KB — downscale before embedding.
const MAX_LOGO_PX = 320;

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

/** Fetch everything the PDF needs for one invoice. */
export async function loadInvoicePdfData(invoiceId: string, tenantId: string): Promise<InvoicePdfData> {
  const [invoiceRes, tenantRes, profileRes] = await Promise.all([
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
export async function buildInvoicePdf({ invoice, customer, items, tenant, profile }: InvoicePdfData, logo?: LoadedLogo | null): Promise<jsPDF> {
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
  const bankLines = [
    p?.bank_name,
    p?.bank_branch ? `Branch: ${p.bank_branch}` : null,
    p?.bank_account_name ? `Account Name: ${p.bank_account_name}` : null,
    p?.bank_account_no ? `Account No.: ${p.bank_account_no}` : null,
    p?.bank_swift ? `SWIFT: ${p.bank_swift}` : null,
  ].filter(Boolean);
  const bankDetails = bankLines.length ? bankLines.join("\n") : null;
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

  doc.setProperties({
    title: invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Invoice",
    subject: `Invoice for ${customer?.legal_name || customer?.name || "customer"}`,
    author: legalName,
    creator: legalName || "Finthera",
  });
  const SLATE: RGB = [45, 55, 72]; // dark table header, Zoho-style
  const SHADE: RGB = [243, 244, 246]; // light row highlight
  const invTitle = Number(invoice.tax_amount) > 0 ? "TAX INVOICE" : "INVOICE";

  // ── Header: logo + company (left) · title (right) ────────────────────
  const hy = 16;
  let cx = M;
  let logoBottom = hy;
  if (logo) {
    // Fit inside 16×40mm preserving aspect ratio — capping only the width
    // squashes wide logos into a smudge.
    const ratio = logo.w / logo.h || 1;
    let lh = 16;
    let lw = ratio * lh;
    if (lw > 40) { lw = 40; lh = lw / ratio; }
    try { doc.addImage(logo.dataUrl, "PNG", M, hy, lw, lh, "company-logo", "FAST"); } catch { /* skip */ }
    cx = M + lw + 5;
    logoBottom = hy + lh;
  }
  let cy = hy + 5;
  // Trading name in the logo lockup; legal name underneath when it differs —
  // a tax invoice must still show the registered legal entity name.
  if (tradingName) {
    useFont(String(tradingName), "bold");
    doc.setFontSize(13);
    setText(doc, INK);
    doc.text(String(tradingName), cx, cy);
    cy += 5.5;
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
    for (const l of doc.splitTextToSize(addressParts.join(", "), 90)) contact.push(l);
  }
  if (t.phone) contact.push(String(t.phone));
  if (p?.email) contact.push(String(p.email));
  if (t.registration_number) contact.push(`Reg. No. ${t.registration_number}`);
  if (p?.is_vat_registered && p?.vat_registration_no) contact.push(`VAT Reg. No.: ${p.vat_registration_no}`);
  else if (t.tax_id) contact.push(`TIN: ${t.tax_id}`);
  contact.forEach((l) => { useFont(l, "normal"); doc.text(l, cx, cy); cy += 4.2; });

  // Right: big INVOICE / TAX INVOICE title
  useFont(invTitle, "bold");
  doc.setFontSize(22);
  setText(doc, [90, 96, 104]);
  doc.text(invTitle, right, hy + 6, { align: "right" });

  const headerBottom = Math.max(cy - 2, logoBottom);
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(M, headerBottom + 3, right, headerBottom + 3);

  // ── Details block (right) + Bill To (left) ───────────────────────────
  let y = headerBottom + 12;

  // Right: invoice meta as label (left) / value (right) rows.
  const dLabelX = right - 74;
  const meta: [string, string][] = [
    ["Invoice#", String(invoice.invoice_number || "—")],
    ["Invoice Date", prettyDate(invoice.issue_date)],
  ];
  const termsLabel = prettyTerms(invoice.payment_terms);
  if (termsLabel) meta.push(["Terms", termsLabel]);
  meta.push(["Due Date", prettyDate(invoice.due_date)]);

  let my = y;
  meta.forEach(([label, value]) => {
    useFont(label, "normal");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text(label, dLabelX, my);
    useFont(value, "bold");
    setText(doc, INK);
    doc.text(value, right, my, { align: "right" });
    my += 5.6;
  });
  // Balance-due highlight box (Zoho puts this prominently near the top).
  my += 1.5;
  const bdH = 9;
  setFill(doc, SHADE);
  doc.roundedRect(dLabelX - 3, my - 1, right - (dLabelX - 3), bdH, 1.5, 1.5, "F");
  useFont(`Balance Due (${currency})`, "bold");
  doc.setFontSize(9.5);
  setText(doc, INK);
  doc.text(`Balance Due (${currency})`, dLabelX, my + 5);
  setText(doc, balance > 0.005 ? RED : GREEN);
  doc.text(num(balance), right - 3, my + 5, { align: "right" });
  const metaBottom = my + bdH;

  // Left: Bill To
  const billW = contentW * 0.5 - 8;
  useFont("BILL TO", "bold");
  doc.setFontSize(8);
  setText(doc, SLATE);
  doc.text("BILL TO", M, y);
  const partyAddr = customer?.address ? doc.splitTextToSize(String(customer.address), billW) : [];
  const customerTaxId = customer?.tin || customer?.vat_number;
  const billLines: { t: string; bold?: boolean }[] = [
    { t: customer?.legal_name || customer?.name || "—", bold: true },
    ...partyAddr.map((tt: string) => ({ t: tt })),
    ...[customer?.email, customer?.phone || customer?.mobile].filter(Boolean).map((tt: any) => ({ t: String(tt) })),
    ...(customerTaxId ? [{ t: `TIN: ${customerTaxId}` }] : []),
  ];
  let by = y + 6.5;
  billLines.forEach((ln) => {
    useFont(ln.t, ln.bold ? "bold" : "normal");
    doc.setFontSize(ln.bold ? 11 : 9);
    setText(doc, ln.bold ? INK : MUTED);
    doc.text(ln.t, M, by);
    by += ln.bold ? 5.8 : 4.6;
  });

  y = Math.max(by, metaBottom) + 8;

  // ── Line items table — dark header, Zoho-style ───────────────────────
  // Show a per-line Discount column only when at least one line is discounted.
  // Currency lives in the column headers, not repeated in every cell — the
  // old per-cell "LKR 40,000.00" / "-LKR 5,000.00" wrapped onto two lines.
  const hasLineDiscount = items.some((it) => Number(it.discount_amount) > 0);
  const head = hasLineDiscount
    ? ["#", "Item & Description", "Qty", `Rate (${currency})`, `Discount (${currency})`, `Amount (${currency})`]
    : ["#", "Item & Description", "Qty", `Rate (${currency})`, `Amount (${currency})`];
  const body = items.map((it, i) => {
    const row = [
      String(i + 1),
      buildItemCell(it),
      Number(it.quantity) ? String(Number(it.quantity)) : "—",
      num(it.unit_price),
    ];
    if (hasLineDiscount) row.push(Number(it.discount_amount) > 0 ? `-${num(it.discount_amount)}` : "—");
    row.push(num(it.total));
    return row;
  });
  const amtCol = hasLineDiscount ? 5 : 4;
  const colStyles: any = {
    0: { halign: "center", cellWidth: 10, textColor: [MUTED[0], MUTED[1], MUTED[2]] },
    1: { cellWidth: "auto" },
    2: { halign: "center", cellWidth: 16 },
    3: { halign: "right", cellWidth: 26 },
    [amtCol]: { halign: "right", cellWidth: 30, fontStyle: "bold" },
  };
  // Discount is a reduction in the customer's favour, not an error — keep it
  // in the neutral body colour. Red is reserved for Balance Due.
  if (hasLineDiscount) colStyles[4] = { halign: "right", cellWidth: 26 };

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [head],
    body,
    styles: {
      font: NOTO_SANS, fontSize: 9, cellPadding: { top: 3.5, bottom: 3.5, left: 3.5, right: 3.5 },
      textColor: [INK[0], INK[1], INK[2]], lineColor: [RULE[0], RULE[1], RULE[2]], lineWidth: 0, valign: "middle",
    },
    headStyles: {
      fillColor: [SLATE[0], SLATE[1], SLATE[2]], textColor: [WHITE[0], WHITE[1], WHITE[2]],
      fontStyle: "bold", fontSize: 8.5, halign: "left", cellPadding: { top: 4, bottom: 4, left: 3.5, right: 3.5 },
    },
    alternateRowStyles: { fillColor: [250, 250, 251] },
    columnStyles: colStyles,
    theme: "plain",
    // Item & Description is the one column that can hold Sinhala/Tamil
    // (product name / description) — switch that cell's font family; Sinhala
    // and Tamil only ship Regular, so bold cells (the Amount column) fall
    // back to Regular rather than drawing nothing.
    didParseCell: (data: any) => {
      const raw = Array.isArray(data.cell.raw) ? data.cell.raw.join(" ") : String(data.cell.raw ?? "");
      const family = fontFamilyFor(raw);
      if (family !== NOTO_SANS) {
        data.cell.styles.font = family;
        data.cell.styles.fontStyle = "normal";
      }
    },
  });

  // ── Totals block (right), Zoho-style shaded Balance Due ──────────────
  let ty = (doc as any).lastAutoTable.finalY + 8;
  const totalsW = 78;
  const labelX = right - totalsW;
  const valX = right;

  const totalRow = (label: string, value: string, opts: { color?: RGB; bold?: boolean } = {}) => {
    useFont(label, opts.bold ? "bold" : "normal");
    doc.setFontSize(9.5);
    setText(doc, opts.color ?? MUTED);
    doc.text(label, labelX, ty);
    setText(doc, opts.color ?? INK);
    doc.text(value, valX, ty, { align: "right" });
    ty += 6;
  };

  // separator above totals
  setDraw(doc, RULE); doc.setLineWidth(0.2);
  doc.line(labelX, ty - 4, right, ty - 4);

  // invoice.subtotal is stored NET of line discounts. Present the breakdown so
  // Total = (gross subtotal) − discount + tax always reconciles on the page.
  const lineDiscount = Number(invoice.discount_amount) || 0;
  const grossSubtotal = (Number(invoice.subtotal) || 0) + lineDiscount;
  totalRow("Sub Total", fmt(grossSubtotal));
  if (lineDiscount > 0) {
    totalRow("Discount", `-${fmt(lineDiscount)}`);
    totalRow("Taxable amount", fmt(invoice.subtotal));
  }
  if (Number(invoice.tax_amount) > 0) totalRow("Tax", fmt(invoice.tax_amount));
  totalRow("Total", `${fmt(invoice.total_amount)}`, { bold: true, color: INK });
  if (paid > 0) totalRow("Amount Paid", `-${fmt(paid)}`, { color: GREEN });
  if (disc > 0) totalRow("Credit Notes / Discounts", `-${fmt(disc)}`, { color: GREEN });

  // Balance Due — shaded highlight bar
  ty += 0.5;
  const bH = 10;
  setFill(doc, SHADE);
  doc.rect(labelX - 4, ty - 1, totalsW + 4, bH, "F");
  useFont("Balance Due", "bold");
  doc.setFontSize(10.5);
  setText(doc, INK);
  doc.text("Balance Due", labelX, ty + 5.8);
  setText(doc, balance > 0.005 ? RED : GREEN);
  doc.text(fmt(balance), valX - 1, ty + 5.9, { align: "right" });
  ty += bH + 4;

  // ── Notes / terms / payment details (left column) ────────────────────
  // Fills the space left blank under the totals block and gives the customer
  // what they need to actually pay: bank name, branch, account, SWIFT.
  let ny = (doc as any).lastAutoTable.finalY + 9;
  const notesW = contentW - totalsW - 12;
  for (const [heading, text] of [
    ["Notes", invoice.notes],
    ["Terms & Conditions", termsText],
    ["Payment Details", bankDetails],
  ] as [string, string | null][]) {
    if (!text) continue;
    useFont(heading, "bold");
    doc.setFontSize(8);
    setText(doc, SLATE);
    doc.text(heading, M, ny);
    ny += 4.8;
    useFont(String(text), "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    const wrapped = doc.splitTextToSize(String(text), notesW);
    doc.text(wrapped, M, ny);
    ny += wrapped.length * 4.2 + 5;
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
      let lh = 7;
      let lw = lh * ratio;
      if (lw > 16) { lw = 16; lh = lw / ratio; }
      doc.addImage(logo.dataUrl, "PNG", fx, fy - 5, lw, lh, "company-logo", "FAST");
      fx += lw + 3;
    }
    useFont(tenant?.company_name || "", "bold");
    doc.setFontSize(9);
    setText(doc, HEADING);
    doc.text(tenant?.company_name || "", fx, fy - 1);
    const sub = [tenant?.country, tenant?.registration_number ? `BR No: ${tenant.registration_number}` : null]
      .filter(Boolean).join("  ·  ");
    if (sub) {
      useFont(sub, "normal");
      doc.setFontSize(7.5);
      setText(doc, MUTED);
      doc.text(sub, fx, fy + 3);
    }

    const footerNote = p?.invoice_footer_note || "Thank you for your business";
    useFont(footerNote, "italic");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text(footerNote, pageW / 2, fy, { align: "center" });
    useFont(`Page ${pageNum} of ${pageCount}`, "normal");
    doc.setFontSize(7.5);
    doc.text(`Page ${pageNum} of ${pageCount}`, right, fy, { align: "right" });
  }

  return doc;
}

/**
 * Compose the product/description cell for the items table. Never falls back
 * to the line's GL account name — a chart-of-accounts label (e.g. "Sales
 * Revenue") is an internal posting detail and must not appear on a
 * customer-facing document, even for a manually-mapped line with no product.
 */
function buildItemCell(it: any): string {
  const name = it.products?.name || "";
  const desc = it.description || "";
  if (name && desc && name !== desc) return `${name}\n${desc}`;
  return name || desc || "—";
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
