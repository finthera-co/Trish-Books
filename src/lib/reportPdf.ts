import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Generic financial-report PDF exporter for the Reports hub.
 *
 * Converts the statement table(s) already rendered on screen (every report
 * renders `.data-table` inside its statement card) into a selectable,
 * vector PDF with the standard statement heading — company identity, report
 * title, basis date line — and a page-number footer. Column alignment and
 * bold total rows are read straight from the DOM classes so the PDF always
 * matches what the report shows.
 */

const INK = [17, 24, 39] as const; // gray-900
const MUTED = [107, 114, 128] as const; // gray-500
const RULE = [221, 221, 221] as const; // matches printed table borders
const SECTION_BG = [241, 245, 249] as const; // slate-100 — section header rows
const HEAD_BG = [245, 245, 245] as const;

export interface ReportPdfMeta {
  companyName?: string | null;
  address?: string | null;
  phone?: string | null;
  taxId?: string | null;
  title: string;
  subtitle?: string;
  dateLine: string;
  fileName: string;
}

export function downloadReportPdf(container: HTMLElement, meta: ReportPdfMeta) {
  const tables = Array.from(container.querySelectorAll<HTMLTableElement>("table.data-table"));
  if (tables.length === 0) return false;

  // Wide schedules (e.g. PPE with per-fiscal-year columns) print landscape.
  const maxCols = Math.max(
    ...tables.map(t => t.tHead?.rows[0]?.cells.length ?? 0)
  );
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: maxCols > 7 ? "landscape" : "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const center = pageWidth / 2;

  // ── Statement heading (first page) ────────────────────────────────
  let y = margin + 6;
  if (meta.companyName) {
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...INK);
    doc.text(meta.companyName, center, y, { align: "center" });
    y += 16;
  }
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
  if (meta.address) {
    for (const line of meta.address.split("\n").map(s => s.trim()).filter(Boolean)) {
      doc.text(line, center, y, { align: "center" });
      y += 11;
    }
  }
  const contact = [meta.phone, meta.taxId ? `TIN: ${meta.taxId}` : null].filter(Boolean).join(" · ");
  if (contact) {
    doc.text(contact, center, y, { align: "center" });
    y += 11;
  }
  y += 4;
  doc.setDrawColor(...RULE).setLineWidth(0.75);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...INK);
  doc.text(meta.title, center, y, { align: "center" });
  y += 14;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  if (meta.subtitle) {
    doc.text(meta.subtitle, center, y, { align: "center" });
    y += 12;
  }
  doc.setTextColor(...INK);
  doc.text(meta.dateLine, center, y, { align: "center" });
  y += 11;
  doc.setFontSize(7.5).setTextColor(...MUTED);
  doc.text("All amounts in LKR", center, y, { align: "center" });
  y += 16;

  // ── Statement table(s) ─────────────────────────────────────────────
  for (const table of tables) {
    // Right-aligned columns are declared on the on-screen <th> elements.
    const headerCells = Array.from(table.tHead?.rows[0]?.cells ?? []);
    const columnStyles: Record<number, { halign: "right" | "left" }> = {};
    headerCells.forEach((th, i) => {
      if (th.className.includes("text-right")) columnStyles[i] = { halign: "right" };
    });

    autoTable(doc, {
      html: table,
      startY: y,
      margin: { left: margin, right: margin, top: margin, bottom: margin + 14 },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8,
        textColor: INK as unknown as [number, number, number],
        lineColor: RULE as unknown as [number, number, number],
        lineWidth: 0.5,
        cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 },
      },
      headStyles: {
        fillColor: HEAD_BG as unknown as [number, number, number],
        textColor: INK as unknown as [number, number, number],
        fontStyle: "bold",
      },
      columnStyles,
      didParseCell: (data) => {
        const el = data.cell.raw as HTMLElement | undefined;
        if (!el || !(el instanceof HTMLElement)) return;
        const tr = el.closest("tr");
        const trClass = tr?.className ?? "";
        const tdClass = el.className ?? "";
        if (trClass.includes("font-bold") || trClass.includes("font-semibold") || tdClass.includes("font-semibold") || tdClass.includes("font-bold")) {
          data.cell.styles.fontStyle = "bold";
        }
        // Section header rows keep their tinted background.
        if (trClass.includes("bg-muted") || trClass.includes("bg-secondary")) {
          data.cell.styles.fillColor = SECTION_BG as unknown as [number, number, number];
        }
        if (tdClass.includes("text-right")) data.cell.styles.halign = "right";
        if (tdClass.includes("italic")) {
          data.cell.styles.fontStyle = data.cell.styles.fontStyle === "bold" ? "bolditalic" : "italic";
        }
      },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 20;
  }

  // ── Footer: generated stamp + page numbers on every page ──────────
  const generated = `Generated on ${new Date().toLocaleString()}`;
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(generated, margin, pageHeight - 18);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 18, { align: "right" });
  }

  doc.save(meta.fileName);
  return true;
}
