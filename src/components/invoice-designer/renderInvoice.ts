import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { itemCellLines } from "@/lib/pdfTheme";
import {
  STAMP_TILT, STAMP_W, STAMP_H, STAMP_CSS_COLOR, paidStampBounds, paidStampSublines, type PaidStamp,
} from "@/lib/paidStamp";
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

/**
 * Escape a designer-supplied value (colors, alignment, border styles) before it
 * is interpolated into an HTML style="" attribute inside an innerHTML string.
 * Without this, a template field like `red"><img src=x onerror=…>` would break
 * out of the attribute and inject markup — stored XSS when another tenant user
 * views/downloads the invoice.
 */
function styleVal(v: unknown): string {
  return escapeHtml(String(v ?? ""));
}

export function formatTemplateDate(iso: string, fmt?: PageSettings["dateFormat"]): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso; // free text like "On delivery" passes through
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  switch (fmt) {
    case "MM/DD/YYYY": return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD": return `${yyyy}-${mm}-${dd}`;
    // Spelled out explicitly rather than via the shared helper: this branch is
    // an explicit per-template opt-out of the DD/MM/YYYY house standard, so it
    // must keep rendering what its label promises.
    case "DD MMM YYYY": {
      const MMM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
      return `${dd} ${MMM} ${yyyy}`;
    }
    case "DD/MM/YYYY":
    default:
      return formatDate(d);
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

/**
 * Value printed for a component. Totals values print bare (labels are their
 * own components in the layout — prefixing here duplicated them, e.g.
 * "Sub Total | Sub Total: LKR 5,000.00", and the long string wrapped/clipped).
 */
export function displayText(comp: DesignerComponent, data: InvoiceData, pageSettings?: PageSettings): string {
  return resolveComponentText(comp, data, pageSettings);
}

export interface RenderInput {
  components: DesignerComponent[];
  tableSettings: TableSettings;
  pageSettings: PageSettings;
  data: InvoiceData;
  /** Present once a settlement receipt has been issued against the invoice. */
  paidStamp?: PaidStamp | null;
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
      const lines = itemCellLines(String(item.item || ""), String(item.description || ""));
      return { text: lines.length ? lines.join("\n") : "—" };
    }
    case "discount": {
      // A discount is a reduction in the customer's favour, not an error —
      // red is reserved for Balance Due, so this stays the neutral body colour.
      const v = Number(item.discount || 0);
      if (v <= 0) return { text: "—", muted: true };
      // Show the percentage the line was discounted by, when one was entered.
      const pct = Number(item.discount_percent || 0);
      return { text: pct > 0 ? `-${formatCurrency(v, currency)} (${pct}%)` : `-${formatCurrency(v, currency)}` };
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
      // Build the <hr> as a DOM node with a CSS-only style — no innerHTML, so
      // designer border values can never inject markup.
      const hr = document.createElement("hr");
      const hrStyle = comp.style.borderStyle && comp.style.borderStyle !== "none" ? comp.style.borderStyle : "solid";
      hr.style.cssText = `border:none;border-top:${Number(comp.style.borderWidth) || 1}px ${hrStyle} ${comp.style.borderColor || "#e5e7eb"};margin:0;`;
      d.appendChild(hr);
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
      img.crossOrigin = "anonymous"; // must precede src so the fetch is CORS-enabled
      img.src = url;
      img.dataset.top = String(top);
      // The company logo hugs the left edge of its box (object-fit:contain
      // would otherwise float a narrow logo into the middle of the box,
      // leaving it adrift between the margin and the company name).
      const objPos = comp.binding === "company_logo" ? "left center" : "center";
      img.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;object-fit:${comp.style.imageFit || "contain"};object-position:${objPos};border-radius:${comp.style.borderRadius || 0}px;`;
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
            `<th style="padding:8px 10px;text-align:${styleVal(c.align)};font-size:${Number(tableSettings.headerFontSize) || 12}px;font-weight:600;width:${Number(c.width) || 0}%;">${escapeHtml(c.label)}</th>`
        )
        .join("");
      const bodyRows = data.items
        .map((item, i) => {
          const bg =
            tableSettings.showAlternateRows && i % 2 === 1 ? tableSettings.alternateRowColor : "transparent";
          const cells = visibleCols
            .map((c) => {
              const cell = tableCellContent(c.key, item as any, i, data.currency);
              // cell.color values are code-supplied constants, but escape anyway.
              const cellStyle =
                (cell.color ? `color:${styleVal(cell.color)};` : cell.muted ? "color:#6b7280;" : "") +
                (cell.bold ? "font-weight:600;" : "");
              return `<td style="padding:${Number(tableSettings.rowSpacing) || 0}px 10px;text-align:${styleVal(c.align)};vertical-align:top;white-space:pre-line;${cellStyle}">${escapeHtml(cell.text)}</td>`;
            })
            .join("");
          const rowBorder =
            tableSettings.borderStyle !== "none"
              ? `border-bottom:1px ${styleVal(tableSettings.borderStyle)} ${styleVal(tableSettings.borderColor)};`
              : "";
          return `<tr style="background:${styleVal(bg)};${rowBorder}">${cells}</tr>`;
        })
        .join("");
      wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:${Number(tableSettings.rowFontSize) || 12}px;table-layout:fixed;word-wrap:break-word;">
        <thead><tr style="background:${styleVal(tableSettings.headerBg)};color:${styleVal(tableSettings.headerColor)};">${headCells}</tr></thead>
        <tbody>${bodyRows}</tbody></table>`;
      root.appendChild(wrap);
      continue;
    }

    // Text
    const s = comp.style;
    const text = displayText(comp, data, pageSettings);
    const div = document.createElement("div");
    div.dataset.top = String(top);
    // Bindings are tagged onto the node so later passes can find a field by
    // meaning rather than by position — applyPaidStamp anchors to balance_due.
    if (comp.binding) div.dataset.binding = comp.binding;
    div.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;min-height:${height}px;
      font-size:${s.fontSize || 12}px;font-weight:${s.fontWeight || "normal"};font-style:${s.fontStyle || "normal"};
      ${s.fontFamily ? `font-family:${FONT_STACKS[s.fontFamily] || s.fontFamily};` : ""}
      color:${s.color || "#000"};background:${s.backgroundColor || "transparent"};text-align:${s.textAlign || "left"};
      ${s.textTransform === "uppercase" ? "text-transform:uppercase;" : ""}${borderCss(s)}
      padding:${s.padding || 0}px;border-radius:${s.borderRadius || 0}px;display:flex;align-items:center;
      line-height:${s.lineHeight || 1.3};overflow:hidden;box-sizing:border-box;white-space:pre-line;`;
    div.innerHTML = `<span style="width:100%;text-align:${styleVal(s.textAlign || "left")};display:block;">${escapeHtml(text)}</span>`;
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
// Height reserved at the bottom of every page for the per-page footer, in
// canvas px. applyPageFooter draws inside this band; reflowTables keeps
// content out of it so the two never overlap.
export const PAGE_FOOTER_H = 56;

export function reflowTables(root: HTMLElement, footerReserve = 0): void {
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
  pageFit(root, footerReserve);
}

/**
 * Grow the sheet to hold its content plus the bottom margin, in whole pages.
 * `extraBottom` covers content whose real footprint offsetHeight can't report —
 * a rotated stamp, for instance.
 */
function pageFit(root: HTMLElement, footerReserve: number, extraBottom = 0): void {
  const mBottom = Number(root.dataset.pageBottomMargin || 0);
  let contentBottom = extraBottom;
  for (const el of Array.from(root.children) as HTMLElement[]) {
    contentBottom = Math.max(contentBottom, el.offsetTop + el.offsetHeight);
  }
  const needed = contentBottom + Math.max(mBottom, footerReserve);
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
 * Rubber PAID stamp, matching drawPaidStamp in the vector PDF — same tilt, same
 * red, same receipt reference — so a tenant with a custom template gets the same
 * mark as one without.
 *
 * Anchored under the Balance Due figure rather than dropped at fixed
 * coordinates: a designer template can put the totals anywhere, and the stamp
 * only means anything sitting directly beneath the balance it settles. The last
 * balance_due on the page is the totals ladder — the first is the summary chip
 * up in the header.
 */
export function applyPaidStamp(root: HTMLElement, stamp?: PaidStamp | null, footerReserve = 0): void {
  if (!stamp) return;
  // Page geometry is A4 at 72dpi (CANVAS_W = 595px = 210mm), so 1mm ≈ 2.833px.
  const MM = CANVAS_W / 210;
  const SCALE = 0.76; // matches the vector PDF: sized to the totals column
  const w = STAMP_W * SCALE * MM;
  const h = STAMP_H * SCALE * MM;
  // The frame is tilted, so it eats more of the page than w × h.
  const bounds = paidStampBounds(SCALE);
  const bw = bounds.w * MM;
  const bh = bounds.h * MM;

  const anchor = Array.from(root.querySelectorAll<HTMLElement>('[data-binding="balance_due"]'))
    .sort((a, b) => Number(a.dataset.top) - Number(b.dataset.top))
    .pop();

  let cx = CANVAS_W * 0.72;
  let boxTop = CANVAS_H * 0.56;
  if (anchor) {
    const aHeight = anchor.offsetHeight || parseFloat(anchor.style.minHeight) || 0;
    cx = (parseFloat(anchor.style.left) || 0) + (parseFloat(anchor.style.width) || 0) / 2;
    boxTop = (Number(anchor.dataset.top) || 0) + aHeight + 10;
  }
  // Keep the whole tilted footprint on the sheet.
  cx = Math.min(Math.max(cx, bw / 2 + 4), CANVAS_W - bw / 2 - 4);
  if (!anchor) boxTop = Math.min(boxTop, Number(root.dataset.pages || 1) * CANVAS_H - bh - 4);

  // Reserve the band the stamp needs. A designer template can put anything
  // below the totals — bank details commonly run full width right there — so
  // push whatever the footprint would land on further down, exactly as a grown
  // items table does, rather than printing the stamp over it.
  if (anchor) {
    const anchorTop = Number(anchor.dataset.top) || 0;
    const shift = bh + 12;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-top]"))) {
      const elTop = Number(el.dataset.top);
      if (elTop <= anchorTop) continue;
      const elLeft = parseFloat(el.style.left) || 0;
      const elRight = elLeft + (parseFloat(el.style.width) || 0);
      if (elRight < cx - bw / 2 || elLeft > cx + bw / 2) continue; // clear of the stamp
      el.style.top = `${parseFloat(el.style.top) + shift}px`;
      el.dataset.top = String(elTop + shift);
    }
  }

  const color = STAMP_CSS_COLOR;
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;left:${cx - w / 2}px;top:${boxTop + (bh - h) / 2}px;
    width:${w}px;height:${h}px;box-sizing:border-box;pointer-events:none;
    border:3px solid ${color};border-radius:3px;transform:rotate(${STAMP_TILT}deg);
    display:flex;flex-direction:column;align-items:center;justify-content:center;color:${color};
    font-family:Helvetica, Arial, sans-serif;`;

  const inner = document.createElement("div");
  inner.style.cssText = `position:absolute;inset:3px;border:1px solid ${color};border-radius:2px;`;
  el.appendChild(inner);

  const title = document.createElement("div");
  title.textContent = "PAID";
  title.style.cssText = `font-size:${h * 0.31}px;font-weight:bold;letter-spacing:${h * 0.047}px;line-height:1.1;`;
  el.appendChild(title);

  for (const line of paidStampSublines(stamp)) {
    const sub = document.createElement("div");
    sub.textContent = line;
    sub.style.cssText = `font-size:${h * 0.083}px;letter-spacing:1px;line-height:1.5;`;
    el.appendChild(sub);
  }
  root.appendChild(el);
  // offsetHeight can't see past the rotation, so hand the real footprint over.
  pageFit(root, footerReserve, boxTop + bh);
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
    // Sits at the top of the reserved footer band, lifting it clear of the
    // physical page edge so it survives printer margins.
    f.style.cssText = `position:absolute;left:16px;top:${(p + 1) * CANVAS_H - PAGE_FOOTER_H}px;width:${CANVAS_W - 32}px;
      border-top:0.5px solid #e5e7eb;padding-top:8px;display:flex;align-items:center;gap:8px;
      font-size:8px;color:#6b7280;pointer-events:none;`;

    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;min-width:0;";
    if (data.company_logo) {
      const img = document.createElement("img");
      img.crossOrigin = "anonymous"; // must precede src so the fetch is CORS-enabled
      img.src = data.company_logo;
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

interface ImageOverlay {
  dataUrl: string;
  x: number; // CSS px relative to the node
  y: number;
  w: number;
  h: number;
  img: HTMLImageElement; // hidden during rasterisation so the logo paints once
}

/**
 * Capture every <img> in the mounted node at NATURAL resolution with its
 * painted rect (honouring object-fit:contain letterboxing). These are
 * re-drawn natively into the PDF over the html2canvas raster, so logos stay
 * crisp instead of inheriting the raster's dpi. CORS-tainted images are
 * skipped — the rasterised copy remains as the fallback.
 */
function collectImageOverlays(node: HTMLElement): ImageOverlay[] {
  const rootRect = node.getBoundingClientRect();
  const out: ImageOverlay[] = [];
  for (const img of Array.from(node.querySelectorAll("img"))) {
    if (!img.complete || !img.naturalWidth || !img.naturalHeight) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(img);
    const fit = cs.objectFit || "fill";
    let w = r.width;
    let h = r.height;
    if (fit === "contain" || fit === "scale-down") {
      const ratio = img.naturalWidth / img.naturalHeight;
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
    } else if (fit !== "fill") {
      continue; // cover/none crop the source — leave the raster as-is
    }
    // Letterbox offset from object-position (computed style resolves keywords
    // to percentages, e.g. "left center" → "0% 50%").
    const [posX = "50%", posY = "50%"] = (cs.objectPosition || "").split(" ");
    const fx = posX.endsWith("%") ? parseFloat(posX) / 100 : 0.5;
    const fy = posY.endsWith("%") ? parseFloat(posY) / 100 : 0.5;
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0);
      out.push({
        dataUrl: c.toDataURL("image/png"),
        x: r.left - rootRect.left + (r.width - w) * fx,
        y: r.top - rootRect.top + (r.height - h) * fy,
        w,
        h,
        img,
      });
    } catch {
      /* tainted canvas — keep the rasterised version */
    }
  }
  return out;
}

/**
 * Rasterise a mounted node and write it into real pages. Content taller than
 * one sheet is SLICED across pages at full size — never scaled down. Images
 * are then overlaid natively at full resolution (see collectImageOverlays).
 */
export async function nodeToPdf(node: HTMLElement, pageSettings: PageSettings): Promise<jsPDF> {
  const overlays = collectImageOverlays(node); // before rasterising, while layout is live
  // Captured images are excluded from the raster: html2canvas doesn't honour
  // object-position, so leaving them in paints a second, misplaced copy under
  // the native overlay. Images that couldn't be captured stay visible.
  for (const o of overlays) o.img.style.visibility = "hidden";
  // scale 3 ≈ 216dpi on A4 — at 2 (~144dpi) fine text looks smudged.
  const canvas = await html2canvas(node, { scale: 3, useCORS: true, backgroundColor: "#ffffff" });
  for (const o of overlays) o.img.style.visibility = "";
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

  // Native full-resolution image pass over the raster.
  const cssW = node.offsetWidth || CANVAS_W;
  const pageHcss = pageHpx / (canvas.width / cssW);
  const mmPerPx = pdfW / cssW;
  const pageCount = pdf.getNumberOfPages();
  for (const o of overlays) {
    const pageIdx = Math.min(Math.floor((o.y + o.h / 2) / pageHcss), pageCount - 1);
    pdf.setPage(pageIdx + 1);
    try {
      pdf.addImage(o.dataUrl, "PNG", o.x * mmPerPx, (o.y - pageIdx * pageHcss) * mmPerPx, o.w * mmPerPx, o.h * mmPerPx);
    } catch {
      /* unsupported image — raster copy already shows it */
    }
  }
  pdf.setPage(pageCount);
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
    const footerReserve = input.pageSettings.pageFooter?.enabled ? PAGE_FOOTER_H : 0;
    reflowTables(node, footerReserve);
    // Before the watermark and footer: the stamp can push content down and grow
    // the page, and both of those are laid out per page.
    applyPaidStamp(node, input.paidStamp, footerReserve);
    applyWatermarks(node, input.pageSettings);
    applyPageFooter(node, input.pageSettings, input.data);
    await waitForImages(node); // footer may add a logo <img>
    return await nodeToPdf(node, input.pageSettings);
  } finally {
    document.body.removeChild(node);
  }
}
