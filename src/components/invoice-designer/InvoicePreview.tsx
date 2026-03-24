import { useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import type { DesignerComponent, TableSettings, InvoiceData, PageSettings } from "./types";
import { formatCurrency } from "@/lib/currency";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  components: DesignerComponent[];
  tableSettings: TableSettings;
  pageSettings: PageSettings;
  data: InvoiceData;
}

export default function InvoicePreview({ open, onOpenChange, components, tableSettings, pageSettings, data }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const resolveBinding = useCallback((comp: DesignerComponent): string => {
    if (!comp.binding) return comp.defaultValue || comp.label;
    const val = (data as any)[comp.binding];
    if (val === undefined || val === null) return comp.defaultValue || '';
    if (typeof val === 'number') {
      if (['subtotal', 'discount', 'tax', 'shipping', 'adjustment', 'total', 'paid_amount', 'balance_due'].includes(comp.binding)) {
        return formatCurrency(val);
      }
      return String(val);
    }
    return String(val);
  }, [data]);

  const exportPdf = async () => {
    if (!printRef.current) return;
    const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const isA4 = pageSettings.size === 'A4';
    const isPortrait = pageSettings.orientation === 'portrait';
    const pdf = new jsPDF({
      orientation: isPortrait ? 'portrait' : 'landscape',
      unit: 'mm',
      format: isA4 ? 'a4' : 'letter',
    });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
    pdf.save(`invoice-${data.invoice_number || 'preview'}.pdf`);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !printRef.current) return;
    printWindow.document.write('<html><head><title>Invoice</title><style>body{margin:0;padding:20px;font-family:sans-serif;}@media print{body{padding:0;}}</style></head><body>');
    printWindow.document.write(printRef.current.innerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
  };

  // Sort components by Y position for rendering
  const sorted = [...components].sort((a, b) => a.y - b.y || a.x - b.x);
  const visibleCols = tableSettings.columns.filter(c => c.visible);

  const COL_W = 45; // approx px per grid col at A4
  const ROW_H = 24;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px] max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Invoice Preview</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handlePrint}><Printer className="w-3.5 h-3.5 mr-1" />Print</Button>
              <Button size="sm" onClick={exportPdf}><Download className="w-3.5 h-3.5 mr-1" />PDF</Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div ref={printRef} className="bg-white p-8 border" style={{ width: 595, minHeight: 842, position: 'relative', fontFamily: 'sans-serif' }}>
          {sorted.map(comp => {
            const left = comp.x * COL_W;
            const top = comp.y * ROW_H;
            const width = comp.w * COL_W;
            const height = comp.h * ROW_H;

            if (comp.type === 'divider') {
              return (
                <div key={comp.id} style={{ position: 'absolute', left, top: top + height / 2, width }}>
                  <hr style={{ borderColor: comp.style.borderColor || '#e5e7eb', borderWidth: comp.style.borderWidth || 1 }} />
                </div>
              );
            }

            if (comp.type === 'spacer') return <div key={comp.id} />;

            if (comp.type === 'table') {
              return (
                <div key={comp.id} style={{ position: 'absolute', left, top, width: 12 * COL_W }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: tableSettings.rowFontSize }}>
                    <thead>
                      <tr style={{ backgroundColor: tableSettings.headerBg, color: tableSettings.headerColor }}>
                        {visibleCols.map(col => (
                          <th key={col.key} style={{ padding: '8px 10px', textAlign: col.align, fontSize: tableSettings.headerFontSize, fontWeight: 600 }}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((item, i) => (
                        <tr key={i} style={{
                          backgroundColor: tableSettings.showAlternateRows && i % 2 === 1 ? tableSettings.alternateRowColor : 'transparent',
                          borderBottom: `1px ${tableSettings.borderStyle} ${tableSettings.borderColor}`
                        }}>
                          {visibleCols.map(col => (
                            <td key={col.key} style={{ padding: `${tableSettings.rowSpacing}px 10px`, textAlign: col.align }}>
                              {col.key === 'rate' || col.key === 'amount' || col.key === 'discount' || col.key === 'tax'
                                ? formatCurrency((item as any)[col.key] || 0)
                                : (item as any)[col.key] || ''
                              }
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            // Text
            const s = comp.style;
            const text = resolveBinding(comp);
            const isTotalsLabel = comp.category === 'totals';
            return (
              <div key={comp.id} style={{
                position: 'absolute', left, top, width, height,
                fontSize: s.fontSize || 12,
                fontWeight: s.fontWeight || 'normal',
                fontStyle: s.fontStyle || 'normal',
                color: s.color || '#000000',
                backgroundColor: s.backgroundColor || 'transparent',
                textAlign: s.textAlign || 'left',
                padding: s.padding || 0,
                borderRadius: s.borderRadius || 0,
                display: 'flex',
                alignItems: 'center',
                lineHeight: 1.3,
                overflow: 'hidden',
              }}>
                <span style={{ width: '100%', textAlign: s.textAlign || 'left' }}>
                  {isTotalsLabel && comp.label !== 'Total' && comp.label !== 'Balance Due' ? `${comp.label}: ${text}` : text}
                </span>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
