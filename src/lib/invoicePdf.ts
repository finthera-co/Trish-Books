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
const HEADBG = [243, 244, 246] as const; // table header fill

type RGB = readonly [number, number, number];
const setText = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
const setDraw = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);

const fmt = (n: unknown) => formatCurrency(Number(n) || 0);
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

interface LoadedLogo {
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
    .select("*, customers(*), invoice_items(*, products(name), account:accounts(account_name))")
    .eq("id", invoiceId)
    .single();
  if (error || !invoice) throw new Error(error?.message || "Invoice not found");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("company_name, country, registration_number, logo_url")
    .eq("id", tenantId)
    .maybeSingle();

  return {
    invoice,
    customer: (invoice as any).customers || {},
    items: (invoice as any).invoice_items || [],
    tenant: tenant || {},
  };
}

/** Render an invoice to a jsPDF document (no save). */
export function buildInvoicePdf({ invoice, customer, items, tenant }: InvoicePdfData, logo?: LoadedLogo | null): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 15; // page margin
  const right = pageW - M;
  const y0 = M;

  // ── Header: logo + company (left) · INVOICE title (right) ───────────
  let leftY = y0 + 2; // baseline for the first company text line
  if (logo) {
    // Fit the logo into a 45×18mm box, preserving aspect ratio.
    const boxW = 45, boxH = 18;
    const ratio = logo.w / logo.h || 1;
    let drawW = boxW, drawH = boxW / ratio;
    if (drawH > boxH) { drawH = boxH; drawW = boxH * ratio; }
    doc.addImage(logo.dataUrl, "PNG", M, y0, drawW, drawH);
    leftY = y0 + drawH + 5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  setText(doc, INK);
  doc.text(tenant?.company_name || "Your Company", M, leftY);
  leftY += 6;
  if (tenant?.country) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text(String(tenant.country), M, leftY);
    leftY += 4;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setText(doc, GREEN);
  doc.text("INVOICE", right, y0 + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setText(doc, INK);
  doc.text(invoice.invoice_number || "", right, y0 + 9, { align: "right" });
  if (invoice.status) {
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(String(invoice.status).toUpperCase(), right, y0 + 14, { align: "right" });
  }

  let y = Math.max(leftY + 1, y0 + 22);
  setDraw(doc, RULE);
  doc.setLineWidth(0.3);
  doc.line(M, y, right, y);
  y += 8;

  // ── Bill To (left) · meta (right) ───────────────────────────────────
  const metaX = pageW - 70;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text("BILL TO", M, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText(doc, INK);
  doc.text(customer?.name || "—", M, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, MUTED);
  let cy = y + 11;
  for (const line of [customer?.address, customer?.email, customer?.phone].filter(Boolean)) {
    doc.text(String(line), M, cy);
    cy += 4.5;
  }

  // Meta rows on the right
  const meta: [string, string][] = [
    ["Issue date", prettyDate(invoice.issue_date)],
    ["Due date", prettyDate(invoice.due_date)],
  ];
  const terms = prettyTerms(invoice.payment_terms);
  if (terms) meta.push(["Terms", terms]);
  let my = y;
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(label, metaX, my);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setText(doc, INK);
    doc.text(value, right, my, { align: "right" });
    my += 6;
  }

  y = Math.max(cy, my) + 4;

  // ── Line items table ────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["#", "Description", "Qty", "Rate", "Tax", "Amount"]],
    body: items.map((it, i) => {
      const name = it.products?.name;
      const desc = it.description || name || "—";
      const label = name && name !== it.description ? `${desc}\n${it.account?.account_name || ""}` : desc;
      return [
        String(i + 1),
        label,
        Number(it.quantity) ? String(Number(it.quantity)) : "—",
        fmt(it.unit_price),
        fmt(it.tax_amount_line),
        fmt(it.total),
      ];
    }),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2.5, textColor: [INK[0], INK[1], INK[2]], lineColor: [RULE[0], RULE[1], RULE[2]], lineWidth: 0.1 },
    headStyles: { fillColor: [HEADBG[0], HEADBG[1], HEADBG[2]], textColor: [MUTED[0], MUTED[1], MUTED[2]], fontStyle: "bold", fontSize: 8, halign: "left" },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      2: { halign: "center", cellWidth: 16 },
      3: { halign: "right", cellWidth: 26 },
      4: { halign: "right", cellWidth: 24 },
      5: { halign: "right", cellWidth: 28 },
    },
    theme: "grid",
  });

  // ── Totals block (right-aligned under the table) ────────────────────
  let ty = (doc as any).lastAutoTable.finalY + 8;
  const labelX = pageW - 70;
  const row = (label: string, value: string, opts: { bold?: boolean; color?: RGB; size?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 9);
    setText(doc, opts.color ?? MUTED);
    doc.text(label, labelX, ty);
    setText(doc, opts.color ?? INK);
    doc.text(value, right, ty, { align: "right" });
    ty += opts.size ? opts.size * 0.6 : 5.5;
  };

  row("Subtotal", fmt(invoice.subtotal));
  if (Number(invoice.discount_amount) > 0) row("Discount", `-${fmt(invoice.discount_amount)}`, { color: RED });
  if (Number(invoice.tax_amount) > 0) row("Tax", fmt(invoice.tax_amount));

  ty += 1.5;
  setDraw(doc, RULE);
  doc.line(labelX, ty, right, ty);
  ty += 6;
  row("Total", fmt(invoice.total_amount), { bold: true, color: INK, size: 12 });

  const paid = Number(invoice.amount_paid) || 0;
  if (paid > 0) {
    ty += 2;
    row("Paid", fmt(paid), { color: GREEN });
    const balance = Number(invoice.balance_due ?? Number(invoice.total_amount) - paid);
    row("Balance due", fmt(balance), { bold: true, color: balance > 0 ? RED : GREEN });
  }

  // ── Notes / terms ───────────────────────────────────────────────────
  let ny = ty + 10;
  for (const [heading, text] of [
    ["Notes", invoice.notes],
    ["Terms & conditions", invoice.terms],
  ] as [string, string | null][]) {
    if (!text) continue;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(heading.toUpperCase(), M, ny);
    ny += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, INK);
    const wrapped = doc.splitTextToSize(String(text), right - M);
    doc.text(wrapped, M, ny);
    ny += wrapped.length * 4.5 + 4;
  }

  // ── Footer: business registration no., centered at the foot ─────────
  if (tenant?.registration_number) {
    const pageH = doc.internal.pageSize.getHeight();
    const fy = pageH - 12;
    setDraw(doc, RULE);
    doc.setLineWidth(0.3);
    doc.line(pageW / 2 - 35, fy - 4, pageW / 2 + 35, fy - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(`BR No: ${tenant.registration_number}`, pageW / 2, fy, { align: "center" });
  }

  return doc;
}

/** Fetch, render, and trigger a browser download of the invoice PDF. */
export async function downloadInvoiceVectorPdf(invoiceId: string, tenantId: string): Promise<void> {
  const data = await loadInvoicePdfData(invoiceId, tenantId);
  const logo = await loadLogo(data.tenant?.logo_url);
  const doc = buildInvoicePdf(data, logo);
  doc.save(`Invoice-${sanitize(data.invoice.invoice_number || invoiceId)}.pdf`);
}
