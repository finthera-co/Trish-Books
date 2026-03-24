import { Building2, User, FileText, Table2, Calculator, FileSignature, Type, Minus, Square } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface ComponentDef {
  type: string;
  category: string;
  label: string;
  binding?: string;
  defaultValue?: string;
  icon: React.ReactNode;
}

const COMPONENT_GROUPS: { title: string; icon: React.ReactNode; items: ComponentDef[] }[] = [
  {
    title: "Company",
    icon: <Building2 className="w-4 h-4" />,
    items: [
      { type: 'text', category: 'company', label: 'Company Name', binding: 'company_name', defaultValue: 'Company Name', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'company', label: 'Company Address', binding: 'company_address', defaultValue: 'Address', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'company', label: 'Company Phone', binding: 'company_phone', defaultValue: 'Phone', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'company', label: 'Company Email', binding: 'company_email', defaultValue: 'Email', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'company', label: 'Tax Number', binding: 'company_tax_number', defaultValue: 'Tax #', icon: <Type className="w-3 h-3" /> },
      { type: 'image', category: 'company', label: 'Company Logo', defaultValue: 'Logo', icon: <Square className="w-3 h-3" /> },
    ],
  },
  {
    title: "Customer",
    icon: <User className="w-4 h-4" />,
    items: [
      { type: 'text', category: 'customer', label: 'Bill To Label', defaultValue: 'Bill To:', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'customer', label: 'Customer Name', binding: 'customer_name', defaultValue: 'Customer Name', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'customer', label: 'Customer Address', binding: 'customer_address', defaultValue: 'Address', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'customer', label: 'Customer Phone', binding: 'customer_phone', defaultValue: 'Phone', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'customer', label: 'Customer Email', binding: 'customer_email', defaultValue: 'Email', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'customer', label: 'Customer Tax ID', binding: 'customer_tax_id', defaultValue: 'Tax ID', icon: <Type className="w-3 h-3" /> },
    ],
  },
  {
    title: "Invoice Details",
    icon: <FileText className="w-4 h-4" />,
    items: [
      { type: 'text', category: 'meta', label: 'Invoice Title', binding: 'invoice_title', defaultValue: 'INVOICE', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'meta', label: 'Invoice Number', binding: 'invoice_number', defaultValue: 'INV-0001', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'meta', label: 'Invoice Date', binding: 'invoice_date', defaultValue: 'Date', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'meta', label: 'Due Date', binding: 'due_date', defaultValue: 'Due Date', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'meta', label: 'Payment Terms', binding: 'payment_terms', defaultValue: 'Net 30', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'meta', label: 'Salesperson', binding: 'salesperson', defaultValue: 'Salesperson', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'meta', label: 'Reference Number', binding: 'reference_number', defaultValue: 'Ref #', icon: <Type className="w-3 h-3" /> },
    ],
  },
  {
    title: "Items Table",
    icon: <Table2 className="w-4 h-4" />,
    items: [
      { type: 'table', category: 'table', label: 'Invoice Items Table', defaultValue: 'Items Table', icon: <Table2 className="w-3 h-3" /> },
    ],
  },
  {
    title: "Totals",
    icon: <Calculator className="w-4 h-4" />,
    items: [
      { type: 'text', category: 'totals', label: 'Subtotal', binding: 'subtotal', defaultValue: '0.00', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'totals', label: 'Discount', binding: 'discount', defaultValue: '0.00', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'totals', label: 'Tax', binding: 'tax', defaultValue: '0.00', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'totals', label: 'Shipping', binding: 'shipping', defaultValue: '0.00', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'totals', label: 'Adjustment', binding: 'adjustment', defaultValue: '0.00', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'totals', label: 'Total', binding: 'total', defaultValue: '0.00', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'totals', label: 'Paid Amount', binding: 'paid_amount', defaultValue: '0.00', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'totals', label: 'Balance Due', binding: 'balance_due', defaultValue: '0.00', icon: <Type className="w-3 h-3" /> },
    ],
  },
  {
    title: "Footer",
    icon: <FileSignature className="w-4 h-4" />,
    items: [
      { type: 'text', category: 'footer', label: 'Notes', binding: 'notes', defaultValue: 'Notes...', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'footer', label: 'Terms & Conditions', binding: 'terms', defaultValue: 'Terms...', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'footer', label: 'Bank Details', binding: 'bank_details', defaultValue: 'Bank...', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'footer', label: 'Thank You Message', defaultValue: 'Thank you for your business!', icon: <Type className="w-3 h-3" /> },
      { type: 'text', category: 'footer', label: 'Authorized By', defaultValue: 'Authorized Signature', icon: <Type className="w-3 h-3" /> },
    ],
  },
  {
    title: "Layout",
    icon: <Minus className="w-4 h-4" />,
    items: [
      { type: 'divider', category: 'custom', label: 'Horizontal Divider', defaultValue: '', icon: <Minus className="w-3 h-3" /> },
      { type: 'spacer', category: 'custom', label: 'Spacer', defaultValue: '', icon: <Square className="w-3 h-3" /> },
      { type: 'text', category: 'custom', label: 'Custom Text', defaultValue: 'Custom text here', icon: <Type className="w-3 h-3" /> },
    ],
  },
];

interface Props {
  onAddComponent: (comp: ComponentDef) => void;
}

export default function ComponentLibrary({ onAddComponent }: Props) {
  return (
    <div className="w-56 border-r border-border bg-card flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Components</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Click to add to canvas</p>
      </div>
      <ScrollArea className="flex-1">
        <Accordion type="multiple" defaultValue={COMPONENT_GROUPS.map((_, i) => `group-${i}`)}>
          {COMPONENT_GROUPS.map((group, gi) => (
            <AccordionItem key={gi} value={`group-${gi}`} className="border-none">
              <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                <span className="flex items-center gap-2">
                  {group.icon}
                  {group.title}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-1">
                <div className="space-y-0.5 px-2">
                  {group.items.map((item, ii) => (
                    <button
                      key={ii}
                      onClick={() => onAddComponent(item)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
                    >
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </ScrollArea>
    </div>
  );
}
