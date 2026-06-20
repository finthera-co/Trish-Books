import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_TABLE_SETTINGS, DEFAULT_PAGE_SETTINGS } from "@/components/invoice-designer/templateDefaults";
import { formatCurrency } from "@/lib/currency";
import type {
  DesignerComponent,
  TableSettings,
  PageSettings,
  InvoiceData,
} from "@/components/invoice-designer/types";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

interface LoadResult {
  components: DesignerComponent[];
  tableSettings: TableSettings;
  pageSettings: PageSettings;
  data: InvoiceData;
}

export async function loadInvoiceForDownload(invoiceId: string, tenantId: string): Promise<LoadResult> {
  // Invoice + customer + items
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*, customers(*), invoice_items(*)")
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) throw new Error(invErr?.message || "Invoice not found");

  // Resolve template: invoice.template_id -> tenant default -> first -> built-in defaults
  let template: any = null;
  const tplId = (invoice as any).template_id;
  if (tplId) {
    const { data } = await supabase.from("invoice_templates").select("*").eq("id", tplId).maybeSingle();
    template = data;
  }
  if (!template) {
    const { data } = await supabase
      .from("invoice_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .maybeSingle();
    template = data;
  }
  if (!template) {
    const { data } = await supabase
      .from("invoice_templates")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    template = data;
  }

  const components = (template?.layout_json as DesignerComponent[]) || [];
  const tableSettings = (template?.table_settings as TableSettings) || DEFAULT_TABLE_SETTINGS;
  const pageSettings = (template?.page_settings as PageSettings) || DEFAULT_PAGE_SETTINGS;

  // Tenant info
  const { data: tenant } = await supabase
    .from("tenants")
    .select("company_name, country")
    .eq("id", tenantId)
    .maybeSingle();

  const customer: any = invoice.customers || {};
  const items = ((invoice as any).invoice_items || []).map((it: any) => ({
    item: it.description || "",
    description: it.description || "",
    qty: Number(it.quantity || 0),
    unit: "",
    rate: Number(it.unit_price || 0),
    discount: 0,
    tax: 0,
    amount: Number(it.total || 0),
  }));

  const data: InvoiceData = {
    company_name: tenant?.company_name || "",
    company_address: "",
    company_phone: "",
    company_email: "",
    company_tax_number: "",
    customer_name: customer.name || "",
    customer_address: customer.address || "",
    customer_phone: customer.phone || "",
    customer_email: customer.email || "",
    customer_tax_id: "",
    invoice_title: "INVOICE",
    invoice_number: (invoice as any).invoice_number || "",
    invoice_date: (invoice as any).issue_date || "",
    due_date: (invoice as any).due_date || "",
    payment_terms: customer.payment_terms || "",
    salesperson: "",
    reference_number: "",
    items,
    subtotal: Number((invoice as any).subtotal || 0),
    discount: Number((invoice as any).discount_amount || 0),
    tax: Number((invoice as any).tax_amount || 0),
    shipping: 0,
    adjustment: 0,
    total: Number((invoice as any).total_amount || 0),
    paid_amount: Number((invoice as any).amount_paid || 0),
    balance_due: Number((invoice as any).balance_due || 0),
    notes: (invoice as any).notes || "",
    terms: "",
    bank_details: "",
    currency: "LKR",
  };

  return { components, tableSettings, pageSettings, data };
}

function resolveBinding(comp: DesignerComponent, data: InvoiceData): string {
  if (!comp.binding) return comp.defaultValue || comp.label;
  const val = (data as any)[comp.binding];
  if (val === undefined || val === null) return comp.defaultValue || "";
  if (typeof val === "number") {
    if (["subtotal", "discount", "tax", "shipping", "adjustment", "total", "paid_amount", "balance_due"].includes(comp.binding)) {
      return formatCurrency(val);
    }
    return String(val);
  }
  return String(val);
}

function renderInvoiceHtml({ components, tableSettings, pageSettings, data }: LoadResult): HTMLDivElement {
  // Match designer canvas: 595x842 (A4 in CSS px). Designer uses these exact dims with no padding,
  // so children x/y are page-absolute. We translate them by pageSettings.margins to respect printable area.
  const CANVAS_W = 595;
  const CANVAS_H = 842;
  const COL_W = 45;
  const ROW_H = 24;
  const m = pageSettings.margins || { top: 0, right: 0, bottom: 0, left: 0 };
  // Convert margin "points" (designer units) to CSS px 1:1 — designer stores px-equivalent.
  // Cap to keep content on page.
  const mLeft = Math.max(0, Math.min(m.left || 0, 80));
  const mTop = Math.max(0, Math.min(m.top || 0, 80));
  const mRight = Math.max(0, Math.min(m.right || 0, 80));
  const innerW = CANVAS_W - mLeft - mRight;

  const sorted = [...components].sort((a, b) => a.y - b.y || a.x - b.x);
  const visibleCols = tableSettings.columns.filter((c) => c.visible);

  const root = document.createElement("div");
  root.style.cssText = `width:${CANVAS_W}px;min-height:${CANVAS_H}px;position:relative;background:#fff;font-family:sans-serif;`;

  for (const comp of sorted) {
    // Translate by margin so content respects printable area
    const left = mLeft + comp.x * COL_W;
    const top = mTop + comp.y * ROW_H;
    let width = comp.w * COL_W;
    const height = comp.h * ROW_H;
    // Clamp width so it doesn't overflow right margin
    if (left + width > CANVAS_W - mRight) width = Math.max(20, CANVAS_W - mRight - left);

    if (comp.type === "divider") {
      const d = document.createElement("div");
      d.style.cssText = `position:absolute;left:${left}px;top:${top + height / 2}px;width:${width}px;`;
      d.innerHTML = `<hr style="border-color:${comp.style.borderColor || "#e5e7eb"};border-width:${comp.style.borderWidth || 1}px;margin:0;" />`;
      root.appendChild(d);
      continue;
    }
    if (comp.type === "spacer") continue;

    if (comp.type === "image") {
      const url = comp.style.imageUrl;
      if (!url) continue;
      const img = document.createElement("img");
      img.src = url;
      img.crossOrigin = "anonymous";
      img.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;object-fit:${comp.style.imageFit || "contain"};border-radius:${comp.style.borderRadius || 0}px;`;
      root.appendChild(img);
      continue;
    }

    if (comp.type === "table") {
      // Table always spans full inner width for predictable alignment
      const wrap = document.createElement("div");
      wrap.style.cssText = `position:absolute;left:${mLeft}px;top:${top}px;width:${innerW}px;`;
      const headCells = visibleCols
        .map(
          (c) =>
            `<th style="padding:8px 10px;text-align:${c.align};font-size:${tableSettings.headerFontSize}px;font-weight:600;width:${c.width}%;">${c.label}</th>`
        )
        .join("");
      const bodyRows = data.items
        .map((item, i) => {
          const bg =
            tableSettings.showAlternateRows && i % 2 === 1 ? tableSettings.alternateRowColor : "transparent";
          const cells = visibleCols
            .map((c) => {
              const raw = (item as any)[c.key];
              const val =
                c.key === "rate" || c.key === "amount" || c.key === "discount" || c.key === "tax"
                  ? formatCurrency(Number(raw || 0))
                  : raw ?? "";
              return `<td style="padding:${tableSettings.rowSpacing}px 10px;text-align:${c.align};">${val}</td>`;
            })
            .join("");
          return `<tr style="background:${bg};border-bottom:1px ${tableSettings.borderStyle} ${tableSettings.borderColor};">${cells}</tr>`;
        })
        .join("");
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:${tableSettings.rowFontSize}px;table-layout:fixed;">
        <thead><tr style="background:${tableSettings.headerBg};color:${tableSettings.headerColor};">${headCells}</tr></thead>
        <tbody>${bodyRows}</tbody></table>`;
      root.appendChild(wrap);
      continue;
    }

    const s = comp.style;
    const text = resolveBinding(comp, data);
    const isTotalsLabel = comp.category === "totals";
    const display =
      isTotalsLabel && comp.label !== "Total" && comp.label !== "Balance Due"
        ? `${comp.label}: ${text}`
        : text;
    const div = document.createElement("div");
    div.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;
      font-size:${s.fontSize || 12}px;font-weight:${s.fontWeight || "normal"};font-style:${s.fontStyle || "normal"};
      color:${s.color || "#000"};background:${s.backgroundColor || "transparent"};text-align:${s.textAlign || "left"};
      padding:${s.padding || 0}px;border-radius:${s.borderRadius || 0}px;display:flex;align-items:center;line-height:1.3;overflow:hidden;box-sizing:border-box;`;
    div.innerHTML = `<span style="width:100%;text-align:${s.textAlign || "left"};display:block;">${display}</span>`;
    root.appendChild(div);
  }
  return root;
}

export async function downloadInvoicePdf(invoiceId: string, tenantId: string) {
  const loaded = await loadInvoiceForDownload(invoiceId, tenantId);
  // No custom template configured → the designer layout has no components and
  // would render a blank page. Fall back to the self-contained vector invoice.
  if (!loaded.components.length) {
    const { downloadInvoiceVectorPdf } = await import("@/lib/invoicePdf");
    await downloadInvoiceVectorPdf(invoiceId, tenantId);
    return;
  }
  const node = renderInvoiceHtml(loaded);
  // Off-screen mount
  node.style.position = "fixed";
  node.style.left = "-10000px";
  node.style.top = "0";
  document.body.appendChild(node);
  try {
    // Wait for any <img> to finish loading so html2canvas captures them
    const images = Array.from(node.querySelectorAll("img"));
    await Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
      )
    );
    const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");
    const isA4 = loaded.pageSettings.size === "A4";
    const isPortrait = loaded.pageSettings.orientation === "portrait";
    const pdf = new jsPDF({
      orientation: isPortrait ? "portrait" : "landscape",
      unit: "mm",
      format: isA4 ? "a4" : "letter",
    });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    // Preserve aspect ratio of the rendered canvas to avoid stretching
    const canvasRatio = canvas.width / canvas.height;
    const pageRatio = pdfW / pdfH;
    let drawW = pdfW;
    let drawH = pdfH;
    if (canvasRatio > pageRatio) {
      // canvas is wider — fit to width
      drawH = pdfW / canvasRatio;
    } else {
      drawW = pdfH * canvasRatio;
    }
    const offsetX = (pdfW - drawW) / 2;
    const offsetY = 0;
    pdf.addImage(imgData, "PNG", offsetX, offsetY, drawW, drawH);
    pdf.save(`invoice-${loaded.data.invoice_number || invoiceId}.pdf`);
  } finally {
    document.body.removeChild(node);
  }
}
