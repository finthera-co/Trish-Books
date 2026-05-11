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
  opts?: { orientation?: "portrait" | "landscape"; subtitle?: string }
) {
  const doc = new jsPDF({ orientation: opts?.orientation || "landscape", unit: "pt", format: "a4" });

  doc.setFontSize(14);
  doc.text(title, 40, 40);
  if (opts?.subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(opts.subtitle, 40, 56);
    doc.setTextColor(0);
  }
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, opts?.subtitle ? 70 : 56);

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
    startY: opts?.subtitle ? 84 : 70,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [34, 197, 94], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 246] },
    margin: { left: 40, right: 40 },
  });

  doc.save(filename);
}
