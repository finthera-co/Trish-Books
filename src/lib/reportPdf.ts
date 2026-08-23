import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawStatementHeading, generatedSentence } from "@/lib/reportHeading";
import { formatDateTime } from "@/lib/format";

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
  registrationNumber?: string | null;
  title: string;
  subtitle?: string;
  dateLine: string;
  fileName: string;
  /** Named in the generated stamp, so a printed pack says who produced it. */
  preparedBy?: string | null;
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
  let y = drawStatementHeading(doc, {
    companyName: meta.companyName,
    address: meta.address,
    phone: meta.phone,
    taxId: meta.taxId,
    registrationNumber: meta.registrationNumber,
    title: meta.title,
    subtitle: meta.subtitle,
    periodLine: meta.dateLine,
    basisLine: "Accrual basis  ·  All amounts in LKR",
    generatedLine: generatedSentence(meta.preparedBy),
  }, margin);

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
  const generated = `Generated on ${formatDateTime(new Date())}`;
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

export interface DataColumnPdf<T> {
  header: string;
  /** Right-aligned amount columns. */
  numeric?: boolean;
  value: (row: T) => string | number | null;
}

/**
 * Export from the report's own data rather than the DOM — the PDF
 * counterpart to `downloadDataExcel`. Use it where the rendered page is only
 * part of the report (paginated or virtualised tables).
 */
export function downloadDataPdf<T>(
  meta: ReportPdfMeta,
  columns: DataColumnPdf<T>[],
  rows: T[],
  totalRow?: (string | number | null)[]
): boolean {
  if (rows.length === 0) return false;

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: columns.length > 7 ? "landscape" : "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  let y = drawStatementHeading(doc, {
    companyName: meta.companyName,
    address: meta.address,
    phone: meta.phone,
    taxId: meta.taxId,
    registrationNumber: meta.registrationNumber,
    title: meta.title,
    subtitle: meta.subtitle,
    periodLine: meta.dateLine,
    basisLine: "Accrual basis  ·  All amounts in LKR",
    generatedLine: generatedSentence(meta.preparedBy),
  }, margin);

  const fmtCell = (raw: string | number | null, numeric?: boolean): string => {
    if (raw == null || raw === "") return "";
    if (typeof raw === "number") {
      return numeric ? raw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(raw);
    }
    return raw;
  };

  const head = [columns.map((c) => c.header)];
  const body = rows.map((row) => columns.map((c) => fmtCell(c.value(row), c.numeric)));
  if (totalRow) body.push(totalRow.map((raw, i) => fmtCell(raw, columns[i]?.numeric)));

  const columnStyles: Record<number, { halign: "right" | "left" }> = {};
  columns.forEach((c, i) => { if (c.numeric) columnStyles[i] = { halign: "right" }; });

  autoTable(doc, {
    head,
    body,
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
      if (totalRow && data.section === "body" && data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = SECTION_BG as unknown as [number, number, number];
      }
    },
  });

  const generated = `Generated on ${formatDateTime(new Date())}`;
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
