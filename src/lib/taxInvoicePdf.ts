import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { loadTaxInvoice, type TaxInvoiceModel } from "@/lib/taxInvoiceData";

// Local LKR formatter — 2 dp with thousands separators. Kept here so the PDF
// renders crisp vector text independent of the on-screen formatCurrency.
const fmt = (n: number): string =>
  "LKR " + (Math.round((n || 0) * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const BLACK: [number, number, number] = [0, 0, 0];

function nextY(doc: jsPDF): number {
  return (doc as any).lastAutoTable.finalY;
}

/**
 * Build the statutory VAT Tax Invoice (IRD Gazette 2481/22, Annexure I) as a
 * vector PDF — real text + lines, selectable and crisp. A4 portrait, ~15mm
 * margins. The layout/labels/ordering are mandated by the gazette.
 */
export function buildTaxInvoicePdf(model: TaxInvoiceModel): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
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
    margin: { left: M, right: M },
    theme: "grid",
    styles: baseStyles,
    headStyles: { fillColor: [255, 255, 255], textColor: BLACK, fontStyle: "bold", lineColor: BLACK, lineWidth: 0.2 },
    head: [["Reference*", "Description of Goods or Services", "Quantity", "Unit Price", "Amount Excluding VAT (Rs.)"]],
    body: [
      ...model.lines.map((l) => [
        l.reference,
        (l.description || l.amountExVat) ? `${l.description} (${l.nature})` : l.description,
        l.qty ? String(l.qty) : "",
        l.unitPrice ? fmt(l.unitPrice) : "",
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
    margin: { left: M, right: M },
    theme: "grid",
    styles: baseStyles,
    body: [
      [{ content: "Total Value of Supply:", styles: { halign: "right", fontStyle: "bold" } }, { content: fmt(model.totalValueOfSupply), styles: { halign: "right" } }],
      [{ content: "VAT Amount (Total Value of Supply @ VAT Rate):", styles: { halign: "right", fontStyle: "bold" } }, { content: fmt(model.vatAmount), styles: { halign: "right" } }],
      [{ content: "Total Amount/consideration including VAT:", styles: { halign: "right", fontStyle: "bold" } }, { content: fmt(model.totalIncludingVat), styles: { halign: "right" } }],
      [{ content: `Total Amount in words:* ${model.totalInWords}`, colSpan: 2 }],
      [{ content: `Mode of Payment:* ${model.modeOfPayment}`, colSpan: 2 }],
    ],
    columnStyles: { 0: { cellWidth: usableW * 0.79 }, 1: { cellWidth: usableW * 0.21 } },
  });

  return doc;
}

export async function downloadTaxInvoicePdf(invoiceId: string, tenantId: string): Promise<void> {
  const model = await loadTaxInvoice(invoiceId, tenantId);
  const doc = buildTaxInvoicePdf(model);
  const safeNo = (model.invoiceNo || invoiceId).replace(/[^\w.-]+/g, "_");
  doc.save(`tax-invoice-${safeNo}.pdf`);
}
