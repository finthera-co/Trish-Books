import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { drawStatementHeading, type StatementHeadingMeta } from "@/lib/reportHeading";
import { formatDateTime } from "@/lib/format";

/**
 * Generic PDF table export utility.
 *
 * Two heading modes. By default it draws the compact left-aligned title used by
 * operational list exports. Financial statements pass `heading` instead and get
 * the centred statutory block — entity, title, period, basis — that a report
 * leaving the building has to carry.
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
    /** Centred statement heading. When set it replaces the left-aligned title. */
    heading?: Omit<StatementHeadingMeta, "title">;
  }
) {
  const doc = new jsPDF({ orientation: opts?.orientation || "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  let startY: number;
  if (opts?.heading) {
    startY = drawStatementHeading(doc, { ...opts.heading, title }, margin);
  } else {
    doc.setFontSize(14);
    doc.text(title, margin, 40);
    if (opts?.subtitle) {
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(opts.subtitle, margin, 56);
      doc.setTextColor(0);
    }
    doc.setFontSize(8);
    doc.text(`Generated: ${formatDateTime(new Date())}`, margin, opts?.subtitle ? 70 : 56);
    startY = opts?.subtitle ? 84 : 70;
  }

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
    startY,
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
