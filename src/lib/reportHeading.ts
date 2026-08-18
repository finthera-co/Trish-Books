import type { jsPDF } from "jspdf";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * The centred statement heading drawn at the top of every exported financial
 * report PDF — the print-side twin of `<ReportMasthead>`.
 *
 * Previously each exporter drew its own: the Reports hub centred a full entity
 * block, while the Trial Balance, General Ledger and Statement of Comprehensive
 * Income drew a left-aligned title with no company name at all. A PDF that
 * leaves the building without naming the entity it belongs to is not a
 * financial statement, so all four now draw the same block from here.
 */

const INK = [17, 24, 39] as const; // gray-900
const MUTED = [107, 114, 128] as const; // gray-500
const RULE = [221, 221, 221] as const;

export interface StatementHeadingCompany {
  companyName?: string | null;
  address?: string | null;
  phone?: string | null;
  taxId?: string | null;
  registrationNumber?: string | null;
}

export interface StatementHeadingMeta extends StatementHeadingCompany {
  /** The statement's formal name, e.g. "Trial Balance". */
  title: string;
  /** Second line under the title — an account, a method, a basis. */
  subtitle?: string | null;
  /** "For the period 01/01/2026 to 31/03/2026" / "As at 31/03/2026". */
  periodLine?: string | null;
  /** "Accrual basis · All amounts in LKR". */
  basisLine?: string | null;
  /** Filters in force, so a reader can reproduce the figures. */
  scopeLine?: string | null;
  /** "Generated 14/08/2026 15:45 by Jane Perera". */
  generatedLine?: string | null;
}

/** ISO date → "14/08/2026", the system standard. */
export const headingDate = formatDate;

/** "For the period 01/01/2026 to 31/03/2026". */
export function periodSentence(dateFrom?: string | null, dateTo?: string | null): string {
  if (dateFrom && dateTo) return `For the period ${headingDate(dateFrom)} to ${headingDate(dateTo)}`;
  if (dateTo) return `Up to ${headingDate(dateTo)}`;
  if (dateFrom) return `From ${headingDate(dateFrom)}`;
  return "";
}

/** "Generated 14/08/2026 15:45 by Jane Perera". */
export function generatedSentence(preparedBy?: string | null): string {
  return `Generated ${formatDateTime(new Date())}${preparedBy ? ` by ${preparedBy}` : ""}`;
}

/**
 * Draws the heading centred on the current page and returns the Y coordinate
 * the table should start at.
 */
export function drawStatementHeading(doc: jsPDF, meta: StatementHeadingMeta, margin = 40): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const center = pageWidth / 2;
  // Long scope/period lines are wrapped rather than run off the page edge.
  const maxWidth = pageWidth - margin * 2;

  const centredLines = (text: string, lineHeight: number, y: number): number => {
    for (const line of doc.splitTextToSize(text, maxWidth)) {
      doc.text(line, center, y, { align: "center" });
      y += lineHeight;
    }
    return y;
  };

  let y = margin + 6;

  // ── Entity block ──
  if (meta.companyName) {
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...INK);
    y = centredLines(meta.companyName.toUpperCase(), 15, y);
  }
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
  if (meta.address) {
    for (const line of meta.address.split("\n").map((s) => s.trim()).filter(Boolean)) {
      y = centredLines(line, 11, y);
    }
  }
  const contact = [
    meta.phone,
    meta.taxId ? `TIN: ${meta.taxId}` : null,
    meta.registrationNumber ? `Reg. No: ${meta.registrationNumber}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) y = centredLines(contact, 11, y);

  y += 4;
  doc.setDrawColor(...RULE).setLineWidth(0.75);
  doc.line(margin, y, pageWidth - margin, y);
  y += 18;

  // ── Statement identity ──
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...INK);
  y = centredLines(meta.title.toUpperCase(), 14, y);

  if (meta.subtitle) {
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...INK);
    y = centredLines(meta.subtitle, 12, y);
  }

  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK);
  if (meta.periodLine) y = centredLines(meta.periodLine, 12, y);

  doc.setFontSize(7.5).setTextColor(...MUTED);
  if (meta.basisLine) y = centredLines(meta.basisLine, 10, y);
  if (meta.scopeLine) y = centredLines(meta.scopeLine, 10, y);
  if (meta.generatedLine) y = centredLines(meta.generatedLine, 10, y);

  doc.setTextColor(...INK);
  return y + 10;
}
