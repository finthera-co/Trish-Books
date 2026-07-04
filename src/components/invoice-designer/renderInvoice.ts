import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { formatCurrency } from "@/lib/currency";
import type { DesignerComponent, TableSettings, PageSettings, InvoiceData } from "./types";

/**
 * Single source of truth for turning a saved template + invoice data into a
 * printable document. Used by BOTH the designer's preview dialog and the real
 * invoice download (invoiceDownload.ts) so the preview can never drift from
 * what the customer receives.
 *
 * Pipeline: renderInvoiceHtml → mount off-screen → reflowTables (grow the page
 * when the items table is taller than designed) → applyWatermarks → nodeToPdf
 * (rasterise and slice into real A4/Letter pages instead of shrinking).
 */

// Designer canvas geometry: 595×842 CSS px = A4 at 72dpi. Component x/y/w/h are
// 12-col grid units; these constants convert them to page pixels.
export const CANVAS_W = 595;
export const CANVAS_H = 842;
export const COL_W = 45;
export const ROW_H = 24;

const MONEY_BINDINGS = new Set([
  "subtotal", "discount", "taxable_amount", "tax", "shipping", "adjustment",
  "total", "paid_amount", "balance_due",
]);
const DATE_BINDINGS = new Set(["invoice_date", "due_date"]);

export const FONT_STACKS: Record<string, string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  Times: "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace",
  Verdana: "Verdana, Geneva, sans-serif",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatTemplateDate(iso: string, fmt?: PageSettings["dateFormat"]): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso; // free text like "On delivery" passes through
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  switch (fmt) {
    case "DD/MM/YYYY": return `${dd}/${mm}/${yyyy}`;
    case "MM/DD/YYYY": return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD": return `${yyyy}-${mm}-${dd}`;
    case "DD MMM YYYY":
    default:
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
}

/** Resolve a component's display text from its binding (or static default). */
export function resolveComponentText(
  comp: DesignerComponent,
  data: InvoiceData,
  pageSettings?: PageSettings,
): string {
  if (!comp.binding) return comp.defaultValue || comp.label;
  const val = (data as any)[comp.binding];
  // A bound field with no data prints NOTHING — never the designer placeholder
  // (a tenant without an address must not invoice "Company Address").
  if (val === undefined || val === null || val === "") return "";
  if (typeof val === "number") {
    if (!MONEY_BINDINGS.has(comp.binding)) return String(val);
    // Discounts subtract: present as -LKR 26.00 (matching the built-in PDF).
    if (comp.binding === "discount" && val > 0) return `-${formatCurrency(val, data.currency)}`;
    return formatCurrency(val, data.currency);
  }
  if (DATE_BINDINGS.has(comp.binding)) return formatTemplateDate(String(val), pageSettings?.dateFormat);
  return String(val);
}

/** Totals rows other than the headline figures get a "Label: value" prefix. */
export function displayText(comp: DesignerComponent, data: InvoiceData, pageSettings?: PageSettings): string {
  const text = resolveComponentText(comp, data, pageSettings);
  const isPlainTotal =
    comp.label === "Total" || comp.label === "Balance Due" || comp.binding === "amount_in_words";
  return comp.category === "totals" && !isPlainTotal ? `${comp.label}: ${text}` : text;
}

export interface RenderInput {
  components: DesignerComponent[];
  tableSettings: TableSettings;
  pageSettings: PageSettings;
  data: InvoiceData;
}

export interface TableCell {
  text: string;
  color?: string;
  bold?: boolean;
  muted?: boolean;
}

/**
 * Table cell content including the virtual columns the built-in PDF uses:
 * `index` (# line number) and `item_description` (product name over description).
 * Discounts print red with a minus; the amount column is bold.
 */
export function tableCellContent(
  colKey: string,
  item: Record<string, any>,
  rowIndex: number,
  currency: string,
): TableCell {
  switch (colKey) {
    case "index":
      return { text: String(rowIndex + 1), muted: true };
    case "item_description": {
      const name = String(item.item || "");
      const desc = String(item.description || "");
      const text = name && desc && name !== desc ? `${name}\n${desc}` : name || desc || "—";
      return { text };
    }
    case "discount": {
      const v = Number(item.discount || 0);
      return v > 0
        ? { text: `-${formatCurrency(v, currency)}`, color: "#dc2626" }
        : { text: "—", muted: true };
    }
    case "amount":
      return { text: formatCurrency(Number(item.amount || 0), currency), bold: true };
    case "rate":
    case "tax":
      return { text: formatCurrency(Number(item[colKey] || 0), currency) };
    default:
      return { text: String(item[colKey] ?? "") };
  }
}

/**
 * Build the invoice as a detached DOM node. All invoice-sourced text is
 * HTML-escaped — customer names / notes must never be interpreted as markup.
 */
export function renderInvoiceHtml({ components, tableSettings, pageSettings, data }: RenderInput): HTMLDivElement {
  const m = pageSettings.margins || { top: 0, right: 0, bottom: 0, left: 0 };
  // Designer margins are stored in page px; cap so content always stays on the sheet.
  const mLeft = Math.max(0, Math.min(m.left || 0, 80));
  const mTop = Math.max(0, Math.min(m.top || 0, 80));
  const mRight = Math.max(0, Math.min(m.right || 0, 80));
  const mBottom = Math.max(0, Math.min(m.bottom || 0, 80));
  const innerW = CANVAS_W - mLeft - mRight;
  const font = FONT_STACKS[pageSettings.fontFamily || ""] || pageSettings.fontFamily || "sans-serif";

  const sorted = [...components].sort((a, b) => a.y - b.y || a.x - b.x);
  const visibleCols = tableSettings.columns.filter((c) => c.visible);

  const root = document.createElement("div");
  root.style.cssText = `width:${CANVAS_W}px;min-height:${CANVAS_H}px;position:relative;background:#fff;font-family:${font};`;
  root.dataset.pageBottomMargin = String(mBottom);

  const borderCss = (s: DesignerComponent["style"]) =>
    s.borderWidth && s.borderStyle && s.borderStyle !== "none"
      ? `border:${s.borderWidth}px ${s.borderStyle} ${s.borderColor || "#000"};`
      : "";

  for (const comp of sorted) {
    const left = mLeft + comp.x * COL_W;
    const top = mTop + comp.y * ROW_H;
    let width = comp.w * COL_W;
    const height = comp.h * ROW_H;
    if (left + width > CANVAS_W - mRight) width = Math.max(20, CANVAS_W - mRight - left);

    if (comp.type === "spacer") continue;

    if (comp.type === "divider") {
      const d = document.createElement("div");
      d.dataset.top = String(top);
      d.style.cssText = `position:absolute;left:${left}px;top:${top + height / 2}px;width:${width}px;`;
      d.innerHTML = `<hr style="border:none;border-top:${comp.style.borderWidth || 1}px ${comp.style.borderStyle && comp.style.borderStyle !== "none" ? comp.style.borderStyle : "solid"} ${comp.style.borderColor || "#e5e7eb"};margin:0;" />`;
      root.appendChild(d);
      continue;
    }

    if (comp.type === "shape") {
      const s = comp.style;
      const box = document.createElement("div");
      box.dataset.top = String(top);
      box.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;
        background:${s.backgroundColor || "transparent"};${borderCss(s)}border-radius:${s.borderRadius || 0}px;box-sizing:border-box;`;
      root.appendChild(box);
      continue;
    }

    if (comp.type === "image") {
      // "Use company logo" binds the image to tenant branding resolved at render time.
      const url = comp.binding === "company_logo" ? data.company_logo || comp.style.imageUrl : comp.style.imageUrl;
      if (!url) continue;
      const img = document.createElement("img");
      img.src = url;
      img.crossOrigin = "anonymous";
      img.dataset.top = String(top);
      img.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;object-fit:${comp.style.imageFit || "contain"};border-radius:${comp.style.borderRadius || 0}px;`;
      root.appendChild(img);
      continue;
    }

    if (comp.type === "table") {
      const wrap = document.createElement("div");
      // Reflow metadata: where the table starts and how tall the designer sized it.
      wrap.dataset.top = String(top);
      wrap.dataset.tableTop = String(top);
      wrap.dataset.designedH = String(height);
      wrap.style.cssText = `position:absolute;left:${mLeft}px;top:${top}px;width:${innerW}px;`;
      const headCells = visibleCols
        .map(
          (c) =>
            `<th style="padding:8px 10px;text-align:${c.align};font-size:${tableSettings.headerFontSize}px;font-weight:600;width:${c.width}%;">${escapeHtml(c.label)}</th>`
        )
        .join("");
      const bodyRows = data.items
        .map((item, i) => {
          const bg =
            tableSettings.showAlternateRows && i % 2 === 1 ? tableSettings.alternateRowColor : "transparent";
          const cells = visibleCols
            .map((c) => {
              const cell = tableCellContent(c.key, item as any, i, data.currency);
              const cellStyle =
                (cell.color ? `color:${cell.color};` : cell.muted ? "color:#6b7280;" : "") +
                (cell.bold ? "font-weight:600;" : "");
              return `<td style="padding:${tableSettings.rowSpacing}px 10px;text-align:${c.align};vertical-align:top;white-space:pre-line;${cellStyle}">${escapeHtml(cell.text)}</td>`;
            })
            .join("");
          const rowBorder =
            tableSettings.borderStyle !== "none"
              ? `border-bottom:1px ${tableSettings.borderStyle} ${tableSettings.borderColor};`
              : "";
          return `<tr style="background:${bg};${rowBorder}">${cells}</tr>`;
        })
        .join("");
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:${tableSettings.rowFontSize}px;table-layout:fixed;word-wrap:break-word;">
        <thead><tr style="background:${tableSettings.headerBg};color:${tableSettings.headerColor};">${headCells}</tr></thead>
        <tbody>${bodyRows}</tbody></table>`;
      root.appendChild(wrap);
      continue;
    }

    // Text
    const s = comp.style;
    const text = displayText(comp, data, pageSettings);
    const div = document.createElement("div");
    div.dataset.top = String(top);
    div.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;min-height:${height}px;
      font-size:${s.fontSize || 12}px;font-weight:${s.fontWeight || "normal"};font-style:${s.fontStyle || "normal"};
      ${s.fontFamily ? `font-family:${FONT_STACKS[s.fontFamily] || s.fontFamily};` : ""}
      color:${s.color || "#000"};background:${s.backgroundColor || "transparent"};text-align:${s.textAlign || "left"};
      ${s.textTransform === "uppercase" ? "text-transform:uppercase;" : ""}${borderCss(s)}
      padding:${s.padding || 0}px;border-radius:${s.borderRadius || 0}px;display:flex;align-items:center;
      line-height:${s.lineHeight || 1.3};overflow:hidden;box-sizing:border-box;white-space:pre-line;`;
    div.innerHTML = `<span style="width:100%;text-align:${s.textAlign || "left"};display:block;">${escapeHtml(text)}</span>`;
    root.appendChild(div);
  }
  return root;
}

/**
 * Must run AFTER the node is in the DOM (needs real layout). When the rendered
 * items table is taller than its designed box, push everything below it down by
 * the overflow so totals/footer never sit on top of line items, then grow the
 * page to hold the shifted content.
 */
export function reflowTables(root: HTMLElement): void {
  const tables = Array.from(root.querySelectorAll<HTMLElement>("[data-table-top]"));
  for (const wrap of tables) {
    const tableTop = Number(wrap.dataset.tableTop);
    const designedH = Number(wrap.dataset.designedH);
    const delta = wrap.offsetHeight - designedH;
    if (delta <= 0) continue; // shorter than designed → keep the designed gap
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-top]"))) {
      const elTop = Number(el.dataset.top);
      if (el !== wrap && elTop > tableTop) {
        el.style.top = `${parseFloat(el.style.top) + delta}px`;
        el.dataset.top = String(elTop + delta);
      }
    }
  }
  // Grow the sheet to the content plus the bottom margin, in whole pages.
  const mBottom = Number(root.dataset.pageBottomMargin || 0);
  let contentBottom = 0;
  for (const el of Array.from(root.children) as HTMLElement[]) {
    contentBottom = Math.max(contentBottom, el.offsetTop + el.offsetHeight);
  }
  const needed = contentBottom + mBottom;
  const pages = Math.max(1, Math.ceil(needed / CANVAS_H));
  root.style.minHeight = `${pages * CANVAS_H}px`;
  root.dataset.pages = String(pages);
}

/** Diagonal watermark centred on every page. Run after reflowTables. */
export function applyWatermarks(root: HTMLElement, pageSettings: PageSettings): void {
  const wm = pageSettings.watermark;
  if (!wm?.enabled || !wm.text) return;
  const pages = Number(root.dataset.pages || 1);
  for (let p = 0; p < pages; p++) {
    const el = document.createElement("div");
    el.textContent = wm.text; // textContent — never markup
    el.style.cssText = `position:absolute;left:0;top:${p * CANVAS_H}px;width:${CANVAS_W}px;height:${CANVAS_H}px;
      display:flex;align-items:center;justify-content:center;pointer-events:none;
      font-size:72px;font-weight:bold;letter-spacing:8px;text-transform:uppercase;
      color:${wm.color || "#9ca3af"};opacity:${Math.min(Math.max(wm.opacity ?? 0.12, 0.02), 0.5)};
      transform:rotate(-30deg);`;
    // Prepend so content paints on top of the watermark.
    root.insertBefore(el, root.firstChild);
  }
}

/**
 * Per-page footer, matching the built-in vector PDF: hairline rule, small logo
 * + company name + BR number (left), message (centre), Page X of Y (right).
 * Run after reflowTables so the page count is final.
 */
export function applyPageFooter(root: HTMLElement, pageSettings: PageSettings, data: InvoiceData): void {
  if (!pageSettings.pageFooter?.enabled) return;
  const pages = Number(root.dataset.pages || 1);
  const message = pageSettings.pageFooter.message ?? "Thank you for your business";
  for (let p = 0; p < pages; p++) {
    const f = document.createElement("div");
    f.style.cssText = `position:absolute;left:16px;top:${(p + 1) * CANVAS_H - 34}px;width:${CANVAS_W - 32}px;
      border-top:0.5px solid #e5e7eb;padding-top:6px;display:flex;align-items:center;gap:8px;
      font-size:8px;color:#6b7280;pointer-events:none;`;

    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;min-width:0;";
    if (data.company_logo) {
      const img = document.createElement("img");
      img.src = data.company_logo;
      img.crossOrigin = "anonymous";
      img.style.cssText = "height:18px;max-width:40px;object-fit:contain;";
      left.appendChild(img);
    }
    const co = document.createElement("div");
    const name = document.createElement("div");
    name.textContent = data.company_name || "";
    name.style.cssText = "font-weight:bold;color:#111827;font-size:9px;";
    co.appendChild(name);
    if (data.company_registration) {
      const br = document.createElement("div");
      br.textContent = `BR No: ${data.company_registration}`;
      co.appendChild(br);
    }
    left.appendChild(co);

    const centre = document.createElement("div");
    centre.textContent = message;
    centre.style.cssText = "flex:1;text-align:center;font-style:italic;font-size:9px;";

    const right = document.createElement("div");
    right.textContent = `Page ${p + 1} of ${pages}`;
    right.style.cssText = "flex:1;text-align:right;";

    f.appendChild(left);
    f.appendChild(centre);
    f.appendChild(right);
    root.appendChild(f);
  }
}

/** Wait until every <img> in the node has settled so html2canvas captures them. */
export async function waitForImages(node: HTMLElement): Promise<void> {
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );
}

/**
 * Rasterise a mounted node and write it into real pages. Content taller than
 * one sheet is SLICED across pages at full size — never scaled down.
 */
export async function nodeToPdf(node: HTMLElement, pageSettings: PageSettings): Promise<jsPDF> {
  const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
  const pdf = new jsPDF({
    orientation: pageSettings.orientation === "portrait" ? "portrait" : "landscape",
    unit: "mm",
    format: pageSettings.size === "A4" ? "a4" : "letter",
  });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const pageHpx = Math.floor(canvas.width * (pdfH / pdfW)); // one PDF page, in canvas px

  let y = 0;
  let page = 0;
  // -2: swallow sub-pixel remainders instead of emitting a blank trailing page.
  while (y < canvas.height - 2) {
    const sliceH = Math.min(pageHpx, canvas.height - y);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceH;
    const ctx = slice.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    if (page > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, pdfW, (sliceH / canvas.width) * pdfW);
    y += pageHpx;
    page++;
  }
  return pdf;
}

/** Full pipeline: mount off-screen, reflow, watermark, rasterise. Caller saves/uses the PDF. */
export async function renderToPdf(input: RenderInput): Promise<jsPDF> {
  const node = renderInvoiceHtml(input);
  node.style.position = "fixed";
  node.style.left = "-10000px";
  node.style.top = "0";
  document.body.appendChild(node);
  try {
    await waitForImages(node);
    reflowTables(node);
    applyWatermarks(node, input.pageSettings);
    applyPageFooter(node, input.pageSettings, input.data);
    await waitForImages(node); // footer may add a logo <img>
    return await nodeToPdf(node, input.pageSettings);
  } finally {
    document.body.removeChild(node);
  }
}
