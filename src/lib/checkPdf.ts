import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { currencyAmountInWords } from "@/lib/numberToWords";
import { loadLogo, type LoadedLogo } from "@/lib/invoicePdf";
import { registerPdfFonts, fontFamilyFor, NOTO_SANS, JETBRAINS_MONO } from "@/lib/pdfFonts";
import {
  NAVY, INK, MUTED, MUTED2, RULE, ALT_ROW, WHITE,
  setText, setDraw, setFill, num, sanitize,
} from "@/lib/pdfTheme";

/**
 * Voucher-style printable check: a check face (payee, amount, words, date,
 * check no, signature line) with a perforated stub below it listing the
 * category lines — matching a real voucher-check layout, one check per
 * page. Vector jsPDF, same "Steel Statement" language as the other
 * documents (invoicePdf.ts / receiptPdf.ts share pdfTheme.ts).
 */

export interface CheckPdfLine {
  description: string | null;
  account_name: string;
  amount: number;
}

export interface CheckPdfModel {
  chequeNumber: string | null;
  printLater: boolean;
  paymentDate: string;
  payeeName: string;
  mailingAddress: string | null;
  memo: string | null;
  bankAccountName: string;
  totalAmount: number;
  currency?: string;
  lines: CheckPdfLine[];
}

interface CompanyInfo {
  company_name?: string | null;
  address?: string | null;
  phone?: string | null;
  tax_id?: string | null;
  logo_url?: string | null;
}

/** Fetch tenant/company info needed on the check face. */
export async function loadCheckPdfCompany(tenantId: string): Promise<CompanyInfo> {
  const { data } = await supabase
    .from("tenants")
    .select("company_name, address, phone, tax_id, logo_url")
    .eq("id", tenantId)
    .maybeSingle();
  return data || {};
}

export async function buildCheckPdf(model: CheckPdfModel, company: CompanyInfo, logo?: LoadedLogo | null): Promise<jsPDF> {
  const cur = model.currency || "LKR";
  const fmt = (n: unknown) => formatCurrency(Number(n) || 0, cur);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 16;
  const right = pageW - M;
  const contentW = right - M;
  const c = company || {};

  const documentText = [
    c.company_name, c.address, model.payeeName, model.mailingAddress, model.memo,
    ...model.lines.map((l) => `${l.account_name} ${l.description ?? ""}`),
  ].filter(Boolean).join(" ");
  await registerPdfFonts(doc, documentText);
  const useFont = (text: string, weight: "normal" | "bold" | "italic" = "normal") => {
    const family = fontFamilyFor(text);
    doc.setFont(family, family === NOTO_SANS ? weight : "normal");
  };
  const useMono = (weight: "normal" | "bold" = "normal") => doc.setFont(JETBRAINS_MONO, weight);

  doc.setProperties({
    title: model.chequeNumber ? `Check ${model.chequeNumber}` : "Check",
    subject: `Check to ${model.payeeName}`,
    author: c.company_name || "",
    creator: c.company_name || "Trish Books",
  });

  // ── Top accent bar ────────────────────────────────────────────────
  setFill(doc, NAVY);
  doc.rect(0, 0, pageW, 3, "F");

  // ── Check face header: company (left) · CHECK + no. (right) ─────────
  const hy = 18;
  let logoBottom = hy;
  if (logo) {
    const ratio = logo.w / logo.h || 1;
    let lh = 20; let lw = ratio * lh;
    if (lw > 50) { lw = 50; lh = lw / ratio; }
    try { doc.addImage(logo.dataUrl, "PNG", M, hy, lw, lh, "company-logo", "FAST"); } catch { /* skip */ }
    logoBottom = hy + lh;
  }
  const cx = M;
  let cy = logo ? logoBottom + 6 : hy + 5;
  if (c.company_name) {
    useFont(String(c.company_name), "bold");
    doc.setFontSize(13);
    setText(doc, INK);
    doc.text(String(c.company_name), cx, cy);
    cy += 5.5;
  }
  doc.setFontSize(8.5);
  setText(doc, MUTED);
  const addrLines = c.address ? String(c.address).split("\n") : [];
  addrLines.forEach((l) => { useFont(l, "normal"); doc.text(l, cx, cy); cy += 4.2; });
  if (c.phone) { useFont(String(c.phone), "normal"); doc.text(String(c.phone), cx, cy); cy += 4.2; }

  useFont("CHECK", "bold");
  doc.setFontSize(15);
  setText(doc, NAVY);
  doc.text("CHECK", right, hy + 5, { align: "right", charSpace: 0.6 });
  useMono("bold");
  doc.setFontSize(12);
  setText(doc, INK);
  const noText = model.printLater ? "To print" : (model.chequeNumber || "—");
  doc.text(noText, right, hy + 13, { align: "right" });

  const headerBottom = Math.max(cy - 2, logoBottom, hy + 13);
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(M, headerBottom + 4, right, headerBottom + 4);

  // ── Date / bank account meta ─────────────────────────────────────────
  let y = headerBottom + 12;
  const dLabelX = right - 70;
  const meta: [string, string][] = [
    ["Date", formatDate(model.paymentDate)],
    ["Bank Account", model.bankAccountName],
  ];
  meta.forEach(([label, value]) => {
    useFont(label, "normal");
    doc.setFontSize(9);
    setText(doc, MUTED);
    doc.text(label, dLabelX, y);
    useMono("bold");
    setText(doc, INK);
    doc.text(value, right, y, { align: "right" });
    y += 6;
  });

  // ── Pay to the order of ───────────────────────────────────────────
  y += 4;
  useFont("PAY TO THE ORDER OF", "bold");
  doc.setFontSize(8.5);
  setText(doc, MUTED2);
  doc.text("PAY TO THE ORDER OF", M, y, { charSpace: 0.35 });
  y += 7;
  useFont(model.payeeName, "bold");
  doc.setFontSize(13);
  setText(doc, INK);
  doc.text(model.payeeName || "—", M, y);
  y += 6;

  // ── Amount hero band ──────────────────────────────────────────────
  y += 4;
  const bandH = 16;
  setFill(doc, NAVY);
  doc.roundedRect(M, y, contentW, bandH, 2, 2, "F");
  useFont("AMOUNT", "bold");
  doc.setFontSize(9);
  setText(doc, WHITE);
  doc.text("AMOUNT", M + 6, y + 10.5, { charSpace: 0.5 });
  useMono("bold");
  doc.setFontSize(15);
  doc.text(fmt(model.totalAmount), right - 6, y + 11, { align: "right" });
  y += bandH + 5;

  // ── Amount in words ────────────────────────────────────────────────
  const words = currencyAmountInWords(model.totalAmount || 0, cur);
  useFont(words, "italic");
  doc.setFontSize(8.5);
  const wordsLines = doc.splitTextToSize(words, contentW - 8);
  const wordsH = wordsLines.length * 4.4 + 5;
  setFill(doc, ALT_ROW); setDraw(doc, RULE); doc.setLineWidth(0.2);
  doc.roundedRect(M, y, contentW, wordsH, 1.5, 1.5, "FD");
  setText(doc, INK);
  doc.text(wordsLines, M + 4, y + 5.8);
  y += wordsH + 8;

  // ── Mailing address (left) + Memo (right), side by side ──────────────
  const colStartY = y;
  const rightColX = M + contentW * 0.6;
  let addrBottom = colStartY;
  if (model.mailingAddress) {
    useFont("ADDRESS", "bold");
    doc.setFontSize(8);
    setText(doc, MUTED2);
    doc.text("ADDRESS", M, colStartY, { charSpace: 0.3 });
    useFont(model.mailingAddress, "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    const addrWrapped = doc.splitTextToSize(model.mailingAddress, contentW * 0.55);
    doc.text(addrWrapped, M, colStartY + 4.5);
    addrBottom = colStartY + 4.5 + addrWrapped.length * 4.2;
  }
  let memoBottom = colStartY;
  if (model.memo) {
    useFont("MEMO", "bold");
    doc.setFontSize(8);
    setText(doc, MUTED2);
    doc.text("MEMO", rightColX, colStartY, { charSpace: 0.3 });
    useFont(model.memo, "normal");
    doc.setFontSize(8.5);
    setText(doc, MUTED);
    const memoWrapped = doc.splitTextToSize(model.memo, contentW * 0.4);
    doc.text(memoWrapped, rightColX, colStartY + 4.5);
    memoBottom = colStartY + 4.5 + memoWrapped.length * 4.2;
  }
  y = Math.max(addrBottom, memoBottom, colStartY) + 10;

  // ── Signature line ────────────────────────────────────────────────
  const sigY = y + 10;
  setDraw(doc, RULE); doc.setLineWidth(0.3);
  doc.line(right - 60, sigY, right, sigY);
  useFont("Authorized signature", "normal");
  doc.setFontSize(8);
  setText(doc, MUTED2);
  doc.text("Authorized signature", right - 30, sigY + 4.5, { align: "center" });

  // ── Perforation ───────────────────────────────────────────────────
  const perfY = sigY + 14;
  setDraw(doc, RULE); doc.setLineWidth(0.5);
  doc.setLineDashPattern([2, 1.5], 0);
  doc.line(0, perfY, pageW, perfY);
  doc.setLineDashPattern([], 0);

  // ── Stub: check no / date / payee + line-item table ──────────────────
  let sy = perfY + 10;
  useFont("CHECK STUB", "bold");
  doc.setFontSize(9);
  setText(doc, MUTED2);
  doc.text("CHECK STUB", M, sy, { charSpace: 0.4 });
  useMono("normal");
  doc.setFontSize(8.5);
  setText(doc, MUTED);
  doc.text(`${noText}  ·  ${formatDate(model.paymentDate)}  ·  ${model.payeeName || "—"}`, right, sy, { align: "right" });
  sy += 6;

  autoTable(doc, {
    startY: sy,
    margin: { left: M, right: M },
    head: [["ACCOUNT", "DESCRIPTION", `AMOUNT (${cur})`]],
    body: model.lines.map((l) => [l.account_name, l.description || "—", num(l.amount)]),
    foot: [["", "Total", num(model.totalAmount)]],
    styles: {
      font: NOTO_SANS, fontSize: 8.5, cellPadding: { top: 3.5, bottom: 3.5, left: 3.5, right: 3.5 },
      textColor: [INK[0], INK[1], INK[2]], lineColor: [RULE[0], RULE[1], RULE[2]], lineWidth: 0, valign: "middle",
    },
    headStyles: {
      fillColor: [NAVY[0], NAVY[1], NAVY[2]], textColor: [WHITE[0], WHITE[1], WHITE[2]],
      fontStyle: "bold", fontSize: 7.5, halign: "left", cellPadding: { top: 4, bottom: 4, left: 3.5, right: 3.5 },
    },
    footStyles: {
      fillColor: [ALT_ROW[0], ALT_ROW[1], ALT_ROW[2]], textColor: [INK[0], INK[1], INK[2]],
      fontStyle: "bold", fontSize: 8.5,
    },
    alternateRowStyles: { fillColor: [ALT_ROW[0], ALT_ROW[1], ALT_ROW[2]] },
    columnStyles: {
      2: { halign: "right", cellWidth: 34, font: JETBRAINS_MONO, fontStyle: "bold" },
    },
    theme: "plain",
  });

  return doc;
}

/** Fetch, render, and trigger a browser download of the check PDF. */
export async function downloadCheckPdf(model: CheckPdfModel, tenantId: string) {
  const company = await loadCheckPdfCompany(tenantId);
  const logo = await loadLogo(company?.logo_url);
  const doc = await buildCheckPdf(model, company, logo);
  doc.save(`Check-${sanitize(model.chequeNumber || "check")}.pdf`);
}

/** Open the generated check PDF in a new tab with the print dialog primed. */
export async function printCheckPdf(model: CheckPdfModel, tenantId: string) {
  const company = await loadCheckPdfCompany(tenantId);
  const logo = await loadLogo(company?.logo_url);
  const doc = await buildCheckPdf(model, company, logo);
  doc.autoPrint();
  const url = doc.output("bloburl");
  window.open(url, "_blank");
}
