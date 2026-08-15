import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as formatDate, parseISO } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportToCsv } from "@/lib/csvExport";
import { fmtAmt, fmtBal, GL_DATE_FORMAT, type GLReportRow } from "@/lib/glReportModel";
import {
  drawStatementHeading, generatedSentence, periodSentence, type StatementHeadingCompany,
} from "@/lib/reportHeading";

// djb2 — a reproducibility label, not a security control, so a small synchronous
// hash is the right tool: no reason to reach for crypto.subtle and make this async.
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface GlFingerprintParams {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  accountType: string | null;
  includeZeroActivity: boolean;
  includeOtherRows: boolean;
  includeInactive: boolean;
  grandDebit: number;
  grandCredit: number;
  rowCount: number;
}

export function computeGlFingerprint(p: GlFingerprintParams): string {
  const keys = Object.keys(p).sort() as (keyof GlFingerprintParams)[];
  const canonical = JSON.stringify(p, keys as string[]);
  return djb2(canonical);
}

export function formatGlFingerprintLine(p: GlFingerprintParams, hash: string): string {
  const balanced = Math.abs(p.grandDebit - p.grandCredit) < 0.005;
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `GL/${p.dateFrom}/${p.dateTo}/${hash} · ${p.rowCount.toLocaleString("en-US")} rows · Dr ${money(p.grandDebit)} ${balanced ? "=" : "≠"} Cr ${money(p.grandCredit)}`;
}

function formatGlDate(iso: string): string {
  try {
    return formatDate(parseISO(iso), GL_DATE_FORMAT);
  } catch {
    return iso;
  }
}

function csvAmt(n?: number | null): string {
  return n ? n.toFixed(2) : "";
}

// Balance always renders, including exact zero — CSV uses a bare minus sign
// (not parentheses) so Excel parses the cell as a real negative number.
function csvBal(n?: number | null): string {
  return n == null ? "" : n.toFixed(2);
}

const BLANK_DATA_COLS = 11; // Type, Date, blank, Num, Adj, Name, Memo, Split, Debit, Credit, Balance

/**
 * 17 physical columns reproducing the QuickBooks reference's raw layout:
 * columns 0-5 are the indent tree (label sits in column min(depth,5)), then
 * Type/Date/blank/Num/Adj/Name/Memo/Split/Debit/Credit/Balance.
 */
export const GL_CSV_HEADERS = ["", "", "", "", "", "", "Type", "Date", "", "Num", "Adj", "Name", "Memo", "Split", "Debit", "Credit", "Balance"];

/**
 * Pure row-building step, split out from exportGeneralLedgerCsv so it's
 * testable without touching Blob/URL download side effects — this is what the
 * golden-file snapshot test guards against silent regressions in column order,
 * indent depth, or sign convention.
 */
export function buildGlCsvRows(
  rows: readonly GLReportRow[],
  meta: { fingerprintLine: string; warnings: readonly string[] }
): (string | number)[][] {
  const csvRows: (string | number)[][] = rows.map((r) => {
    const indent = new Array(6).fill("");
    if (r.kind === "txn") {
      const t = r.txn;
      const data =
        r.isLoadingTxns || !t
          ? (new Array(BLANK_DATA_COLS).fill("") as string[])
          : [
              t.txn_type,
              formatGlDate(t.entry_date),
              "",
              t.num,
              t.is_adjusting ? "√" : "",
              t.entity_name,
              t.memo,
              t.split_text,
              csvAmt(t.debit),
              csvAmt(t.credit),
              csvBal(t.running_balance),
            ];
      return [...indent, ...data];
    }

    indent[Math.min(r.depth, 5)] = r.label ?? "";
    // Type, Date, blank, Num, Adj, Name, Memo, Split — 8 blanks, matching the txn
    // row's column count exactly so Debit/Credit/Balance land in the same columns.
    const data = ["", "", "", "", "", "", "", "", csvAmt(r.debit), csvAmt(r.credit), csvBal(r.balance)];
    return [...indent, ...data];
  });

  csvRows.push([]);
  csvRows.push([meta.fingerprintLine]);
  for (const w of meta.warnings) csvRows.push([w]);

  return csvRows;
}

export function exportGeneralLedgerCsv(
  rows: readonly GLReportRow[],
  meta: { dateFrom: string; dateTo: string; fingerprintLine: string; warnings: string[] }
) {
  exportToCsv(`general-ledger-${meta.dateFrom}-to-${meta.dateTo}.csv`, GL_CSV_HEADERS, buildGlCsvRows(rows, meta));
}

const PDF_CHUNK_SIZE = 2000;
const PDF_PROGRESS_TOAST_THRESHOLD = 5000;
const BOLD_ROW_KINDS = new Set(["account-header", "account-total", "grand-total"]);

/**
 * Landscape A4, vector text (no html2canvas), column header repeated per chunk
 * (autoTable repeats `head` within each call and across the pages that call
 * spans). Above PDF_PROGRESS_TOAST_THRESHOLD rows, the table is built across
 * several autoTable() calls on the same doc with a setTimeout(0) yield between
 * them and a progress toast, so a 30k-row export doesn't freeze the tab for
 * the several seconds a single synchronous autoTable call would otherwise take.
 *
 * jsPDF's standard fonts are WinAnsi-only, which excludes "√" — the Adj
 * column falls back to "Y" here (screen/CSV keep the real glyph).
 */
export async function exportGeneralLedgerPdf(
  rows: readonly GLReportRow[],
  meta: {
    dateFrom: string;
    dateTo: string;
    fingerprintLine: string;
    currency: string;
    /** Entity identity for the statutory heading. */
    company?: StatementHeadingCompany;
    /** What the export was narrowed to, so the figures can be reproduced. */
    scopeLine?: string;
    subtitle?: string | null;
    preparedBy?: string;
  }
): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  const headingBottom = drawStatementHeading(doc, {
    ...meta.company,
    title: "General Ledger",
    subtitle: meta.subtitle,
    periodLine: periodSentence(meta.dateFrom, meta.dateTo),
    basisLine: `Accrual basis  ·  All amounts in ${meta.currency}`,
    scopeLine: meta.scopeLine,
    generatedLine: generatedSentence(meta.preparedBy),
  }, margin);

  const headers = ["Account", "Type", "Date", "Num", "Adj", "Name", "Memo", "Split", "Debit", "Credit", "Balance"];
  const columnStyles = {
    8: { halign: "right" as const },
    9: { halign: "right" as const },
    10: { halign: "right" as const },
  };

  const toBody = (r: GLReportRow): string[] => {
    if (r.kind === "txn") {
      const t = r.txn;
      if (r.isLoadingTxns || !t) return new Array(11).fill("");
      return [
        "",
        t.txn_type,
        formatGlDate(t.entry_date),
        t.num,
        t.is_adjusting ? "Y" : "",
        t.entity_name,
        t.memo,
        t.split_text,
        fmtAmt(t.debit),
        fmtAmt(t.credit),
        fmtBal(t.running_balance),
      ];
    }
    const indent = "  ".repeat(Math.max(0, r.depth - 1));
    return ["", "", "", "", "", "", "", "", fmtAmt(r.debit), fmtAmt(r.credit), fmtBal(r.balance)].map((v, i) =>
      i === 0 ? indent + (r.label ?? "") : v
    );
  };

  const totalChunks = Math.max(1, Math.ceil(rows.length / PDF_CHUNK_SIZE));
  const showProgress = rows.length > PDF_PROGRESS_TOAST_THRESHOLD;
  const toastId = showProgress ? toast.loading(`Building PDF… 0 / ${rows.length.toLocaleString()} rows`) : undefined;

  let startY = headingBottom;
  for (let i = 0; i < totalChunks; i++) {
    const chunk = rows.slice(i * PDF_CHUNK_SIZE, (i + 1) * PDF_CHUNK_SIZE);
    autoTable(doc, {
      head: [headers],
      body: chunk.map(toBody),
      startY,
      margin: { left: margin, right: margin, bottom: margin },
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [34, 197, 94], textColor: 255, fontSize: 7.5 },
      columnStyles,
      didParseCell: (data) => {
        if (data.section === "body" && BOLD_ROW_KINDS.has(chunk[data.row.index]?.kind)) {
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    startY = ((doc as any).lastAutoTable?.finalY ?? startY) + 10;
    if (toastId != null) {
      const done = Math.min((i + 1) * PDF_CHUNK_SIZE, rows.length);
      toast.loading(`Building PDF… ${done.toLocaleString()} / ${rows.length.toLocaleString()} rows`, { id: toastId });
    }
    if (i < totalChunks - 1) await new Promise((r) => setTimeout(r, 0));
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(meta.fingerprintLine, margin, pageHeight - 18);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 18, { align: "right" });
    doc.setTextColor(0);
  }

  doc.save(`general-ledger-${meta.dateFrom}-to-${meta.dateTo}.pdf`);
  if (toastId != null) toast.success(`PDF ready — ${rows.length.toLocaleString()} rows`, { id: toastId });
}

/** Exports are audited; renders are not — logging every render would bury real events in noise. */
export async function logGlExport(params: {
  tenantId: string;
  userId: string | undefined;
  format: "csv" | "pdf";
  dateFrom: string;
  dateTo: string;
  fingerprint: string;
  rowCount: number;
  grandDebit: number;
  grandCredit: number;
}) {
  await supabase.from("audit_logs").insert({
    action: "General Ledger Exported",
    table_name: "journal_entries",
    record_id: null,
    user_id: params.userId,
    tenant_id: params.tenantId,
    details: {
      format: params.format,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      fingerprint: params.fingerprint,
      row_count: params.rowCount,
      grand_debit: params.grandDebit,
      grand_credit: params.grandCredit,
    },
  });
}
