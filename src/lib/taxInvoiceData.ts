import { supabase } from "@/integrations/supabase/client";
import { formatGazetteDate } from "@/lib/gazetteFormat";
import { itemCellLines } from "@/lib/pdfTheme";

export interface TaxInvoiceLine {
  /** Product SKU when the line is a catalogue item — the gazette's optional "Reference". */
  reference: string;
  description: string;
  /** "Goods" when the line is a stocked/non-service product, else "Service". */
  nature: "Goods" | "Service";
  qty: number;
  /** VAT-exclusive price per unit, in LKR. */
  unitPrice: number;
  /**
   * Decimals `unitPrice` must print with for `qty × unitPrice` to reproduce
   * `amountExVat` to the cent. 2 for almost every line; more when a discount
   * or an inclusive-price back-out leaves a non-terminating quotient.
   */
  unitPriceDecimals: number;
  /** Value of supply for this line in LKR: everything charged except VAT. */
  amountExVat: number;
}

/** One VAT rate charged on this invoice, with the supply it was charged on. */
export interface VatBand {
  /** Percentage, e.g. 18 for 18%. 0 covers exempt and zero-rated supply. */
  rate: number;
  base: number;
  vat: number;
}

export interface TaxInvoiceModel {
  supplier: { tin: string; name: string; address: string; phone: string };
  purchaser: { tin: string; name: string; address: string; phone: string };
  invoiceNo: string;
  dateOfInvoice: string; // MM/DD/YYYY
  dateOfSupply: string; // MM/DD/YYYY
  placeOfSupply: string;
  additionalInfo: string;
  modeOfPayment: string;
  /** Items table header: "Description of Goods" | "...Services" | "...Goods or Services". */
  descriptionHeader: string;
  lines: TaxInvoiceLine[];
  totalValueOfSupply: number;
  /** The rate(s) charged. Always at least one band, so a rate is always stated. */
  vatBands: VatBand[];
  vatAmount: number;
  totalIncludingVat: number;
  totalInWords: string;
  currency: string; // 'LKR' — the gazette table is denominated in Rs.
  /**
   * True only for legacy header-tax invoices whose per-line VAT cannot be
   * recovered exactly; the line column is then apportioned from the header and
   * says so on the face of the document.
   */
  apportioned: boolean;
}

// ── Amount in words (Sri Lankan Rupees and cents) ──────────────────────
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigitsToWords(n: number): string {
  let out = "";
  if (n >= 100) {
    out += ONES[Math.floor(n / 100)] + " Hundred";
    n %= 100;
    if (n) out += " ";
  }
  if (n >= 20) {
    out += TENS[Math.floor(n / 10)];
    if (n % 10) out += " " + ONES[n % 10];
  } else if (n > 0) {
    out += ONES[n];
  }
  return out;
}

function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const units = [
    { value: 10000000, name: "Crore" },
    { value: 100000, name: "Lakh" },
    { value: 1000, name: "Thousand" },
    { value: 1, name: "" },
  ];
  let out = "";
  let rest = n;
  for (const u of units) {
    if (rest >= u.value) {
      const count = Math.floor(rest / u.value);
      rest %= u.value;
      // The crore chunk is the only one that can itself exceed three digits
      // (100 crore and up), so it recurses; the rest are three digits by
      // construction.
      const chunk = count > 999 ? integerToWords(count) : threeDigitsToWords(count);
      out += (out ? " " : "") + chunk + (u.name ? " " + u.name : "");
    }
  }
  return out.trim();
}

export function amountInWords(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const rupees = Math.floor(rounded);
  const cents = Math.round((rounded - rupees) * 100);
  const rupeeWords = integerToWords(rupees);
  let result = `${rupeeWords} Rupee${rupees === 1 ? "" : "s"}`;
  if (cents > 0) {
    result += ` and ${integerToWords(cents)} Cent${cents === 1 ? "" : "s"}`;
  }
  return result + " Only";
}

/** `18`, `7.5`, `2.04` — a rate with no trailing zeros, for the VAT Amount label. */
export function formatRate(rate: number): string {
  const r = Math.round((Number(rate) || 0) * 10000) / 10000;
  return `${Number(r.toFixed(4))}%`;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The unit price to print and how many decimals it needs. The Amount column is
 * the figure that must foot to the total, so the unit price is widened until
 * `qty × unitPrice` reproduces it rather than being silently rounded away.
 */
export function unitPriceFor(amountExVat: number, qty: number): { unitPrice: number; decimals: number } {
  if (!qty) return { unitPrice: amountExVat, decimals: 2 };
  for (const dp of [2, 3, 4, 6]) {
    const v = Number((amountExVat / qty).toFixed(dp));
    if (Math.abs(v * qty - amountExVat) < 0.005) return { unitPrice: v, decimals: dp };
  }
  return { unitPrice: r2(amountExVat / qty), decimals: 2 };
}

/** Collapse per-line VAT into one band per distinct rate, largest supply first. */
function buildBands(per: { rate: number; base: number; vat: number }[]): VatBand[] {
  const byRate = new Map<string, VatBand>();
  for (const p of per) {
    // Rates are compared at 4dp so 18 and 18.0000 are one band.
    const key = (Math.round(p.rate * 10000) / 10000).toFixed(4);
    const band = byRate.get(key) || { rate: Number(key), base: 0, vat: 0 };
    band.base = r2(band.base + p.base);
    band.vat = r2(band.vat + p.vat);
    byRate.set(key, band);
  }
  const bands = [...byRate.values()].filter((b) => b.base !== 0 || b.vat !== 0);
  bands.sort((a, b) => b.base - a.base);
  return bands.length ? bands : [{ rate: 0, base: 0, vat: 0 }];
}

/** The subset of an invoice line the figure engine needs. */
export interface TaxLineInput {
  id: string;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  discount_amount?: number | string | null;
  is_tax_inclusive?: boolean | null;
  tax_id?: string | null;
  taxes?: { tax_rate?: number | string | null } | null;
}

/** The subset of a posted `tax_transactions` row the figure engine needs. */
export interface TaxTxnInput {
  source_line_id: string | null;
  base_amount: number | string;
  tax_amount: number | string;
  rate_applied?: number | string | null;
  tax_codes?: { tax_type?: string | null; collection_mode?: string | null } | null;
}

export interface LineFigures {
  /** Value of supply for the line in LKR: everything charged except VAT. */
  amountExVat: number;
  vat: number;
  /** Percentage actually applied to this line. */
  rate: number;
}

/** A cent of drift is rounding; more than that is a real disagreement. */
export const RECONCILE_TOLERANCE = 0.05;

export class TaxInvoiceError extends Error {}

/**
 * Per-line VAT-exclusive value, VAT and rate, in LKR.
 *
 * Figures come from the posted tax sub-ledger (`txns`) — the same rows that
 * reach the VAT return and the GL — so the document can never state something
 * the ledger does not. Invoices posted before the tax engine fall back to the
 * line's own tax rate, and only a legacy header-tax invoice that cannot be
 * reconstructed at all is apportioned from the header.
 *
 * Throws when engine figures fail to reconcile to the posted invoice, because
 * printing an unreconciled statutory document is worse than printing none.
 */
export function computeTaxInvoiceFigures(args: {
  items: TaxLineInput[];
  txns: TaxTxnInput[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  fx?: number;
}): { lines: LineFigures[]; apportioned: boolean } {
  const { items, txns } = args;
  const fx = Number(args.fx) || 1;

  const rowsByLine = new Map<string, TaxTxnInput[]>();
  for (const t of txns || []) {
    if (!t.source_line_id) continue;
    const arr = rowsByLine.get(t.source_line_id) || [];
    arr.push(t);
    rowsByLine.set(t.source_line_id, arr);
  }

  /** Line value in the document's own currency, before any tax treatment. */
  const rawOf = (it: TaxLineInput) =>
    Math.max(0, r2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0) - (Number(it.discount_amount) || 0)));

  /**
   * Exact figures from the sub-ledger. The lowest base across a line's rows is
   * the net revenue the engine computed; a compound code (VAT charged on SSCL)
   * carries a larger base. Everything charged that is not VAT — SSCL and the
   * like — is part of the value of supply, so it is added back. Withholding is
   * not a charge to the customer and never is.
   */
  const fromLedger = (rows: TaxTxnInput[]): LineFigures => {
    const net = Math.min(...rows.map((t) => Number(t.base_amount) || 0));
    let vat = 0;
    let otherOutputTax = 0;
    for (const t of rows) {
      const code = t.tax_codes || {};
      const amt = Number(t.tax_amount) || 0;
      if (code.tax_type === "VAT") vat += amt;
      else if (code.collection_mode === "output") otherOutputTax += amt;
    }
    const amountExVat = r2(net + otherOutputTax);
    vat = r2(vat);
    // The rate the ledger recorded when a single VAT code was applied, derived
    // when several compounded onto one line.
    const vatRows = rows.filter((t) => t.tax_codes?.tax_type === "VAT");
    const rate =
      vatRows.length === 1
        ? Number(vatRows[0].rate_applied) || 0
        : amountExVat > 0
          ? (vat / amountExVat) * 100
          : 0;
    return { amountExVat, vat, rate };
  };

  /** Legacy lines: back the rate out of the line's own `taxes` row. */
  const fromLegacyRate = (it: TaxLineInput): LineFigures => {
    const raw = rawOf(it) * fx;
    const rate = Number(it.taxes?.tax_rate);
    // No tax on this line at all — exempt or zero-rated supply.
    if (!it.tax_id || !Number.isFinite(rate)) return { amountExVat: r2(raw), vat: 0, rate: 0 };
    if (it.is_tax_inclusive) {
      const net = r2(raw / (1 + rate / 100));
      return { amountExVat: net, vat: r2(raw - net), rate };
    }
    return { amountExVat: r2(raw), vat: r2((raw * rate) / 100), rate };
  };

  const hasLedger = rowsByLine.size > 0;
  let lines: LineFigures[] = items.map((it) => {
    const rows = rowsByLine.get(it.id);
    if (rows && rows.length) return fromLedger(rows);
    // With a ledger present, a line without a row carried no tax: its raw
    // value is the whole supply.
    if (hasLedger) return { amountExVat: r2(rawOf(it) * fx), vat: 0, rate: 0 };
    return fromLegacyRate(it);
  });

  const headerSubtotal = r2(Number(args.subtotal || 0) * fx);
  const headerTax = r2(Number(args.taxAmount || 0) * fx);
  const headerTotal = r2(Number(args.totalAmount || 0) * fx);

  const sum = (f: (c: LineFigures) => number) => r2(lines.reduce((s, c) => s + f(c), 0));

  // The value of supply plus VAT must equal what the customer was actually
  // billed. `tax_amount` is NOT the same test: on a compound invoice it also
  // carries SSCL, which belongs inside the value of supply, not beside it.
  const totalOk = () =>
    Math.abs(r2(sum((c) => c.amountExVat) + sum((c) => c.vat)) - headerTotal) <= RECONCILE_TOLERANCE;
  // Legacy invoices carry exactly one flat tax, so there the header tax figure
  // is a second, independent check on the reconstruction.
  const legacyTaxOk = () => Math.abs(sum((c) => c.vat) - headerTax) <= RECONCILE_TOLERANCE;

  if (hasLedger) {
    if (totalOk()) return { lines, apportioned: false };
    throw new TaxInvoiceError(
      "This invoice's line VAT does not reconcile to its posted total. Re-post the invoice before issuing a tax invoice."
    );
  }
  if (totalOk() && legacyTaxOk()) return { lines, apportioned: false };

  // Legacy header-level tax with no recoverable line detail: apportion the
  // stored subtotal across the lines by value and state one effective rate.
  const weights = items.map((it) => rawOf(it) * fx);
  const wSum = r2(weights.reduce((s, w) => s + w, 0));
  const scale = wSum > 0 ? headerSubtotal / wSum : 1;
  const effRate = headerSubtotal > 0 ? (headerTax / headerSubtotal) * 100 : 0;
  lines = weights.map((w) => {
    const amountExVat = r2(w * scale);
    return { amountExVat, vat: r2((amountExVat * effRate) / 100), rate: effRate };
  });
  // Push both residuals onto the largest line so the columns foot exactly.
  if (lines.length > 0) {
    let idx = 0;
    for (let i = 1; i < lines.length; i++) if (lines[i].amountExVat > lines[idx].amountExVat) idx = i;
    lines[idx].amountExVat = r2(lines[idx].amountExVat + (headerSubtotal - sum((c) => c.amountExVat)));
    lines[idx].vat = r2(lines[idx].vat + (headerTax - sum((c) => c.vat)));
  }
  return { lines, apportioned: true };
}

/**
 * Load every field the statutory VAT tax invoice needs (IRD Gazette 2481/22,
 * Annexure I) and derive the VAT-exclusive line figures the gazette table
 * requires. The arithmetic lives in `computeTaxInvoiceFigures`; this function
 * is the data access and the statutory gate around it.
 *
 * Throws rather than rendering when the supplier may not lawfully issue a tax
 * invoice, or when the figures do not reconcile to the posted invoice.
 */
export async function loadTaxInvoice(invoiceId: string, tenantId: string): Promise<TaxInvoiceModel> {
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*, customers(*), invoice_items(*, taxes(tax_rate), products(type, sku, name))")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .single();
  if (invErr || !invoice) throw new Error(invErr?.message || "Invoice not found");

  const inv: any = invoice;

  // ── A tax invoice is a statutory document: it may only be raised for a
  // posted supply, by a registered person, on a date they were registered.
  if (inv.status === "draft") {
    throw new TaxInvoiceError("This invoice is still a draft. Post it before issuing a tax invoice.");
  }
  if (inv.status === "voided") {
    throw new TaxInvoiceError("This invoice has been voided — a tax invoice cannot be issued for it.");
  }

  const [{ data: tenant }, { data: profile }] = await Promise.all([
    supabase.from("tenants").select("company_name, tax_id, address, phone").eq("id", tenantId).maybeSingle(),
    supabase
      .from("tenant_tax_profiles")
      .select("is_vat_registered, vat_registered_from, tin")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const supplierTin = (profile?.tin || tenant?.tax_id || "").trim();
  const dateOfSupplyIso: string = inv.date_of_supply || inv.issue_date;

  if (!profile?.is_vat_registered) {
    throw new TaxInvoiceError(
      "Your company is not marked VAT registered (Settings → Tax → Tax Profile). Only a registered person may issue a Tax Invoice."
    );
  }
  if (profile.vat_registered_from && dateOfSupplyIso && dateOfSupplyIso < profile.vat_registered_from) {
    throw new TaxInvoiceError(
      `The supply date (${dateOfSupplyIso}) is before your VAT registration took effect (${profile.vat_registered_from}).`
    );
  }
  if (!supplierTin) {
    throw new TaxInvoiceError(
      "Your company TIN is not set (Settings → Tax → Tax Profile, or Settings → Company). A Tax Invoice must carry the supplier's TIN."
    );
  }

  const customer: any = inv.customers || {};
  const items: any[] = inv.invoice_items || [];
  if (items.length === 0) throw new TaxInvoiceError("This invoice has no lines.");

  // Gazette figures are in Rs.; a foreign-currency invoice is translated at the
  // rate it posted with, which is the rate the GL and the VAT return used.
  const fx = Number(inv.exchange_rate) || 1;
  const docCurrency: string = inv.currency || "LKR";

  // ── Posted tax sub-ledger: the authoritative per-line VAT ────────────
  const { data: txns } = await supabase
    .from("tax_transactions")
    .select("source_line_id, base_amount, tax_amount, rate_applied, tax_codes(tax_type, collection_mode)")
    .eq("tenant_id", tenantId)
    .eq("source_type", "invoice")
    .eq("source_id", invoiceId)
    .eq("direction", "output")
    .eq("is_reversed", false)
    .is("reversal_of_id", null);

  const { lines: figures, apportioned } = computeTaxInvoiceFigures({
    items,
    txns: (txns || []) as any,
    subtotal: Number(inv.subtotal || 0),
    taxAmount: Number(inv.tax_amount || 0),
    totalAmount: Number(inv.total_amount || 0),
    fx,
  });

  const totalValueOfSupply = r2(figures.reduce((s, c) => s + c.amountExVat, 0));
  const vatAmount = r2(figures.reduce((s, c) => s + c.vat, 0));
  const totalIncludingVat = r2(totalValueOfSupply + vatAmount);

  const lines: TaxInvoiceLine[] = items.map((it, i) => {
    const qty = Number(it.quantity) || 0;
    const { amountExVat } = figures[i];
    const { unitPrice, decimals } = unitPriceFor(amountExVat, qty);
    // A line is a Service when it has no linked product (ad-hoc service line)
    // or the linked product is itself a service type; otherwise it is Goods.
    const isService = !it.product_id || it.products?.type === "service";
    return {
      reference: it.products?.sku || "",
      description: itemCellLines(it.products?.name || "", it.description || "").join("\n"),
      nature: (isService ? "Service" : "Goods") as "Goods" | "Service",
      qty,
      unitPrice,
      unitPriceDecimals: decimals,
      amountExVat,
    };
  });

  // The items-column header reflects what the invoice actually contains:
  // only goods, only services, or both (the full gazette wording).
  const hasGoods = lines.some((l) => l.nature === "Goods");
  const hasService = lines.some((l) => l.nature === "Service");
  const descriptionHeader =
    hasGoods && !hasService ? "Description of Goods"
      : hasService && !hasGoods ? "Description of Services"
      : "Description of Goods or Services";

  const notes: string[] = [];
  if (inv.notes) notes.push(String(inv.notes));
  if (docCurrency !== "LKR") {
    notes.push(`Invoiced in ${docCurrency}; converted at 1 ${docCurrency} = LKR ${fx.toFixed(4)}.`);
  }
  if (apportioned) {
    notes.push("Line values apportioned from the invoice total (legacy header-level tax).");
  }

  return {
    supplier: {
      tin: supplierTin,
      name: tenant?.company_name || "",
      address: tenant?.address || "",
      phone: tenant?.phone || "",
    },
    purchaser: {
      // Purchaser TIN reuses the existing customers.tin column.
      tin: customer.tin || "",
      name: customer.name || "",
      address: customer.address || "",
      phone: customer.phone || customer.mobile || "",
    },
    invoiceNo: inv.invoice_number || "",
    dateOfInvoice: formatGazetteDate(inv.issue_date),
    dateOfSupply: formatGazetteDate(dateOfSupplyIso),
    placeOfSupply: inv.place_of_supply || "",
    additionalInfo: notes.join(" "),
    modeOfPayment: inv.mode_of_payment || "",
    descriptionHeader,
    lines,
    totalValueOfSupply,
    vatBands: buildBands(figures.map((c) => ({ rate: c.rate, base: c.amountExVat, vat: c.vat }))),
    vatAmount,
    totalIncludingVat,
    totalInWords: amountInWords(totalIncludingVat),
    currency: "LKR",
    apportioned,
  };
}
