import { supabase } from "@/integrations/supabase/client";
import { formatGazetteDate } from "@/lib/gazetteFormat";

export interface TaxInvoiceLine {
  reference: string;
  description: string;
  qty: number;
  unitPrice: number;
  amountExVat: number;
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
  lines: TaxInvoiceLine[];
  totalValueOfSupply: number;
  vatAmount: number;
  totalIncludingVat: number;
  totalInWords: string;
  currency: string; // 'LKR'
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
      // Crore/Lakh/Thousand chunks are at most three digits in this scheme.
      out += (out ? " " : "") + threeDigitsToWords(count) + (u.name ? " " + u.name : "");
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

/**
 * Load every field the statutory VAT tax invoice needs and compute the
 * VAT-exclusive line figures the gazette table requires.
 */
export async function loadTaxInvoice(invoiceId: string, tenantId: string): Promise<TaxInvoiceModel> {
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*, customers(*), invoice_items(*, taxes(*))")
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) throw new Error(invErr?.message || "Invoice not found");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("company_name, tax_id, address, phone")
    .eq("id", tenantId)
    .maybeSingle();

  const customer: any = (invoice as any).customers || {};
  const items: any[] = (invoice as any).invoice_items || [];

  // Each table row shows VAT-EXCLUSIVE figures. unit_price is the net rate;
  // amountExVat = qty * unitPriceExVat.
  const lines: TaxInvoiceLine[] = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const unitPriceExVat = Number(it.unit_price) || 0;
    const amountExVat = Math.round(qty * unitPriceExVat * 100) / 100;
    return {
      reference: it.reference || "",
      description: it.description || "",
      qty,
      unitPrice: unitPriceExVat,
      amountExVat,
    };
  });

  const computedNet = Math.round(lines.reduce((s, l) => s + l.amountExVat, 0) * 100) / 100;
  // Prefer the stored subtotal (authoritative, VAT-exclusive); fall back to the
  // computed sum if it is missing.
  const storedSubtotal = (invoice as any).subtotal;
  const totalValueOfSupply = storedSubtotal != null ? Number(storedSubtotal) : computedNet;
  const vatAmount = Number((invoice as any).tax_amount) || 0;
  const totalIncludingVat = Number((invoice as any).total_amount) || 0;

  return {
    supplier: {
      tin: tenant?.tax_id || "",
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
    invoiceNo: (invoice as any).invoice_number || "",
    dateOfInvoice: formatGazetteDate((invoice as any).issue_date),
    dateOfSupply: formatGazetteDate((invoice as any).date_of_supply || (invoice as any).issue_date),
    placeOfSupply: (invoice as any).place_of_supply || "",
    additionalInfo: (invoice as any).notes || "",
    modeOfPayment: (invoice as any).mode_of_payment || "",
    lines,
    totalValueOfSupply,
    vatAmount,
    totalIncludingVat,
    totalInWords: amountInWords(totalIncludingVat),
    currency: "LKR",
  };
}
