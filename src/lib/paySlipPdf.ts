import { jsPDF } from "jspdf";
import { formatCurrency } from "@/lib/currency";
import { buildPayslipModel, maskAccount, payslipRef } from "@/lib/payslip";
import { amountInWords } from "@/lib/numberToWords";
import type { LoadedLogo } from "@/lib/invoicePdf";

/**
 * Branded, document-grade single-employee payslip PDF.
 * Figures come from buildPayslipModel() — the same source the on-screen
 * PayStub dialog uses, so the two never drift.
 *
 * @param tenant  branding row { company_name, country, registration_number, logo_url }
 * @param logo    pre-loaded logo (use loadLogo(tenant.logo_url) in the caller)
 */

const INK = [17, 24, 39] as const;     // gray-900
const MUTED = [107, 114, 128] as const; // gray-500
const RED = [220, 38, 38] as const;     // red-600
const RULE = [229, 231, 235] as const;  // gray-200
const NETBOX = [238, 242, 255] as const; // indigo-50
const BRAND = [67, 56, 202] as const;   // indigo-700

type RGB = readonly [number, number, number];
const setText = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
const setDraw = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
const setFill = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);

const fmt = (n: unknown) => formatCurrency(Number(n) || 0);
const sanitize = (s: string) => (s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");

export function generatePaySlipPdf(item: any, run: any, tenant?: any, logo?: LoadedLogo | null): void {
  if (!item || !run) throw new Error("Missing pay stub data");

  const emp = item.employees ?? {};
  const fullName = `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || "Employee";
  const model = buildPayslipModel(item);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 20;
  const right = 190;
  let y = 20;

  // ── Header: company (left) · PAYSLIP meta (right) ───────────────
  let leftY = y;
  if (logo) {
    const boxW = 40, boxH = 16;
    const ratio = logo.w / logo.h || 1;
    let dw = boxW, dh = boxW / ratio;
    if (dh > boxH) { dh = boxH; dw = boxH * ratio; }
    doc.addImage(logo.dataUrl, "PNG", left, y - 4, dw, dh);
    leftY = y - 4 + dh + 5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  setText(doc, INK);
  doc.text(tenant?.company_name || "Your Company", left, leftY);
  leftY += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, MUTED);
  if (tenant?.registration_number) { doc.text(`Reg. No: ${tenant.registration_number}`, left, leftY); leftY += 4; }
  if (tenant?.country) { doc.text(String(tenant.country), left, leftY); leftY += 4; }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setText(doc, BRAND);
  doc.text("PAYSLIP", right, y + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, MUTED);
  let metaY = y + 8;
  doc.text(`Ref: ${payslipRef(run, emp)}`, right, metaY, { align: "right" }); metaY += 4;
  doc.text(`Period: ${run.period_start} to ${run.period_end}`, right, metaY, { align: "right" }); metaY += 4;
  if (run.payment_date) { doc.text(`Payment Date: ${run.payment_date}`, right, metaY, { align: "right" }); metaY += 4; }

  y = Math.max(leftY, metaY) + 3;
  setDraw(doc, RULE);
  doc.line(left, y, right, y);
  y += 9;

  // ── Employee block (2 columns) ──────────────────────────────────
  const col2 = 110;
  const infoPair = (x: number, yy: number, label: string, value: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(label.toUpperCase(), x, yy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    setText(doc, INK);
    doc.text(value || "N/A", x, yy + 5);
  };
  infoPair(left, y, "Employee", fullName);
  infoPair(col2, y, "Designation", emp.designation || "N/A");
  y += 13;
  infoPair(left, y, "Employee No.", emp.employee_number || "N/A");
  infoPair(col2, y, "EPF No.", emp.epf_number || "N/A");
  y += 13;
  infoPair(left, y, "Bank Account", maskAccount(emp.bank_account_no));
  infoPair(col2, y, "Payment Method", item.payment_method === "bank_transfer" ? "Bank Transfer" : "Cash");
  y += 16;

  // ── Row helpers ──
  const sectionHeader = (text: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setText(doc, BRAND);
    doc.text(text.toUpperCase(), left, y);
    y += 6;
  };
  const moneyRow = (label: string, value: number, o?: { bold?: boolean; deduction?: boolean; rule?: boolean }) => {
    if (o?.rule) { setDraw(doc, RULE); doc.line(left, y - 3, right, y - 3); }
    doc.setFont("helvetica", o?.bold ? "bold" : "normal");
    doc.setFontSize(11);
    setText(doc, INK);
    doc.text(label, left, y);
    if (o?.deduction) setText(doc, RED);
    doc.text((o?.deduction ? "- " : "") + fmt(value), right, y, { align: "right" });
    y += 6;
  };
  const infoRow = (label: string, valueText: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    doc.text(label, left, y);
    doc.text(valueText, right, y, { align: "right" });
    y += 5;
  };

  // ── Earnings ──
  sectionHeader("Earnings");
  model.earnings.forEach((e) => moneyRow(e.label, e.amount, { deduction: e.deduction }));
  if (model.workedHoursText) infoRow("Worked hours", model.workedHoursText);
  moneyRow("Gross Pay", model.grossPay, { bold: true, rule: true });
  y += 4;

  // ── Deductions ──
  sectionHeader("Deductions");
  model.deductions.forEach((d) => moneyRow(d.label, d.amount, { deduction: true }));
  moneyRow("Total Deductions", model.totalDeductions, { bold: true, deduction: true, rule: true });
  y += 6;

  // ── Net Pay box + in words ──
  setFill(doc, NETBOX);
  doc.rect(left, y - 5, right - left, 12, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setText(doc, BRAND);
  doc.text("Net Pay", left + 3, y + 2.5);
  doc.text(fmt(model.netPay), right - 3, y + 2.5, { align: "right" });
  y += 12;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  setText(doc, MUTED);
  doc.text(amountInWords(model.netPay, "Rupees"), left, y);
  y += 10;

  // ── Employer contributions ──
  setDraw(doc, RULE);
  doc.line(left, y - 4, right, y - 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text("EMPLOYER CONTRIBUTIONS (NOT DEDUCTED FROM SALARY)", left, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, MUTED);
  doc.text("EPF (12%)", left, y);
  doc.text(fmt(model.employerEpf), right, y, { align: "right" });
  y += 5;
  doc.text("ETF (3%)", left, y);
  doc.text(fmt(model.employerEtf), right, y, { align: "right" });

  // ── Footer ──
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text(`Generated ${new Date().toLocaleString()}`, left, 287);
  doc.text("This is a computer-generated payslip.", right, 287, { align: "right" });

  const filename = `payslip-${sanitize(fullName)}-${sanitize(run.run_number ?? "")}.pdf`.replace(/-+\.pdf$/, ".pdf");
  doc.save(filename);
}
