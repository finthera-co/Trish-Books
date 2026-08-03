import { exportToCsv } from "@/lib/csvExport";
import { exportToPdf } from "@/lib/pdfExport";
import { computeFingerprint } from "@/lib/reportFingerprint";
import { supabase } from "@/integrations/supabase/client";
import type { TrialBalanceGroupBy } from "@/hooks/useTrialBalance";
import type { TrialBalanceGroupBlock, TrialBalanceGrandTotal } from "@/lib/trialBalanceModel";

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
}

// Bare numbers so Excel parses them — no separators, no parentheses, minus sign preserved.
function num(n: number): string {
  return Math.abs(n) < 0.005 ? "" : n.toFixed(2);
}

export const TRIAL_BALANCE_CSV_HEADERS = ["No", "Ledger Name", "Ledger Opening", "Audit Opening", "Debit", "Credit", "Closing"];

function fingerprintFor(meta: TrialBalanceExportMeta, grand: TrialBalanceGrandTotal) {
  const params = {
    tenantId: meta.tenantId,
    dateFrom: meta.dateFrom,
    dateTo: meta.dateTo,
    groupBy: meta.groupBy,
    includeZero: meta.includeZero,
    includeInactive: meta.includeInactive,
    closing: round2(grand.closing),
    rowCount: meta.rowCount,
  };
  const hash = computeFingerprint(params);
  const balanced = Math.abs(grand.closing) < 0.005;
  return {
    hash,
    line: `TB/${meta.dateFrom}/${meta.dateTo}/${hash} · ${meta.rowCount.toLocaleString("en-US")} rows · Closing ${balanced ? "0.00" : grand.closing.toFixed(2)}`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function logExport(meta: TrialBalanceExportMeta, format: "csv" | "pdf", fingerprint: string, grand: TrialBalanceGrandTotal) {
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
      closing: round2(grand.closing),
    },
  });
}

/** 7-column CSV mirroring the on-screen face. Group headers occupy the Ledger
 * Name cell with numeric cells blank, matching the reference workbook's layout.
 * Pure — split out from exportTrialBalanceCsv so it's testable without Blob/URL
 * download side effects (see the golden-file snapshot test). */
export function buildTrialBalanceCsvRows(
  groups: TrialBalanceGroupBlock[],
  grand: TrialBalanceGrandTotal,
  fingerprintLine: string
): (string | number)[][] {
  const rows: (string | number)[][] = [];

  for (const g of groups) {
    rows.push(["", g.label, "", "", "", "", ""]);
    for (const r of g.rows) {
      rows.push([r.account_code, r.account_name, num(r.ledger_opening), num(r.audit_opening), num(r.period_debit), num(r.period_credit), num(r.closing)]);
    }
    rows.push(["", `Total ${g.label}`, num(g.ledger_opening), num(g.audit_opening), num(g.period_debit), num(g.period_credit), num(g.closing)]);
    rows.push([]);
  }
  rows.push(["", "TOTAL", num(grand.ledger_opening), num(grand.audit_opening), num(grand.period_debit), num(grand.period_credit), num(grand.closing)]);
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
    rows.push([g.label, "", "", "", ""]);
    for (const r of g.rows) {
      rows.push([r.account_name, fmt(r.ledger_opening), fmt(r.audit_opening), fmtDrCr(r.period_debit, r.period_credit), fmt(r.closing)]);
    }
    boldRows.add(rows.length);
    rows.push([`Total ${g.label}`, fmt(g.ledger_opening), fmt(g.audit_opening), fmtDrCr(g.period_debit, g.period_credit), fmt(g.closing)]);
  }
  boldRows.add(rows.length);
  rows.push(["TOTAL", fmt(grand.ledger_opening), fmt(grand.audit_opening), fmtDrCr(grand.period_debit, grand.period_credit), fmt(grand.closing)]);

  const fp = fingerprintFor(meta, grand);

  exportToPdf(
    `trial-balance-${meta.dateFrom}-to-${meta.dateTo}.pdf`,
    "Trial Balance",
    ["Ledger Name", "Ledger Opening", "Audit Opening", "Debit / Credit", "Closing"],
    rows,
    {
      orientation: "landscape",
      subtitle: `${meta.dateFrom} to ${meta.dateTo} · All amounts in LKR`,
      footer: fp.line,
      boldRows,
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    }
  );
  void logExport(meta, "pdf", fp.hash, grand);
}

function fmt(n: number): string {
  if (Math.abs(n) < 0.005) return "";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}

function fmtDrCr(debit: number, credit: number): string {
  const parts = [];
  if (Math.abs(debit) >= 0.005) parts.push(`Dr ${debit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  if (Math.abs(credit) >= 0.005) parts.push(`Cr ${credit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  return parts.join(" / ");
}
