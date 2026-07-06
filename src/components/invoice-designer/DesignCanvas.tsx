import { useRef } from "react";
import GridLayout, { type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { DesignerComponent, TableSettings, PageSettings, InvoiceData } from "./types";
import { displayText, tableCellContent, FONT_STACKS } from "./renderInvoice";

interface Props {
  components: DesignerComponent[];
  tableSettings: TableSettings;
  pageSettings: PageSettings;
  selectedId: string | null;
  sampleData: InvoiceData;
  onSelect: (id: string | null) => void;
  onLayoutChange: (layout: readonly LayoutItem[]) => void;
}

const COLS = 12;
const ROW_HEIGHT = 28;
const CANVAS_WIDTH = 595;

export default function DesignCanvas({ components, tableSettings, pageSettings, selectedId, sampleData, onSelect, onLayoutChange }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const docFont = FONT_STACKS[pageSettings.fontFamily || ""] || pageSettings.fontFamily || "sans-serif";
  const wm = pageSettings.watermark;

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

    if (comp.type === 'shape') {
      const s = comp.style;
      const hasBorder = !!(s.borderWidth && s.borderStyle && s.borderStyle !== 'none');
      return (
        <div key={comp.id} className={baseClasses} onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }}
          style={{
            width: '100%', height: '100%',
            backgroundColor: s.backgroundColor || 'transparent',
            border: hasBorder ? `${s.borderWidth}px ${s.borderStyle} ${s.borderColor || '#000'}` : '1px dashed rgba(0,0,0,0.15)',
            borderRadius: s.borderRadius || 0,
            boxSizing: 'border-box',
          }} />
      );
    }

    if (comp.type === 'image') {
      const url = comp.binding === 'company_logo' ? (sampleData.company_logo || comp.style.imageUrl) : comp.style.imageUrl;
      const fit = comp.style.imageFit || 'contain';
      return (
        <div key={comp.id} className={baseClasses} onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }}>
          {url ? (
            <img src={url} alt={comp.label} style={{ width: '100%', height: '100%', objectFit: fit, objectPosition: comp.binding === 'company_logo' ? 'left center' : 'center', borderRadius: comp.style.borderRadius || 0 }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground bg-muted/20 border border-dashed border-muted-foreground/30 rounded text-center px-1">
              {comp.binding === 'company_logo' ? 'Company logo (from Settings)' : <>Select &amp; upload logo →</>}
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
            <table className="w-full text-[9px] border-collapse" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ backgroundColor: tableSettings.headerBg, color: tableSettings.headerColor }}>
                  {visibleCols.map(col => (
                    <th key={col.key} className="px-1.5 py-1 font-medium" style={{ textAlign: col.align, fontSize: tableSettings.headerFontSize * 0.8, width: `${col.width}%` }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleData.items.slice(0, 3).map((item, i) => (
                  <tr key={i} style={{ backgroundColor: tableSettings.showAlternateRows && i % 2 === 1 ? tableSettings.alternateRowColor : 'transparent', borderBottom: tableSettings.borderStyle !== 'none' ? `1px ${tableSettings.borderStyle} ${tableSettings.borderColor}` : undefined }}>
                    {visibleCols.map(col => {
                      const cell = tableCellContent(col.key, item as any, i, sampleData.currency);
                      return (
                        <td key={col.key} className="px-1.5 py-0.5" style={{
                          textAlign: col.align,
                          fontSize: tableSettings.rowFontSize * 0.8,
                          whiteSpace: 'pre-line',
                          color: cell.color || (cell.muted ? '#6b7280' : undefined),
                          fontWeight: cell.bold ? 600 : undefined,
                        }}>
                          {cell.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    const s = comp.style;
    const hasBorder = !!(s.borderWidth && s.borderStyle && s.borderStyle !== 'none');
    const textStyle: React.CSSProperties = {
      fontSize: (s.fontSize || 12) * 0.75,
      fontWeight: s.fontWeight || 'normal',
      fontStyle: s.fontStyle || 'normal',
      fontFamily: s.fontFamily ? (FONT_STACKS[s.fontFamily] || s.fontFamily) : undefined,
      color: s.color || '#000000',
      backgroundColor: s.backgroundColor || 'transparent',
      textAlign: s.textAlign || 'left',
      textTransform: s.textTransform === 'uppercase' ? 'uppercase' : undefined,
      border: hasBorder ? `${s.borderWidth}px ${s.borderStyle} ${s.borderColor || '#000'}` : undefined,
      padding: s.padding || 0,
      borderRadius: s.borderRadius || 0,
      lineHeight: s.lineHeight || 1.3,
      overflow: 'hidden',
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      boxSizing: 'border-box',
    };

    const text = displayText(comp, sampleData, pageSettings);

    return (
      <div key={comp.id} className={baseClasses} onClick={(e) => { e.stopPropagation(); onSelect(comp.id); }} style={textStyle}>
        <span className="w-full" style={{ textAlign: s.textAlign || 'left' }}>{text}</span>
      </div>
    );
  };

  return (
    <div className="flex-1 bg-muted/30 overflow-auto p-6 flex justify-center" onClick={() => onSelect(null)}>
      <div ref={canvasRef} className="bg-white shadow-xl border border-border rounded relative overflow-hidden" style={{ width: CANVAS_WIDTH, minHeight: 842, fontFamily: docFont }}>
        {wm?.enabled && wm.text && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none" aria-hidden
            style={{
              fontSize: 72, fontWeight: 'bold', letterSpacing: 8, textTransform: 'uppercase',
              color: wm.color || '#9ca3af', opacity: Math.min(Math.max(wm.opacity ?? 0.12, 0.02), 0.5),
              transform: 'rotate(-30deg)', zIndex: 0,
            }}>
            {wm.text}
          </div>
        )}
        <div className="p-6 relative" style={{ zIndex: 1 }}>
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
