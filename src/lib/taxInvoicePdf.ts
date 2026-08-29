import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { loadTaxInvoice, formatRate, type TaxInvoiceModel } from "@/lib/taxInvoiceData";

// Local LKR formatter — 2 dp with thousands separators. Kept here so the PDF
// renders crisp vector text independent of the on-screen formatCurrency.
const fmt = (n: number, dp = 2): string =>
  "LKR " + (Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

const BLACK: [number, number, number] = [0, 0, 0];

function nextY(doc: jsPDF): number {
  return (doc as any).lastAutoTable.finalY;
}

/**
 * The totals block, in gazette order. The VAT row names the rate actually
 * charged; an invoice carrying more than one rate gets a row per rate and a
 * total beneath, so every figure on the document is attributable to a rate.
 */
export function totalsRows(model: TaxInvoiceModel): { label: string; value: string }[] {
  const rows = [{ label: "Total Value of Supply:", value: fmt(model.totalValueOfSupply) }];
  if (model.vatBands.length === 1) {
    rows.push({
      label: `VAT Amount (Total Value of Supply @ ${formatRate(model.vatBands[0].rate)}):`,
      value: fmt(model.vatAmount),
    });
  } else {
    for (const b of model.vatBands) {
      rows.push({ label: `VAT Amount (${fmt(b.base)} @ ${formatRate(b.rate)}):`, value: fmt(b.vat) });
    }
    rows.push({ label: "Total VAT Amount:", value: fmt(model.vatAmount) });
  }
  rows.push({ label: "Total Amount/consideration including VAT:", value: fmt(model.totalIncludingVat) });
  return rows;
}

/**
 * Build the statutory VAT Tax Invoice (IRD Gazette 2481/22, Annexure I) as a
 * vector PDF — real text + lines, selectable and crisp. A4 portrait, ~15mm
 * margins. The layout/labels/ordering are mandated by the gazette.
 */
export function buildTaxInvoicePdf(model: TaxInvoiceModel): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 15;
  const usableW = pageW - M * 2;
  const half = usableW / 2;

  // ── Title box ───────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(0, 0, 0);
  const title = "TAX INVOICE";
  const tW = doc.getTextWidth(title);
  const boxW = tW + 24;
  const boxX = (pageW - boxW) / 2;
  const boxY = M;
  const boxH = 11;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(boxX, boxY, boxW, boxH);
  doc.text(title, pageW / 2, boxY + boxH / 2 + 1.5, { align: "center" });

  const headerStartY = boxY + boxH + 4;

  const baseStyles = {
    font: "helvetica" as const,
    fontSize: 9,
    cellPadding: 2,
    textColor: BLACK,
    lineColor: BLACK,
    lineWidth: 0.2,
    valign: "top" as const,
  };

  const supplierBlock =
    `Date of Invoice: ${model.dateOfInvoice}\n\n` +
    `Supplier's TIN: ${model.supplier.tin}\n` +
    `Supplier's Name: ${model.supplier.name}\n` +
    `Address: ${model.supplier.address}\n` +
    `Telephone No.:* ${model.supplier.phone}`;

  const purchaserBlock =
    `Tax Invoice No.: ${model.invoiceNo}\n\n` +
    `Purchaser's TIN: ${model.purchaser.tin}\n` +
    `Purchaser's Name: ${model.purchaser.name}\n` +
    `Address: ${model.purchaser.address}\n` +
    `Telephone No.:* ${model.purchaser.phone}`;

  // ── Supplier / Purchaser header (bordered grid) ─────────────────────
  autoTable(doc, {
    startY: headerStartY,
    margin: { left: M, right: M },
    theme: "grid",
    styles: baseStyles,
    body: [
      [supplierBlock, purchaserBlock],
      [`Date of Supply: ${model.dateOfSupply}`, `Place of Supply:* ${model.placeOfSupply}`],
      [{ content: `Additional Information if any:* ${model.additionalInfo}`, colSpan: 2 }],
    ],
    columnStyles: { 0: { cellWidth: half }, 1: { cellWidth: half } },
  });

  // ── Line items ──────────────────────────────────────────────────────
  autoTable(doc, {
    startY: nextY(doc),
    // A continuation page starts below the top margin, not under the title box.
    margin: { left: M, right: M, top: M, bottom: M + 6 },
    theme: "grid",
    styles: baseStyles,
    // The column headings must repeat on every continuation page.
    showHead: "everyPage",
    headStyles: { fillColor: [255, 255, 255], textColor: BLACK, fontStyle: "bold", lineColor: BLACK, lineWidth: 0.2 },
    head: [["Reference*", model.descriptionHeader, "Quantity", "Unit Price", "Amount Excluding VAT (Rs.)"]],
    body: [
      ...model.lines.map((l) => [
        l.reference,
        l.description,
        l.qty ? String(l.qty) : "",
        l.qty ? fmt(l.unitPrice, l.unitPriceDecimals) : "",
        fmt(l.amountExVat),
      ]),
      // Pad to at least 4 rows to mirror the specimen.
      ...Array.from({ length: Math.max(0, 4 - model.lines.length) }, () => ["", "", "", "", ""]),
    ],
    columnStyles: {
      0: { cellWidth: usableW * 0.12 },
      1: { cellWidth: usableW * 0.40 },
      2: { cellWidth: usableW * 0.11, halign: "right" },
      3: { cellWidth: usableW * 0.16, halign: "right" },
      4: { cellWidth: usableW * 0.21, halign: "right" },
    },
  });

  // ── Totals ──────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: nextY(doc),
    margin: { left: M, right: M, top: M, bottom: M + 6 },
    theme: "grid",
    styles: baseStyles,
    body: [
      ...totalsRows(model).map((r) => [
        { content: r.label, styles: { halign: "right" as const, fontStyle: "bold" as const } },
        { content: r.value, styles: { halign: "right" as const } },
      ]),
      [{ content: `Total Amount in words:* ${model.totalInWords}`, colSpan: 2 }],
      [{ content: `Mode of Payment:* ${model.modeOfPayment}`, colSpan: 2 }],
    ],
    columnStyles: { 0: { cellWidth: usableW * 0.79 }, 1: { cellWidth: usableW * 0.21 } },
  });

  // ── Continuation footer ─────────────────────────────────────────────
  // Every sheet has to identify the invoice it belongs to and its place in the
  // set, or a detached page is unattributable.
  const pages = doc.getNumberOfPages();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.text(`Tax Invoice No.: ${model.invoiceNo}  ·  Supplier's TIN: ${model.supplier.tin}`, M, pageH - 8);
    doc.text(`Page ${p} of ${pages}`, pageW - M, pageH - 8, { align: "right" });
  }

  return doc;
}

export async function downloadTaxInvoicePdf(invoiceId: string, tenantId: string): Promise<void> {
  const model = await loadTaxInvoice(invoiceId, tenantId);
  const doc = buildTaxInvoicePdf(model);
  const safeNo = (model.invoiceNo || invoiceId).replace(/[^\w.-]+/g, "_");
  doc.save(`tax-invoice-${safeNo}.pdf`);
}
