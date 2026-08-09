import type { DesignerComponent, TableSettings, PageSettings, InvoiceData } from './types';

// Items table matching the built-in vector PDF: dark slate header, # line
// numbers, merged Item & Description column, red discounts, bold amounts.
export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  columns: [
    { key: 'index', label: '#', visible: true, width: 6, align: 'center' },
    { key: 'item_description', label: 'Item & Description', visible: true, width: 40, align: 'left' },
    { key: 'item', label: 'Item', visible: false, width: 20, align: 'left' },
    { key: 'description', label: 'Description', visible: false, width: 25, align: 'left' },
    { key: 'qty', label: 'Qty', visible: true, width: 8, align: 'center' },
    { key: 'unit', label: 'Unit', visible: false, width: 8, align: 'center' },
    { key: 'rate', label: 'Rate', visible: true, width: 16, align: 'right' },
    { key: 'discount', label: 'Discount', visible: true, width: 12, align: 'right' },
    { key: 'tax', label: 'Tax', visible: false, width: 10, align: 'right' },
    { key: 'amount', label: 'Amount', visible: true, width: 18, align: 'right' },
  ],
  headerBg: '#2d3748',
  headerColor: '#ffffff',
  headerFontSize: 9,
  rowFontSize: 9,
  rowSpacing: 8,
  borderStyle: 'solid',
  borderColor: '#e5e7eb',
  alternateRowColor: '#fafafb',
  showAlternateRows: true,
};

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  size: 'A4',
  orientation: 'portrait',
  // Left/right must satisfy: left + 12 cols × 45px + right ≤ 595px page width.
  // At 40px the last grid column fell off the sheet and value boxes were
  // clamped to 65px, wrapping every right-aligned amount.
  margins: { top: 40, bottom: 40, left: 24, right: 24 },
  fontFamily: 'Helvetica',
  dateFormat: 'DD MMM YYYY',
  pageFooter: { enabled: true, message: 'Thank you for your business' },
};

export const SAMPLE_INVOICE_DATA: InvoiceData = {
  company_name: 'Trish Books Ltd.',
  company_address: '123 Business Ave, Colombo 03, Sri Lanka',
  company_phone: '+94 11 234 5678',
  company_email: 'info@trishbooks.com',
  company_tax_number: 'TIN: 123456789',
  company_registration: 'PV 12345678',
  customer_name: 'ABC Corporation',
  customer_address: '456 Client Street, Kandy, Sri Lanka',
  customer_phone: '+94 81 234 5678',
  customer_email: 'accounts@abc-corp.com',
  customer_tax_id: 'CT-987654321',
  invoice_title: 'INVOICE',
  invoice_number: 'INV-0001',
  invoice_date: '2026-03-24',
  due_date: '2026-04-24',
  payment_terms: 'Net 30',
  salesperson: 'John Silva',
  reference_number: 'PO-2024-001',
  items: [
    { item: 'Web Development', description: 'Custom website development', qty: 1, unit: 'project', rate: 250000, discount: 0, tax: 0, amount: 250000 },
    { item: 'Hosting', description: 'Annual hosting package', qty: 12, unit: 'months', rate: 5000, discount: 0, tax: 0, amount: 60000 },
    { item: 'SSL Certificate', description: 'SSL certificate renewal', qty: 1, unit: 'year', rate: 15000, discount: 0, tax: 0, amount: 15000 },
  ],
  subtotal: 325000,
  discount: 0,
  taxable_amount: 325000,
  tax: 0,
  shipping: 0,
  adjustment: 0,
  total: 325000,
  paid_amount: 0,
  balance_due: 325000,
  amount_in_words: 'Rupees Three Hundred Twenty-Five Thousand only',
  notes: 'Thank you for your business.',
  terms: 'Payment is due within 30 days.',
  bank_details: 'Bank: Commercial Bank\nAcc: 1234567890\nBranch: Colombo Fort',
  currency: 'LKR',
};

let idCounter = 0;
const uid = () => `comp-${++idCounter}`;

// Palette lifted from the built-in vector PDF (invoicePdf.ts).
const INK = '#111827';        // primary text
const MUTED = '#6b7280';      // secondary text
const SLATE = '#2d3748';      // section labels / table header
const TITLE_GRAY = '#5a6068'; // big INVOICE word
const DUE_RED = '#dc2626';    // balance due amount
const SHADE = '#f3f4f6';      // balance-due highlight bar

/**
 * Default designer layout — a 1:1 mirror of the built-in vector invoice PDF:
 * logo + company + TIN (left) · big gray INVOICE (right); BILL TO (left) ·
 * Invoice#/Date/Terms/Due Date label-value rows and the shaded Balance Due
 * chip (right); dark-header items table with # and merged Item & Description;
 * Sub Total / Discount / Taxable amount / Total and the shaded Balance Due
 * bar (right). The page footer (logo · company · BR No · thank-you · page
 * numbers) comes from pageSettings.pageFooter, repeated on every page.
 */
export function getStandardTemplate(): DesignerComponent[] {
  idCounter = 0;
  return [
    // ── Header: logo + company (left) · INVOICE title (right) ────────────
    // Company text starts at x:2.4 — a 0.4-col (18px) gutter after the logo
    // box, so a full-width logo never touches the name/TIN text.
    { id: uid(), type: 'image', category: 'company', label: 'Company Logo', binding: 'company_logo', x: 0, y: 0, w: 2, h: 2, style: { imageFit: 'contain', borderRadius: 0 } },
    { id: uid(), type: 'text', category: 'company', label: 'Company Name', binding: 'company_name', defaultValue: 'Company Name', x: 2.4, y: 0, w: 5.5, h: 1, style: { fontSize: 13, fontWeight: 'bold', color: INK, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'company', label: 'Tax Number', binding: 'company_tax_number', defaultValue: 'TIN: 123456789', x: 2.4, y: 1, w: 5.5, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'company', label: 'Company Address', binding: 'company_address', defaultValue: '', x: 2.4, y: 2, w: 5.5, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'company', label: 'Company Phone', binding: 'company_phone', defaultValue: '', x: 2.4, y: 3, w: 5.5, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'meta', label: 'Invoice Title', binding: 'invoice_title', defaultValue: 'INVOICE', x: 8, y: 0, w: 4, h: 2, style: { fontSize: 26, fontWeight: 'bold', color: TITLE_GRAY, textAlign: 'right' } },

    // ── Rule under the header ────────────────────────────────────────────
    { id: uid(), type: 'divider', category: 'custom', label: 'Divider', x: 0, y: 4, w: 12, h: 1, style: { borderColor: '#e5e7eb', borderWidth: 1 } },

    // ── BILL TO (left) ───────────────────────────────────────────────────
    { id: uid(), type: 'text', category: 'customer', label: 'Bill To Label', defaultValue: 'BILL TO', x: 0, y: 5, w: 3, h: 1, style: { fontSize: 8, fontWeight: 'bold', color: SLATE, textAlign: 'left', textTransform: 'uppercase' } },
    { id: uid(), type: 'text', category: 'customer', label: 'Customer Name', binding: 'customer_name', defaultValue: 'Customer Name', x: 0, y: 6, w: 6, h: 1, style: { fontSize: 11, fontWeight: 'bold', color: INK, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'customer', label: 'Customer Address', binding: 'customer_address', defaultValue: '', x: 0, y: 7, w: 6, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'customer', label: 'Customer Email', binding: 'customer_email', defaultValue: '', x: 0, y: 8, w: 6, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },

    // ── Invoice meta rows: muted label (left) · bold value (right) ───────
    { id: uid(), type: 'text', category: 'custom', label: 'Invoice# Label', defaultValue: 'Invoice#', x: 7, y: 5, w: 2, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'meta', label: 'Invoice Number', binding: 'invoice_number', defaultValue: 'INV-0001', x: 9, y: 5, w: 3, h: 1, style: { fontSize: 9, fontWeight: 'bold', color: INK, textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'custom', label: 'Invoice Date Label', defaultValue: 'Invoice Date', x: 7, y: 6, w: 2, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'meta', label: 'Invoice Date', binding: 'invoice_date', defaultValue: '03 Jul 2026', x: 9, y: 6, w: 3, h: 1, style: { fontSize: 9, fontWeight: 'bold', color: INK, textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'custom', label: 'Terms Label', defaultValue: 'Terms', x: 7, y: 7, w: 2, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'meta', label: 'Payment Terms', binding: 'payment_terms', defaultValue: 'Net 30', x: 9, y: 7, w: 3, h: 1, style: { fontSize: 9, fontWeight: 'bold', color: INK, textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'custom', label: 'Due Date Label', defaultValue: 'Due Date', x: 7, y: 8, w: 2, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'meta', label: 'Due Date', binding: 'due_date', defaultValue: '02 Aug 2026', x: 9, y: 8, w: 3, h: 1, style: { fontSize: 9, fontWeight: 'bold', color: INK, textAlign: 'right' } },

    // ── Balance Due chip (right, shaded) ─────────────────────────────────
    { id: uid(), type: 'text', category: 'custom', label: 'Balance Due Chip Label', defaultValue: 'Balance Due (LKR)', x: 7, y: 9, w: 3, h: 1, style: { fontSize: 9, fontWeight: 'bold', color: INK, textAlign: 'left', backgroundColor: SHADE, padding: 3 } },
    { id: uid(), type: 'text', category: 'totals', label: 'Balance Due', binding: 'balance_due', defaultValue: '0.00', x: 10, y: 9, w: 2, h: 1, style: { fontSize: 9, fontWeight: 'bold', color: DUE_RED, textAlign: 'right', backgroundColor: SHADE, padding: 3 } },

    // ── Items table: # · Item & Description · Qty · Rate · Discount · Amount
    // y:11 leaves a full grid row of air under the Balance Due chip (y:9).
    { id: uid(), type: 'table', category: 'table', label: 'Invoice Items Table', x: 0, y: 11, w: 12, h: 6, style: {} },

    // ── Totals (right): Sub Total / Discount / Taxable amount / Total ────
    { id: uid(), type: 'text', category: 'custom', label: 'Sub Total Label', defaultValue: 'Sub Total', x: 7, y: 17, w: 3, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'totals', label: 'Sub Total', binding: 'subtotal', defaultValue: '0.00', x: 10, y: 17, w: 2, h: 1, style: { fontSize: 9, color: INK, textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'custom', label: 'Discount Label', defaultValue: 'Discount', x: 7, y: 18, w: 3, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'totals', label: 'Discount', binding: 'discount', defaultValue: '0.00', x: 10, y: 18, w: 2, h: 1, style: { fontSize: 9, color: INK, textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'custom', label: 'Taxable Label', defaultValue: 'Taxable amount', x: 7, y: 19, w: 3, h: 1, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'totals', label: 'Taxable Amount', binding: 'taxable_amount', defaultValue: '0.00', x: 10, y: 19, w: 2, h: 1, style: { fontSize: 9, color: INK, textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'custom', label: 'Total Label', defaultValue: 'Total', x: 7, y: 20, w: 3, h: 1, style: { fontSize: 10, fontWeight: 'bold', color: INK, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'totals', label: 'Total', binding: 'total', defaultValue: '0.00', x: 10, y: 20, w: 2, h: 1, style: { fontSize: 10, fontWeight: 'bold', color: INK, textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'custom', label: 'Balance Due Label', defaultValue: 'Balance Due', x: 7, y: 21, w: 3, h: 1, style: { fontSize: 10, fontWeight: 'bold', color: INK, textAlign: 'left', backgroundColor: SHADE, padding: 3 } },
    { id: uid(), type: 'text', category: 'totals', label: 'Balance Due', binding: 'balance_due', defaultValue: '0.00', x: 10, y: 21, w: 2, h: 1, style: { fontSize: 10, fontWeight: 'bold', color: DUE_RED, textAlign: 'right', backgroundColor: SHADE, padding: 3 } },

    // ── Notes / terms (left, print only when the invoice has them) ───────
    { id: uid(), type: 'text', category: 'footer', label: 'Notes', binding: 'notes', defaultValue: '', x: 0, y: 17, w: 6, h: 2, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'footer', label: 'Terms', binding: 'terms', defaultValue: '', x: 0, y: 19, w: 6, h: 2, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },

    // ── Payment details, along the foot of the page ─────────────────────
    // Mirrors the built-in vector PDF: a customer must be able to remit
    // payment from the invoice alone. Pulled from Settings → Bank Details;
    // prints nothing when the tenant hasn't filled them in.
    { id: uid(), type: 'text', category: 'custom', label: 'Payment Details Label', defaultValue: 'PAYMENT DETAILS', x: 0, y: 22, w: 4, h: 1, style: { fontSize: 8, fontWeight: 'bold', color: SLATE, textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'footer', label: 'Bank Details', binding: 'bank_details', defaultValue: '', x: 0, y: 23, w: 12, h: 2, style: { fontSize: 9, color: MUTED, textAlign: 'left' } },
  ];
}
