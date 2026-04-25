import { useCallback, useRef } from "react";
import GridLayout, { type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { DesignerComponent, TableSettings, InvoiceData } from "./types";
import { formatCurrency } from "@/lib/currency";

interface Props {
  components: DesignerComponent[];
  tableSettings: TableSettings;
  selectedId: string | null;
  sampleData: InvoiceData;
  onSelect: (id: string | null) => void;
  onLayoutChange: (layout: readonly LayoutItem[]) => void;
}

const COLS = 12;
const ROW_HEIGHT = 28;
const CANVAS_WIDTH = 595;

export default function DesignCanvas({ components, tableSettings, selectedId, sampleData, onSelect, onLayoutChange }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);

  const resolveBinding = useCallback((comp: DesignerComponent): string => {
    if (!comp.binding) return comp.defaultValue || comp.label;
    const val = (sampleData as any)[comp.binding];
    if (val === undefined || val === null) return comp.defaultValue || '';
    if (typeof val === 'number') {
      if (['subtotal', 'discount', 'tax', 'shipping', 'adjustment', 'total', 'paid_amount', 'balance_due'].includes(comp.binding)) {
        return formatCurrency(val);
      }
      return String(val);
    }
    return String(val);
  }, [sampleData]);

  const layout: LayoutItem[] = components.map(c => ({
    i: c.id,
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h,
    minW: 1,
    minH: 1,
  }));

  const renderComponent = (comp: DesignerComponent) => {
    const isSelected = comp.id === selectedId;
    const baseClasses = `cursor-pointer transition-all ${isSelected ? 'ring-2 ring-primary ring-offset-1' : 'hover:ring-1 hover:ring-primary/30'}`;

    if (comp.type === 'divider') {
      return (
        <div key={comp.id} className={baseClasses} onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }}>
          <div className="w-full h-full flex items-center">
            <hr className="w-full" style={{ borderColor: comp.style.borderColor || '#e5e7eb', borderWidth: comp.style.borderWidth || 1 }} />
          </div>
        </div>
      );
    }

    if (comp.type === 'spacer') {
      return (
        <div key={comp.id} className={`${baseClasses} bg-muted/20 border border-dashed border-muted-foreground/20`} onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }}>
          <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground">Spacer</div>
        </div>
      );
    }

    if (comp.type === 'image') {
      const url = comp.style.imageUrl;
      const fit = comp.style.imageFit || 'contain';
      return (
        <div key={comp.id} className={baseClasses} onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }}>
          {url ? (
            <img src={url} alt={comp.label} style={{ width: '100%', height: '100%', objectFit: fit, borderRadius: comp.style.borderRadius || 0 }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground bg-muted/20 border border-dashed border-muted-foreground/30 rounded text-center px-1">
              Select &amp; upload logo →
            </div>
          )}
        </div>
      );
    }

    if (comp.type === 'table') {
      const visibleCols = tableSettings.columns.filter(c => c.visible);
      return (
        <div key={comp.id} className={baseClasses} onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }}>
          <div className="w-full h-full overflow-hidden">
            <table className="w-full text-[9px] border-collapse">
              <thead>
                <tr style={{ backgroundColor: tableSettings.headerBg, color: tableSettings.headerColor }}>
                  {visibleCols.map(col => (
                    <th key={col.key} className="px-1.5 py-1 font-medium" style={{ textAlign: col.align, fontSize: tableSettings.headerFontSize * 0.8 }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleData.items.slice(0, 3).map((item, i) => (
                  <tr key={i} style={{ backgroundColor: tableSettings.showAlternateRows && i % 2 === 1 ? tableSettings.alternateRowColor : 'transparent', borderBottom: `1px ${tableSettings.borderStyle} ${tableSettings.borderColor}` }}>
                    {visibleCols.map(col => (
                      <td key={col.key} className="px-1.5 py-0.5" style={{ textAlign: col.align, fontSize: tableSettings.rowFontSize * 0.8 }}>
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
        </div>
      );
    }

    const s = comp.style;
    const textStyle: React.CSSProperties = {
      fontSize: (s.fontSize || 12) * 0.75,
      fontWeight: s.fontWeight || 'normal',
      fontStyle: s.fontStyle || 'normal',
      color: s.color || '#000000',
      backgroundColor: s.backgroundColor || 'transparent',
      textAlign: s.textAlign || 'left',
      padding: s.padding || 0,
      borderRadius: s.borderRadius || 0,
      lineHeight: 1.3,
      overflow: 'hidden',
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
    };

    const text = resolveBinding(comp);
    const isTotalsLabel = comp.category === 'totals';

    return (
      <div key={comp.id} className={baseClasses} onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }} style={textStyle}>
        <span className="w-full" style={{ textAlign: s.textAlign || 'left' }}>
          {isTotalsLabel && comp.label !== 'Total' && comp.label !== 'Balance Due' ? (
            <span>{comp.label}: {text}</span>
          ) : text}
        </span>
      </div>
    );
  };

  return (
    <div className="flex-1 bg-muted/30 overflow-auto p-6 flex justify-center" onClick={() => onSelect(null)}>
      <div ref={canvasRef} className="bg-white shadow-xl border border-border rounded" style={{ width: CANVAS_WIDTH, minHeight: 842 }}>
        <div className="p-6">
          <GridLayout
            className="layout"
            layout={layout}
            width={CANVAS_WIDTH - 48}
            onLayoutChange={onLayoutChange}
            gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [4, 4] as readonly [number, number] }}
            autoSize
          >
            {components.map(renderComponent)}
          </GridLayout>
        </div>
      </div>
    </div>
  );
}
