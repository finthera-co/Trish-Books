export interface DesignerComponent {
  id: string;
  type: 'text' | 'image' | 'table' | 'divider' | 'spacer' | 'shape';
  category: 'company' | 'customer' | 'meta' | 'table' | 'totals' | 'footer' | 'custom';
  label: string;
  binding?: string;
  defaultValue?: string;
  style: ComponentStyle;
  // Grid layout position
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  textTransform?: 'none' | 'uppercase';
  lineHeight?: number;
  borderWidth?: number;
  borderColor?: string;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted';
  padding?: number;
  borderRadius?: number;
  imageUrl?: string;
  imageFit?: 'contain' | 'cover' | 'fill';
}

export interface TableColumn {
  key: string;
  label: string;
  visible: boolean;
  width: number;
  align: 'left' | 'center' | 'right';
}

export interface TableSettings {
  columns: TableColumn[];
  headerBg: string;
  headerColor: string;
  headerFontSize: number;
  rowFontSize: number;
  rowSpacing: number;
  borderStyle: 'none' | 'solid' | 'dashed';
  borderColor: string;
  alternateRowColor: string;
  showAlternateRows: boolean;
}

export type TemplateDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD MMM YYYY' | 'YYYY-MM-DD';

export interface WatermarkSettings {
  enabled: boolean;
  text: string;
  color: string;
  /** 0–1 */
  opacity: number;
}

export interface PageSettings {
  size: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  /** Document-wide font stack. Optional — older templates fall back to sans-serif. */
  fontFamily?: string;
  /** How invoice/due dates are rendered. Optional — older templates fall back to DD MMM YYYY. */
  dateFormat?: TemplateDateFormat;
  /** Diagonal watermark repeated on every page. Optional — off for older templates. */
  watermark?: WatermarkSettings;
  /** Per-page footer: rule + logo + company/BR (left), message (centre), page numbers (right). */
  pageFooter?: {
    enabled: boolean;
    message?: string;
  };
}

export interface InvoiceTemplate {
  id: string;
  tenant_id: string;
  template_name: string;
  template_type: string;
  layout_json: DesignerComponent[];
  page_settings: PageSettings;
  table_settings: TableSettings;
  is_default: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceData {
  company_name: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_tax_number: string;
  company_registration: string;
  company_logo?: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string;
  customer_email: string;
  customer_tax_id: string;
  invoice_title: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  payment_terms: string;
  salesperson: string;
  reference_number: string;
  items: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  /** Subtotal net of line discounts — the base the tax applies to. */
  taxable_amount: number;
  tax: number;
  shipping: number;
  adjustment: number;
  total: number;
  paid_amount: number;
  balance_due: number;
  amount_in_words: string;
  notes: string;
  terms: string;
  bank_details: string;
  currency: string;
}

export interface InvoiceLineItem {
  item: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  discount: number;
  tax: number;
  amount: number;
}

// Data binding variables
export const BINDING_VARIABLES: Record<string, string[]> = {
  company: [
    'company_name', 'company_address', 'company_phone',
    'company_email', 'company_tax_number', 'company_registration',
  ],
  customer: [
    'customer_name', 'customer_address', 'customer_phone',
    'customer_email', 'customer_tax_id',
  ],
  meta: [
    'invoice_title', 'invoice_number', 'invoice_date',
    'due_date', 'payment_terms', 'salesperson', 'reference_number',
  ],
  totals: [
    'subtotal', 'discount', 'taxable_amount', 'tax', 'shipping',
    'adjustment', 'total', 'paid_amount', 'balance_due',
    'amount_in_words',
  ],
  footer: [
    'notes', 'terms', 'bank_details',
  ],
};
