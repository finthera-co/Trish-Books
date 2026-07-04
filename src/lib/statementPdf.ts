import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency } from "@/lib/currency";
import { loadLogo, type LoadedLogo } from "@/lib/invoicePdf";
import type { CustomerStatement } from "@/hooks/useCustomerStatement";

const INK = [17, 24, 39] as const;
const MUTED = [107, 114, 128] as const;
const RULE = [229, 231, 235] as const;
const SLATE = [45, 55, 72] as const;
const RED = [220, 38, 38] as const;
const GREEN = [22, 163, 74] as const;
const WHITE = [255, 255, 255] as const;

export interface StatementDocInput {
  stmt: CustomerStatement;
  customer: any;
  company: any;
  from: string;
  to: string;
}

/** Render a customer statement of account to a jsPDF document (base currency: LKR). */
export function buildStatementPdf({ stmt, customer, company, from, to }: StatementDocInput, logo?: LoadedLogo | null): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 16;
  const right = pageW - M;
  const t: any = company || {};
  const fmt = (n: unknown) => formatCurrency(Number(n) || 0);

  // ── Header: logo + company (left), title (right) ──
  let cx = M;
  let logoBottom = M;
  if (logo) {
    const lh = 16, lw = Math.min((logo.w / logo.h || 1) * lh, 40);
    try { doc.addImage(logo.dataUrl, "PNG", M, M, lw, lh); } catch { /* skip */ }
    cx = M + lw + 5; logoBottom = M + lh;
  }
  let cy = M + 5;
  if (t.company_name) {
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...INK);
    doc.text(String(t.company_name), cx, cy); cy += 5.5;
  }
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
  for (const l of [t.address, t.phone, t.tax_id ? `TIN: ${t.tax_id}` : null]) {
    if (!l) continue;
    for (const line of String(l).split("\n")) { doc.text(line, cx, cy); cy += 4.2; }
  }
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(90, 96, 104);
  doc.text("STATEMENT", right, M + 6, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  doc.text(`${from}  to  ${to}`, right, M + 12, { align: "right" });

  let y = Math.max(cy, logoBottom) + 4;
  doc.setDrawColor(...RULE).setLineWidth(0.3).line(M, y, right, y);
  y += 8;

  // ── Statement for ──
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...SLATE);
  doc.text("STATEMENT FOR", M, y);
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK);
  doc.text(String(customer?.legal_name || customer?.name || "—"), M, y + 6);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  let ay = y + 11;
  for (const l of [customer?.address, customer?.email].filter(Boolean)) {
    for (const line of String(l).split("\n")) { doc.text(line, M, ay); ay += 4.2; }
  }
  // Closing balance highlight (right)
  doc.setFillColor(243, 244, 246).roundedRect(right - 62, y - 1, 62, 14, 1.5, 1.5, "F");
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
  doc.text("Balance due (LKR)", right - 3, y + 4, { align: "right" });
  doc.setFont("helvetica", "bold").setFontSize(13);
  const cb = stmt.closing_balance > 0.005 ? RED : GREEN;
  doc.setTextColor(cb[0], cb[1], cb[2]);
  doc.text(fmt(stmt.closing_balance), right - 3, y + 10.5, { align: "right" });

  y = Math.max(ay, y + 16) + 4;

  // ── Ledger table ──
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["Date", "Type", "Reference", "Debit", "Credit", "Balance"]],
    body: [
      ["", "Opening balance", "", "", "", fmt(stmt.opening_balance)],
      ...stmt.rows.map((r) => [
        r.date, r.kind, r.reference,
        r.debit ? fmt(r.debit) : "—",
        r.credit ? fmt(r.credit) : "—",
        fmt(r.balance),
      ]),
    ],
    foot: [["", "Closing balance", "", "", "", fmt(stmt.closing_balance)]],
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 2.6, bottom: 2.6, left: 3, right: 3 }, textColor: INK as any, lineColor: RULE as any, lineWidth: 0 },
    headStyles: { fillColor: SLATE as any, textColor: WHITE as any, fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [243, 244, 246] as any, textColor: INK as any, fontStyle: "bold", fontSize: 9 },
    alternateRowStyles: { fillColor: [250, 250, 251] as any },
    columnStyles: {
      0: { cellWidth: 24 }, 1: { cellWidth: 26 }, 2: { cellWidth: "auto" },
      3: { halign: "right", cellWidth: 26 }, 4: { halign: "right", cellWidth: 26 }, 5: { halign: "right", cellWidth: 28, fontStyle: "bold" },
    },
    theme: "plain",
  });

  // ── Aging summary ──
  let ay2 = (doc as any).lastAutoTable.finalY + 10;
  const a = stmt.aging;
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...SLATE);
  doc.text("OUTSTANDING BY AGE", M, ay2);
  ay2 += 5;
  const buckets: [string, number][] = [
    ["Current", a.current], ["1–30", a.d1_30], ["31–60", a.d31_60], ["61–90", a.d61_90], ["90+", a.d90_plus],
  ];
  const bw = (right - M) / 5;
  buckets.forEach(([label, val], i) => {
    const bx = M + i * bw;
    doc.setDrawColor(...RULE).setLineWidth(0.2).roundedRect(bx, ay2, bw - 3, 13, 1.5, 1.5, "D");
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    doc.text(label, bx + (bw - 3) / 2, ay2 + 5, { align: "center" });
    doc.setFont("helvetica", "bold").setFontSize(9);
    const vc = val > 0 && label !== "Current" ? RED : INK;
    doc.setTextColor(vc[0], vc[1], vc[2]);
    doc.text(fmt(val), bx + (bw - 3) / 2, ay2 + 10, { align: "center" });
  });

  const fy = doc.internal.pageSize.getHeight() - 12;
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
  doc.text("All amounts in LKR. Please remit the balance due by the dates shown.", M, fy);
  return doc;
}

export async function downloadStatementPdf(input: StatementDocInput) {
  const logo = await loadLogo(input.company?.logo_url);
  const doc = buildStatementPdf(input, logo);
  doc.save(`Statement-${(input.customer?.name || "customer").replace(/[^a-z0-9]+/gi, "-")}-${input.to}.pdf`);
}

export async function printStatementPdf(input: StatementDocInput) {
  const logo = await loadLogo(input.company?.logo_url);
  const doc = buildStatementPdf(input, logo);
  doc.autoPrint();
  window.open(doc.output("bloburl"), "_blank");
}
