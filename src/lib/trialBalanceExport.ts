import { exportToCsv } from "@/lib/csvExport";
import { exportToPdf } from "@/lib/pdfExport";
import { computeFingerprint } from "@/lib/reportFingerprint";
import { generatedSentence, periodSentence, type StatementHeadingCompany } from "@/lib/reportHeading";
import { supabase } from "@/integrations/supabase/client";
import type { TrialBalanceGroupBy } from "@/hooks/useTrialBalance";
import {
  openingSplit, closingSplit, closingDifference,
  type TrialBalanceGroupBlock, type TrialBalanceGrandTotal,
} from "@/lib/trialBalanceModel";

export type { TrialBalanceGroupBlock, TrialBalanceGrandTotal } from "@/lib/trialBalanceModel";

export interface TrialBalanceExportMeta {
  tenantId: string;
  userId: string | undefined;
  dateFrom: string;
  dateTo: string;
  groupBy: TrialBalanceGroupBy;
  includeZero: boolean;
  includeInactive: boolean;
  rowCount: number;
  /** Entity identity for the PDF's statutory heading. */
  company?: StatementHeadingCompany;
  preparedBy?: string;
}

/** Reader-facing names for the grouping — mirrors the on-screen masthead. */
const GROUP_BY_LABELS: Record<TrialBalanceGroupBy, string> = {
  parent: "Parent Account",
  category: "Category",
  type: "Account Type",
};

// Bare numbers so Excel parses them — no separators, no parentheses, minus sign preserved.
function num(n: number): string {
  return Math.abs(n) < 0.005 ? "" : n.toFixed(2);
}

export const TRIAL_BALANCE_CSV_HEADERS = [
  "No", "Ledger Name",
  "Opening Debit", "Opening Credit",
  "Transaction Debit", "Transaction Credit",
  "Closing Debit", "Closing Credit",
];

export function fingerprintFor(meta: TrialBalanceExportMeta, grand: TrialBalanceGrandTotal) {
  const diff = closingDifference(grand);
  const params = {
    tenantId: meta.tenantId,
    dateFrom: meta.dateFrom,
    dateTo: meta.dateTo,
    groupBy: meta.groupBy,
    includeZero: meta.includeZero,
    includeInactive: meta.includeInactive,
    closingDebit: round2(grand.closing_debit),
    closingCredit: round2(grand.closing_credit),
    rowCount: meta.rowCount,
  };
  const hash = computeFingerprint(params);
  const balanced = Math.abs(diff) < 0.005;
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    hash,
    line:
      `TB/${meta.dateFrom}/${meta.dateTo}/${hash} · ${meta.rowCount.toLocaleString("en-US")} rows · ` +
      `Closing Dr ${money(grand.closing_debit)} ${balanced ? "=" : "≠"} Cr ${money(grand.closing_credit)}`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function logExport(
  meta: TrialBalanceExportMeta,
  format: "csv" | "pdf" | "xlsx",
  fingerprint: string,
  grand: TrialBalanceGrandTotal
) {
  await supabase.from("audit_logs").insert({
    action: "Trial Balance Exported",
    table_name: "accounts",
    record_id: null,
    user_id: meta.userId,
    tenant_id: meta.tenantId,
    details: {
      format,
      date_from: meta.dateFrom,
      date_to: meta.dateTo,
      group_by: meta.groupBy,
      fingerprint,
      row_count: meta.rowCount,
      closing_debit: round2(grand.closing_debit),
      closing_credit: round2(grand.closing_credit),
    },
  });
}

/** 8-column CSV mirroring the on-screen face: an opening debit/credit pair, the
 * period's movement, and a closing debit/credit pair. Group headers occupy the
 * Ledger Name cell with numeric cells blank, matching the reference workbook's
 * layout. Pure — split out from exportTrialBalanceCsv so it's testable without
 * Blob/URL download side effects (see the golden-file snapshot test). */
export function buildTrialBalanceCsvRows(
  groups: TrialBalanceGroupBlock[],
  grand: TrialBalanceGrandTotal,
  fingerprintLine: string
): (string | number)[][] {
  const rows: (string | number)[][] = [];

  for (const g of groups) {
    rows.push(["", g.label, "", "", "", "", "", ""]);
    for (const r of g.rows) {
      const open = openingSplit(r);
      const close = closingSplit(r);
      rows.push([
        r.account_code, r.account_name,
        num(open.debit), num(open.credit),
        num(r.period_debit), num(r.period_credit),
        num(close.debit), num(close.credit),
      ]);
    }
    rows.push([
      "", `Total ${g.label}`,
      num(g.opening_debit), num(g.opening_credit),
      num(g.period_debit), num(g.period_credit),
      num(g.closing_debit), num(g.closing_credit),
    ]);
    rows.push([]);
  }
  rows.push([
    "", "TOTAL",
    num(grand.opening_debit), num(grand.opening_credit),
    num(grand.period_debit), num(grand.period_credit),
    num(grand.closing_debit), num(grand.closing_credit),
  ]);
  rows.push([]);
  rows.push([fingerprintLine]);
  return rows;
}

export function exportTrialBalanceCsv(groups: TrialBalanceGroupBlock[], grand: TrialBalanceGrandTotal, meta: TrialBalanceExportMeta) {
  const fp = fingerprintFor(meta, grand);
  exportToCsv(`trial-balance-${meta.dateFrom}-to-${meta.dateTo}.csv`, TRIAL_BALANCE_CSV_HEADERS, buildTrialBalanceCsvRows(groups, grand, fp.line));
  void logExport(meta, "csv", fp.hash, grand);
}

export function exportTrialBalancePdf(groups: TrialBalanceGroupBlock[], grand: TrialBalanceGrandTotal, meta: TrialBalanceExportMeta) {
  const rows: (string | number)[][] = [];
  const boldRows = new Set<number>();

  for (const g of groups) {
    boldRows.add(rows.length);
    rows.push([g.label, "", "", "", "", "", ""]);
    for (const r of g.rows) {
      const open = openingSplit(r);
      const close = closingSplit(r);
      rows.push([r.account_name, fmt(open.debit), fmt(open.credit), fmt(r.period_debit), fmt(r.period_credit), fmt(close.debit), fmt(close.credit)]);
    }
    boldRows.add(rows.length);
    rows.push([
      `Total ${g.label}`,
      fmt(g.opening_debit), fmt(g.opening_credit),
      fmt(g.period_debit), fmt(g.period_credit),
      fmt(g.closing_debit), fmt(g.closing_credit),
    ]);
  }
  boldRows.add(rows.length);
  rows.push([
    "TOTAL",
    fmt(grand.opening_debit), fmt(grand.opening_credit),
    fmt(grand.period_debit), fmt(grand.period_credit),
    fmt(grand.closing_debit), fmt(grand.closing_credit),
  ]);

  const fp = fingerprintFor(meta, grand);

  exportToPdf(
    `trial-balance-${meta.dateFrom}-to-${meta.dateTo}.pdf`,
    "Trial Balance",
    ["Ledger Name", "Opening Dr", "Opening Cr", "Debit", "Credit", "Closing Dr", "Closing Cr"],
    rows,
    {
      orientation: "landscape",
      footer: fp.line,
      boldRows,
      heading: {
        ...meta.company,
        periodLine: periodSentence(meta.dateFrom, meta.dateTo),
        basisLine: "Accrual basis  ·  All amounts in LKR",
        scopeLine:
          `Grouped by ${GROUP_BY_LABELS[meta.groupBy]}  ·  ` +
          `Zero-balance accounts ${meta.includeZero ? "included" : "excluded"}  ·  ` +
          `Inactive accounts ${meta.includeInactive ? "included" : "excluded"}`,
        generatedLine: generatedSentence(meta.preparedBy),
      },
      columnStyles: {
        1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" },
        4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" },
      },
    }
  );
  void logExport(meta, "pdf", fp.hash, grand);
}

function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return "";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}
