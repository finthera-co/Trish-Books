import { exportToCsv } from "@/lib/csvExport";
import { exportToPdf } from "@/lib/pdfExport";
import { computeFingerprint } from "@/lib/reportFingerprint";
import { supabase } from "@/integrations/supabase/client";
import type { FsStatementLine } from "@/hooks/useFinancialStatements";

export interface FsExportMeta {
  tenantId: string;
  userId: string | undefined;
  statementCode: string;
  title: string;
  periodCaption?: string;
  dateFrom: string;
  dateTo: string;
  /** Coverage warnings/errors in force — an export that drops these is how a
   * known-bad number reaches a board pack. */
  warnings: string[];
  ackNote?: string;
  footerNotes: string[];
}

function csvAmt(n: number | null | undefined, blankZero: boolean): string {
  if (n == null) return "";
  if (blankZero && Math.abs(n) < 0.005) return "";
  return n.toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fingerprintFor(meta: FsExportMeta, lines: FsStatementLine[]) {
  const profitLine = lines.find((l) => l.line_code === "PROFIT_FOR_YEAR");
  const params = {
    tenantId: meta.tenantId,
    statementCode: meta.statementCode,
    dateFrom: meta.dateFrom,
    dateTo: meta.dateTo,
    lineCount: lines.length,
    bottomLine: profitLine ? round2(profitLine.current_value ?? 0) : null,
  };
  const hash = computeFingerprint(params);
  return {
    hash,
    line: `${meta.statementCode}/${meta.dateFrom}/${meta.dateTo}/${hash}${profitLine ? ` · Profit for the year ${(profitLine.current_value ?? 0).toFixed(2)}` : ""}`,
  };
}

async function logExport(meta: FsExportMeta, format: "csv" | "pdf", fingerprint: string, lines: FsStatementLine[]) {
  const profitLine = lines.find((l) => l.line_code === "PROFIT_FOR_YEAR");
  await supabase.from("audit_logs").insert({
    action: "Financial Statement Exported",
    table_name: "fs_statements",
    record_id: null,
    user_id: meta.userId,
    tenant_id: meta.tenantId,
    details: {
      format,
      statement_code: meta.statementCode,
      date_from: meta.dateFrom,
      date_to: meta.dateTo,
      fingerprint,
      profit_for_year: profitLine ? round2(profitLine.current_value ?? 0) : null,
      coverage_warning_count: meta.warnings.length,
      acknowledged: !!meta.ackNote,
    },
  });
}

export const SOCI_CSV_HEADERS = ["Label", "Note", "Current", "Comparative", "Current Margin %", "Comparative Margin %"];

/** Label, Note, Current, Comparative, Current Margin %, Comparative Margin %.
 * Pure — split out from exportSociCsv so it's testable without Blob/URL
 * download side effects (see the golden-file snapshot test). */
export function buildSociCsvRows(
  lines: FsStatementLine[],
  fingerprintLine: string,
  ackNote: string | undefined,
  warnings: readonly string[]
): (string | number)[][] {
  const rows: (string | number)[][] = lines
    .filter((l) => l.line_type !== "spacer")
    .map((l) => [
      l.label,
      l.note_ref ?? "",
      csvAmt(l.current_value, l.line_type === "detail"),
      csvAmt(l.compare_value, l.line_type === "detail"),
      l.show_margin ? csvAmt(l.current_margin, false) : "",
      l.show_margin ? csvAmt(l.compare_margin, false) : "",
    ]);

  rows.push([]);
  rows.push([fingerprintLine]);
  if (ackNote) rows.push([ackNote]);
  for (const w of warnings) rows.push([w]);
  return rows;
}

export function exportSociCsv(lines: FsStatementLine[], meta: FsExportMeta) {
  const fp = fingerprintFor(meta, lines);
  exportToCsv(
    `statement-of-comprehensive-income-${meta.dateFrom}-to-${meta.dateTo}.csv`,
    SOCI_CSV_HEADERS,
    buildSociCsvRows(lines, fp.line, meta.ackNote, meta.warnings)
  );
  void logExport(meta, "csv", fp.hash, lines);
}

function pdfAmt(n: number | null | undefined, blankZero: boolean): string {
  if (n == null) return "";
  if (blankZero && Math.abs(n) < 0.005) return "";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < -0.005 ? `(${s})` : s;
}

function pdfEps(n: number | null | undefined): string {
  if (n == null) return "";
  const s = Math.abs(n).toFixed(2);
  return n < -0.005 ? `(${s})` : s;
}

/** Portrait A4, centred to match the reference's statutory face. Vector text only. */
export function exportSociPdf(lines: FsStatementLine[], meta: FsExportMeta) {
  const headers = ["", "Note", "Current", "Comparative", "Margin %", "Cmp Margin %"];
  const boldRows = new Set<number>();
  const bodyLines = lines.filter((l) => l.line_type !== "spacer");
  const rows = bodyLines.map((l, i) => {
    if (l.emphasis === "bold_rule" || l.emphasis === "total_rule" || l.emphasis === "bold") boldRows.add(i);
    const isEps = l.line_type === "per_share";
    return [
      l.label,
      l.note_ref ?? "",
      isEps ? pdfEps(l.current_value) : pdfAmt(l.current_value, l.line_type === "detail"),
      isEps ? pdfEps(l.compare_value) : pdfAmt(l.compare_value, l.line_type === "detail"),
      l.show_margin ? (l.current_margin?.toFixed(2) ?? "") : "",
      l.show_margin ? (l.compare_margin?.toFixed(2) ?? "") : "",
    ];
  });

  const fp = fingerprintFor(meta, lines);
  const footer = [fp.line, meta.ackNote, ...meta.warnings, ...meta.footerNotes].filter(Boolean).join(" · ");

  exportToPdf(
    `statement-of-comprehensive-income-${meta.dateFrom}-to-${meta.dateTo}.pdf`,
    meta.title,
    headers,
    rows,
    {
      orientation: "portrait",
      subtitle: `${meta.periodCaption ?? "For the Year Ended"} · ${meta.dateFrom} to ${meta.dateTo}`,
      footer,
      boldRows,
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    }
  );
  void logExport(meta, "pdf", fp.hash, lines);
}
