import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_TABLE_SETTINGS, DEFAULT_PAGE_SETTINGS } from "@/components/invoice-designer/templateDefaults";
import { renderToPdf, type RenderInput } from "@/components/invoice-designer/renderInvoice";
import { currencyAmountInWords } from "@/lib/numberToWords";
import type {
  DesignerComponent,
  TableSettings,
  PageSettings,
  InvoiceData,
} from "@/components/invoice-designer/types";

const sanitize = (s: string) => (s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
const prettyTerms = (t?: string | null) =>
  t ? t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "";

export async function loadInvoiceForDownload(invoiceId: string, tenantId: string): Promise<RenderInput> {
  // Same joined fetch as the vector fallback (invoicePdf.ts) so both documents
  // present identical figures: settlement = payments + non-voided credit notes.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(
      "*, customers(*), invoice_items(*, products(name)), payments_received(amount), ar_credit_notes(amount, status)"
    )
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) throw new Error(invErr?.message || "Invoice not found");

  // Resolve template: invoice.template_id -> tenant default -> newest -> built-in defaults
  let template: any = null;
  const tplId = invoice.template_id;
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

  const [{ data: tenant }, { data: profile }] = await Promise.all([
    supabase
      .from("tenants")
      .select("company_name, country, registration_number, logo_url, address, phone, tax_id")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase
      .from("company_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const inv = invoice;
  const customer: any = inv.customers || {};
  const currency = String(inv.currency || "LKR");

  // Settlement: payments + non-voided discount credit notes reduce the balance.
  const paid = (inv.payments_received || []).reduce((s: number, p) => s + Number(p.amount || 0), 0);
  const creditNotes = (inv.ar_credit_notes || [])
    .filter((c) => c.status !== "voided")
    .reduce((s: number, c) => s + Number(c.amount || 0), 0);
  const total = Number(inv.total_amount || 0);
  const balanceDue = Math.max(0, total - paid - creditNotes);

  // it.account (the GL revenue account for manually-mapped lines with no
  // product) is deliberately excluded — a chart-of-accounts name must never
  // appear on a customer-facing document.
  const items = (inv.invoice_items || []).map((it) => ({
    item: it.products?.name || it.description || "",
    description: it.description || "",
    qty: Number(it.quantity || 0),
    unit: "",
    rate: Number(it.unit_price || 0),
    discount: Number(it.discount_amount || 0),
    discount_percent: Number(it.discount_percent || 0),
    tax: Number(it.tax_amount_line || 0),
    amount: Number(it.total || 0),
  }));

  // invoice.subtotal is stored NET of line discounts. Present the gross figure
  // so Subtotal − Discount + Tax = Total always reconciles on the page.
  const lineDiscount = Number(inv.discount_amount || 0);
  const grossSubtotal = Number(inv.subtotal || 0) + lineDiscount;

  // company_address assembled from tenant.address (line 1) plus the
  // company_profiles remainder — same shape as the built-in vector PDF.
  const companyAddress = [
    tenant?.address,
    profile?.address_line2,
    [profile?.city, profile?.postal_code].filter(Boolean).join(" ") || null,
    tenant?.country,
  ].filter(Boolean).join(", ");

  // Pre-labelled so the header line reads exactly "VAT Reg. No.: ..." when the
  // tenant is VAT-registered, else "TIN: 123456789", matching the vector PDF.
  const companyTaxNumber =
    profile?.is_vat_registered && profile?.vat_registration_no
      ? `VAT Reg. No.: ${profile.vat_registration_no}`
      : tenant?.tax_id
        ? `TIN: ${tenant.tax_id}`
        : tenant?.registration_number
          ? `BR No: ${tenant.registration_number}`
          : "";

  // Same fields and order as the built-in vector PDF's payment panel, so the
  // two download paths give a customer the same remittance details.
  const bankLines = ([
    ["Account Holder", profile?.bank_account_name],
    ["Account No.", profile?.bank_account_no],
    ["Bank", profile?.bank_name],
    ["Branch", profile?.bank_branch],
    ["SWIFT", profile?.bank_swift],
  ] as [string, string | null | undefined][])
    .filter(([, v]) => !!String(v ?? "").trim())
    .map(([k, v]) => `${k}: ${v}`);

  const data: InvoiceData = {
    company_name: tenant?.company_name || "",
    company_address: companyAddress,
    company_phone: tenant?.phone || "",
    company_email: profile?.email || "",
    company_tax_number: companyTaxNumber,
    company_registration: tenant?.registration_number || "",
    company_logo: tenant?.logo_url || undefined,
    customer_name: customer.legal_name || customer.name || "",
    customer_address: customer.address || "",
    customer_phone: customer.phone || customer.mobile || "",
    customer_email: customer.email || "",
    customer_tax_id: customer.tin || customer.vat_number || "",
    invoice_title: Number(inv.tax_amount) > 0 ? "TAX INVOICE" : "INVOICE",
    invoice_number: inv.invoice_number || "",
    invoice_date: inv.issue_date || "",
    due_date: inv.due_date || "",
    payment_terms: prettyTerms(inv.payment_terms),
    salesperson: "",
    reference_number: "",
    items,
    subtotal: grossSubtotal,
    discount: lineDiscount,
    taxable_amount: Number(inv.subtotal || 0),
    tax: Number(inv.tax_amount || 0),
    shipping: 0,
    adjustment: 0,
    total,
    paid_amount: paid + creditNotes,
    balance_due: balanceDue,
    amount_in_words: currencyAmountInWords(total, currency),
    notes: inv.notes || "",
    terms: inv.terms || profile?.invoice_terms || "",
    bank_details: bankLines.join("\n"),
    currency,
  };

  return { components, tableSettings, pageSettings, data };
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
  const pdf = await renderToPdf(loaded);
  pdf.save(`Invoice-${sanitize(loaded.data.invoice_number || invoiceId)}.pdf`);
}
