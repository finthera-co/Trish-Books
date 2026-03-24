import type { DesignerComponent, TableSettings, PageSettings, InvoiceData } from './types';

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  columns: [
    { key: 'item', label: 'Item', visible: true, width: 20, align: 'left' },
    { key: 'description', label: 'Description', visible: true, width: 25, align: 'left' },
    { key: 'qty', label: 'Qty', visible: true, width: 8, align: 'center' },
    { key: 'unit', label: 'Unit', visible: false, width: 8, align: 'center' },
    { key: 'rate', label: 'Rate', visible: true, width: 12, align: 'right' },
    { key: 'discount', label: 'Discount', visible: false, width: 10, align: 'right' },
    { key: 'tax', label: 'Tax', visible: true, width: 10, align: 'right' },
    { key: 'amount', label: 'Amount', visible: true, width: 15, align: 'right' },
  ],
  headerBg: '#1a1a2e',
  headerColor: '#ffffff',
  headerFontSize: 11,
  rowFontSize: 10,
  rowSpacing: 8,
  borderStyle: 'solid',
  borderColor: '#e5e7eb',
  alternateRowColor: '#f9fafb',
  showAlternateRows: true,
};

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  size: 'A4',
  orientation: 'portrait',
  margins: { top: 40, bottom: 40, left: 40, right: 40 },
};

export const SAMPLE_INVOICE_DATA: InvoiceData = {
  company_name: 'Finthera Ltd.',
  company_address: '123 Business Ave, Colombo 03, Sri Lanka',
  company_phone: '+94 11 234 5678',
  company_email: 'info@finthera.com',
  company_tax_number: 'TAX-123456789',
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
  tax: 0,
  shipping: 0,
  adjustment: 0,
  total: 325000,
  paid_amount: 0,
  balance_due: 325000,
  notes: 'Thank you for your business.',
  terms: 'Payment is due within 30 days.',
  bank_details: 'Bank: Commercial Bank\nAcc: 1234567890\nBranch: Colombo Fort',
  currency: 'LKR',
};

let idCounter = 0;
const uid = () => `comp-${++idCounter}`;

export function getStandardTemplate(): DesignerComponent[] {
  idCounter = 0;
  return [
    // Company section - top left
    { id: uid(), type: 'text', category: 'company', label: 'Company Name', binding: 'company_name', defaultValue: 'Company Name', x: 0, y: 0, w: 6, h: 2, style: { fontSize: 20, fontWeight: 'bold', color: '#1a1a2e', textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'company', label: 'Company Address', binding: 'company_address', defaultValue: 'Company Address', x: 0, y: 2, w: 6, h: 1, style: { fontSize: 9, color: '#6b7280', textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'company', label: 'Company Phone', binding: 'company_phone', defaultValue: 'Phone', x: 0, y: 3, w: 3, h: 1, style: { fontSize: 9, color: '#6b7280', textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'company', label: 'Company Email', binding: 'company_email', defaultValue: 'Email', x: 3, y: 3, w: 3, h: 1, style: { fontSize: 9, color: '#6b7280', textAlign: 'left' } },

    // Invoice title - top right
    { id: uid(), type: 'text', category: 'meta', label: 'Invoice Title', binding: 'invoice_title', defaultValue: 'INVOICE', x: 8, y: 0, w: 4, h: 2, style: { fontSize: 28, fontWeight: 'bold', color: '#1a1a2e', textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'meta', label: 'Invoice Number', binding: 'invoice_number', defaultValue: 'INV-0001', x: 8, y: 2, w: 4, h: 1, style: { fontSize: 11, color: '#374151', textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'meta', label: 'Invoice Date', binding: 'invoice_date', defaultValue: '2026-01-01', x: 8, y: 3, w: 4, h: 1, style: { fontSize: 10, color: '#6b7280', textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'meta', label: 'Due Date', binding: 'due_date', defaultValue: '2026-02-01', x: 8, y: 4, w: 4, h: 1, style: { fontSize: 10, color: '#6b7280', textAlign: 'right' } },

    // Divider
    { id: uid(), type: 'divider', category: 'custom', label: 'Divider', x: 0, y: 5, w: 12, h: 1, style: { borderColor: '#e5e7eb', borderWidth: 1 } },

    // Bill To section
    { id: uid(), type: 'text', category: 'customer', label: 'Bill To Label', defaultValue: 'Bill To:', x: 0, y: 6, w: 2, h: 1, style: { fontSize: 10, fontWeight: 'bold', color: '#6b7280', textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'customer', label: 'Customer Name', binding: 'customer_name', defaultValue: 'Customer Name', x: 0, y: 7, w: 6, h: 1, style: { fontSize: 12, fontWeight: 'bold', color: '#111827', textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'customer', label: 'Customer Address', binding: 'customer_address', defaultValue: 'Customer Address', x: 0, y: 8, w: 6, h: 1, style: { fontSize: 9, color: '#6b7280', textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'customer', label: 'Customer Email', binding: 'customer_email', defaultValue: 'customer@email.com', x: 0, y: 9, w: 6, h: 1, style: { fontSize: 9, color: '#6b7280', textAlign: 'left' } },

    // Items table
    { id: uid(), type: 'table', category: 'table', label: 'Invoice Items Table', x: 0, y: 11, w: 12, h: 6, style: {} },

    // Totals
    { id: uid(), type: 'text', category: 'totals', label: 'Subtotal', binding: 'subtotal', defaultValue: '0.00', x: 8, y: 18, w: 4, h: 1, style: { fontSize: 10, color: '#374151', textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'totals', label: 'Tax', binding: 'tax', defaultValue: '0.00', x: 8, y: 19, w: 4, h: 1, style: { fontSize: 10, color: '#374151', textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'totals', label: 'Total', binding: 'total', defaultValue: '0.00', x: 8, y: 20, w: 4, h: 2, style: { fontSize: 16, fontWeight: 'bold', color: '#1a1a2e', textAlign: 'right' } },
    { id: uid(), type: 'text', category: 'totals', label: 'Balance Due', binding: 'balance_due', defaultValue: '0.00', x: 8, y: 22, w: 4, h: 1, style: { fontSize: 12, fontWeight: 'bold', color: '#dc2626', textAlign: 'right' } },

    // Footer
    { id: uid(), type: 'text', category: 'footer', label: 'Notes', binding: 'notes', defaultValue: 'Thank you for your business.', x: 0, y: 24, w: 6, h: 2, style: { fontSize: 9, color: '#6b7280', textAlign: 'left' } },
    { id: uid(), type: 'text', category: 'footer', label: 'Terms', binding: 'terms', defaultValue: 'Payment due within 30 days.', x: 0, y: 26, w: 6, h: 2, style: { fontSize: 9, color: '#6b7280', textAlign: 'left' } },
  ];
}
