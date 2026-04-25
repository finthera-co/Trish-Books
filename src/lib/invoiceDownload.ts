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

function renderInvoiceHtml({ components, tableSettings, data }: LoadResult): HTMLDivElement {
  const COL_W = 45;
  const ROW_H = 24;
  const sorted = [...components].sort((a, b) => a.y - b.y || a.x - b.x);
  const visibleCols = tableSettings.columns.filter((c) => c.visible);

  const root = document.createElement("div");
  root.style.cssText = `width:595px;min-height:842px;position:relative;background:#fff;padding:32px;font-family:sans-serif;`;

  for (const comp of sorted) {
    const left = comp.x * COL_W;
    const top = comp.y * ROW_H;
    const width = comp.w * COL_W;
    const height = comp.h * ROW_H;

    if (comp.type === "divider") {
      const d = document.createElement("div");
      d.style.cssText = `position:absolute;left:${left}px;top:${top + height / 2}px;width:${width}px;`;
      d.innerHTML = `<hr style="border-color:${comp.style.borderColor || "#e5e7eb"};border-width:${comp.style.borderWidth || 1}px;" />`;
      root.appendChild(d);
      continue;
    }
    if (comp.type === "spacer") continue;

    if (comp.type === "table") {
      const wrap = document.createElement("div");
      wrap.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${12 * COL_W}px;`;
      const headCells = visibleCols
        .map(
          (c) =>
            `<th style="padding:8px 10px;text-align:${c.align};font-size:${tableSettings.headerFontSize}px;font-weight:600;">${c.label}</th>`
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
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:${tableSettings.rowFontSize}px;">
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
      padding:${s.padding || 0}px;border-radius:${s.borderRadius || 0}px;display:flex;align-items:center;line-height:1.3;overflow:hidden;`;
    div.innerHTML = `<span style="width:100%;text-align:${s.textAlign || "left"};">${display}</span>`;
    root.appendChild(div);
  }
  return root;
}

export async function downloadInvoicePdf(invoiceId: string, tenantId: string) {
  const loaded = await loadInvoiceForDownload(invoiceId, tenantId);
  const node = renderInvoiceHtml(loaded);
  // Off-screen mount
  node.style.position = "fixed";
  node.style.left = "-10000px";
  node.style.top = "0";
  document.body.appendChild(node);
  try {
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
    pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
    pdf.save(`invoice-${loaded.data.invoice_number || invoiceId}.pdf`);
  } finally {
    document.body.removeChild(node);
  }
}
