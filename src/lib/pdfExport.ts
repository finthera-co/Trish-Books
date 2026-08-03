import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Generic PDF table export utility.
 */
export function exportToPdf(
  filename: string,
  title: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  opts?: {
    orientation?: "portrait" | "landscape";
    subtitle?: string;
    /** Left-aligned stamp repeated in the footer of every page (e.g. a reproducibility fingerprint). */
    footer?: string;
    /** 0-based indices into `rows` to render bold (e.g. subtotal/total rows). */
    boldRows?: ReadonlySet<number>;
    columnStyles?: Record<number, { halign: "left" | "right" }>;
  }
) {
  const doc = new jsPDF({ orientation: opts?.orientation || "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  doc.setFontSize(14);
  doc.text(title, margin, 40);
  if (opts?.subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(opts.subtitle, margin, 56);
    doc.setTextColor(0);
  }
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, opts?.subtitle ? 70 : 56);

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
    startY: opts?.subtitle ? 84 : 70,
    margin: { left: margin, right: margin, bottom: margin },
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [34, 197, 94], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 246] },
    columnStyles: opts?.columnStyles,
    didParseCell: (data) => {
      if (data.section === "body" && opts?.boldRows?.has(data.row.index)) {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    if (opts?.footer) doc.text(opts.footer, margin, pageHeight - 18);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 18, { align: "right" });
    doc.setTextColor(0);
  }

  doc.save(filename);
}
