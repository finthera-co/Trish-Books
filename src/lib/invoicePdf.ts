import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";

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
const prettyDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const prettyTerms = (t?: string | null) =>
  t ? t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "";

interface InvoicePdfData {
  invoice: any;
  customer: any;
  items: any[];
  tenant: any;
}

export interface LoadedLogo {
  dataUrl: string;
  /** Natural pixel dimensions, used to preserve aspect ratio in the PDF. */
  w: number;
  h: number;
}

/**
 * Load the company logo into a PNG data URL plus its natural dimensions.
 * Returns null on any failure (missing, CORS-tainted, decode error) so the
 * invoice still renders without it.
 */
export async function loadLogo(url?: string | null): Promise<LoadedLogo | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight });
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
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("*, customers(*), invoice_items(*, products(name), account:accounts(account_name)), payments_received(amount), ar_credit_notes(amount, status)")
    .eq("id", invoiceId)
    .single();
  if (error || !invoice) throw new Error(error?.message || "Invoice not found");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("company_name, country, registration_number, logo_url")
    .eq("id", tenantId)
    .maybeSingle();

  // Settle figures: payments + non-voided discount credit notes reduce the balance.
  const amountPaid = ((invoice as any).payments_received || []).reduce(
    (s: number, p: any) => s + Number(p.amount || 0), 0);
  const discountTotal = ((invoice as any).ar_credit_notes || [])
    .filter((c: any) => c.status !== "voided")
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  const total = Number((invoice as any).total_amount || 0);
  const balanceDue = Math.max(0, total - amountPaid - discountTotal);

  return {
    invoice: { ...invoice, amount_paid: amountPaid, discount_total: discountTotal, balance_due: balanceDue },
    customer: (invoice as any).customers || {},
    items: (invoice as any).invoice_items || [],
    tenant: tenant || {},
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
export function buildInvoicePdf({ invoice, customer, items, tenant }: InvoicePdfData, logo?: LoadedLogo | null): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16; // page margin
  const right = pageW - M;
  const contentW = right - M;
  const currency = String(invoice.currency || "LKR");

  const status = invoiceStatus(invoice);
  const paid = Number(invoice.amount_paid) || 0;
  const disc = Number(invoice.discount_total) || 0;
  const balance = Number(invoice.balance_due ?? Number(invoice.total_amount) - paid - disc);
  // The headline figure: what's still owed, or the grand total once settled.
  const headlineAmount = balance > 0.005 ? balance : Number(invoice.total_amount) || 0;
  const headlineLabel = balance > 0.005 ? `Amount due (${currency})` : `Total (${currency})`;

  // ── Summary card: soft lavender panel, INVOICE title + headline amount ──
  const cardY = 14, cardH = 36;
  const padX = 9;
  setFill(doc, CARD);
  doc.roundedRect(M, cardY, contentW, cardH, 3, 3, "F");

  // Left: title + issuer
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  setText(doc, HEADING);
  doc.text("Invoice", M + padX, cardY + 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setText(doc, MUTED);
  doc.text(tenant?.company_name || "Your Company", M + padX, cardY + 25);

  // Right: headline amount + status chip
  const rTextX = right - padX;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, MUTED);
  doc.text(headlineLabel, rTextX, cardY + 13, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(23);
  setText(doc, ACCENT);
  doc.text(num(headlineAmount), rTextX, cardY + 25, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const chipW = doc.getTextWidth(status.label) + 7;
  const chipH = 6;
  setFill(doc, status.color);
  doc.roundedRect(rTextX - chipW, cardY + 28, chipW, chipH, 1.5, 1.5, "F");
  setText(doc, WHITE);
  doc.text(status.label, rTextX - chipW / 2, cardY + 32.2, { align: "center" });

  let y = cardY + cardH + 13;

  // ── Bill To (left) · Invoice meta (right, key:value) ─────────────────
  const billW = contentW * 0.5 - 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setText(doc, HEADING);
  doc.text("BILL TO", M, y);

  const partyAddr = customer?.address ? doc.splitTextToSize(String(customer.address), billW) : [];
  const billLines: { t: string; bold?: boolean }[] = [
    { t: customer?.legal_name || customer?.name || "—", bold: true },
    ...partyAddr.map((t: string) => ({ t })),
    ...[customer?.email, customer?.phone || customer?.mobile].filter(Boolean).map((t: any) => ({ t: String(t) })),
  ];
  let by = y + 6.5;
  billLines.forEach((ln) => {
    doc.setFont("helvetica", ln.bold ? "bold" : "normal");
    doc.setFontSize(ln.bold ? 11 : 9);
    setText(doc, ln.bold ? INK : MUTED);
    doc.text(ln.t, M, by);
    by += ln.bold ? 5.8 : 4.6;
  });

  // Meta: right-aligned label · value rows (value bold, label muted to its left)
  const meta: [string, string][] = [["Invoice number", String(invoice.invoice_number || "—")]];
  meta.push(["Invoice date", prettyDate(invoice.issue_date)]);
  const terms = prettyTerms(invoice.payment_terms);
  if (terms) meta.push(["Terms", terms]);
  meta.push(["Payment due", prettyDate(invoice.due_date)]);

  let my = y;
  meta.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    setText(doc, INK);
    doc.text(value, right, my, { align: "right" });
    const vW = doc.getTextWidth(value);
    doc.setFont("helvetica", "normal");
    setText(doc, MUTED);
    doc.text(`${label}:`, right - vW - 3, my, { align: "right" });
    my += 6.2;
  });

  y = Math.max(by, my) + 6;

  // ── Line items table (light theme) ───────────────────────────────────
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["#", "Item & description", "Qty", "Rate", "Amount"]],
    body: items.map((it, i) => [
      String(i + 1),
      buildItemCell(it),
      Number(it.quantity) ? String(Number(it.quantity)) : "—",
      fmt(it.unit_price),
      fmt(it.total),
    ]),
    styles: {
      font: "helvetica", fontSize: 9, cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
      textColor: [INK[0], INK[1], INK[2]], lineColor: [RULE[0], RULE[1], RULE[2]], lineWidth: 0,
      valign: "middle",
    },
    headStyles: {
      fillColor: [TBL_HEAD_BG[0], TBL_HEAD_BG[1], TBL_HEAD_BG[2]], textColor: [HEADING[0], HEADING[1], HEADING[2]],
      fontStyle: "bold", fontSize: 8.5, halign: "left", cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 10, textColor: [MUTED[0], MUTED[1], MUTED[2]] },
      1: { cellWidth: "auto" },
      2: { halign: "center", cellWidth: 18 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 30, fontStyle: "bold" },
    },
    theme: "plain",
    // hairline rule under each body row for a clean, airy ledger feel
    didParseCell: (data) => {
      if (data.section === "body") data.cell.styles.lineWidth = { bottom: 0.1, top: 0, left: 0, right: 0 } as any;
    },
  });

  // ── Totals block (right) ─────────────────────────────────────────────
  let ty = (doc as any).lastAutoTable.finalY + 9;
  const totalsW = 92; // wide enough that large amounts never clip
  const labelX = right - totalsW;
  const valX = right;
  const boxValX = right - 3; // values sit just inside the rounded bars

  const totalRow = (label: string, value: string, opts: { color?: RGB; bold?: boolean } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(9.5);
    setText(doc, opts.color ?? MUTED);
    doc.text(label, labelX, ty);
    setText(doc, opts.color ?? INK);
    doc.text(value, valX, ty, { align: "right" });
    ty += 6;
  };

  totalRow("Subtotal", fmt(invoice.subtotal));
  if (Number(invoice.discount_amount) > 0) totalRow("Line discount", `-${fmt(invoice.discount_amount)}`, { color: RED });
  if (Number(invoice.tax_amount) > 0) totalRow("Tax", fmt(invoice.tax_amount));

  // Grand total — soft lavender bar (light, matches the summary card)
  ty += 0.5;
  const gtH = 10;
  setFill(doc, CARD);
  doc.roundedRect(labelX - 4, ty - 1, totalsW + 4, gtH, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setText(doc, HEADING);
  doc.text(`Grand total (${currency})`, labelX, ty + 5.7);
  doc.setFontSize(12);
  doc.text(fmt(invoice.total_amount), boxValX, ty + 5.9, { align: "right" });
  ty += gtH + 4;

  if (paid > 0) totalRow("Amount paid", `-${fmt(paid)}`, { color: GREEN });
  if (disc > 0) totalRow("Discounts applied", `-${fmt(disc)}`, { color: GREEN });
  if (paid > 0 || disc > 0) {
    ty += 0.5;
    const bH = 9;
    const bColor = balance > 0.005 ? RED : GREEN;
    setDraw(doc, bColor);
    doc.setLineWidth(0.4);
    doc.roundedRect(labelX - 4, ty - 1, totalsW + 4, bH, 2, 2, "D");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    setText(doc, bColor);
    doc.text("BALANCE DUE", labelX, ty + 5);
    doc.setFontSize(11);
    doc.text(fmt(balance), boxValX, ty + 5.2, { align: "right" });
    ty += bH + 4;
  }

  // ── Notes / terms (left column, beside totals) ───────────────────────
  let ny = (doc as any).lastAutoTable.finalY + 9;
  const notesW = contentW - totalsW - 12;
  for (const [heading, text] of [
    ["Notes / Terms", invoice.notes],
    ["Terms & conditions", invoice.terms],
  ] as [string, string | null][]) {
    if (!text) continue;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText(doc, HEADING);
    doc.text(heading, M, ny);
    ny += 4.8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    const wrapped = doc.splitTextToSize(String(text), notesW);
    doc.text(wrapped, M, ny);
    ny += wrapped.length * 4.2 + 5;
  }

  // ── Footer on every page: rule + logo · company · thank-you · page ───
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const fy = pageH - 11;
    setDraw(doc, RULE);
    doc.setLineWidth(0.2);
    doc.line(M, fy - 5, right, fy - 5);

    // Left: small logo (if any) + company name / BR
    let fx = M;
    if (logo) {
      const lh = 7, ratio = logo.w / logo.h || 1;
      const lw = Math.min(lh * ratio, 16);
      doc.addImage(logo.dataUrl, "PNG", fx, fy - 5, lw, lh);
      fx += lw + 3;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setText(doc, HEADING);
    doc.text(tenant?.company_name || "", fx, fy - 1);
    const sub = [tenant?.country, tenant?.registration_number ? `BR No: ${tenant.registration_number}` : null]
      .filter(Boolean).join("  ·  ");
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      setText(doc, MUTED);
      doc.text(sub, fx, fy + 3);
    }

    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text("Thank you for your business", pageW / 2, fy, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(`Page ${p} of ${pageCount}`, right, fy, { align: "right" });
  }

  return doc;
}

/** Compose the product/description cell for the items table. */
function buildItemCell(it: any): string {
  const name = it.products?.name || it.account?.account_name || "";
  const desc = it.description || "";
  if (name && desc && name !== desc) return `${name}\n${desc}`;
  return name || desc || "—";
}

/** Fetch, render, and trigger a browser download of the invoice PDF. */
export async function downloadInvoiceVectorPdf(invoiceId: string, tenantId: string): Promise<void> {
  const data = await loadInvoicePdfData(invoiceId, tenantId);
  const logo = await loadLogo(data.tenant?.logo_url);
  const doc = buildInvoicePdf(data, logo);
  doc.save(`Invoice-${sanitize(data.invoice.invoice_number || invoiceId)}.pdf`);
}

/** Fetch and render the invoice PDF, returning it as a named File for sharing/attaching. */
export async function getInvoiceVectorPdfFile(invoiceId: string, tenantId: string): Promise<File> {
  const data = await loadInvoicePdfData(invoiceId, tenantId);
  const logo = await loadLogo(data.tenant?.logo_url);
  const doc = buildInvoicePdf(data, logo);
  const blob = doc.output("blob");
  return new File([blob], `Invoice-${sanitize(data.invoice.invoice_number || invoiceId)}.pdf`, {
    type: "application/pdf",
  });
}
