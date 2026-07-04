import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type LayoutItem } from "react-grid-layout";
import ComponentLibrary from "@/components/invoice-designer/ComponentLibrary";
import DesignCanvas from "@/components/invoice-designer/DesignCanvas";
import PropertiesPanel from "@/components/invoice-designer/PropertiesPanel";
import DesignerToolbar from "@/components/invoice-designer/DesignerToolbar";
import InvoicePreview from "@/components/invoice-designer/InvoicePreview";
import { getStandardTemplate, DEFAULT_TABLE_SETTINGS, DEFAULT_PAGE_SETTINGS, SAMPLE_INVOICE_DATA } from "@/components/invoice-designer/templateDefaults";
import { useSaveInvoiceTemplate, useInvoiceTemplate } from "@/hooks/useInvoiceTemplates";
import type { DesignerComponent, TableSettings, PageSettings } from "@/components/invoice-designer/types";
import { toast } from "sonner";

// Random ids: sequential counters collide with ids already saved in a loaded
// template (duplicate React keys silently corrupt the grid layout).
const newCompId = () => `comp-${crypto.randomUUID().slice(0, 8)}`;

export default function InvoiceTemplateDesigner() {
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get("id") || undefined;
  const navigate = useNavigate();
  const { data: existingTemplate } = useInvoiceTemplate(templateId);
  const saveTemplate = useSaveInvoiceTemplate();

  const [components, setComponents] = useState<DesignerComponent[]>(getStandardTemplate);
  const [tableSettings, setTableSettings] = useState<TableSettings>(DEFAULT_TABLE_SETTINGS);
  const [pageSettings, setPageSettings] = useState<PageSettings>(DEFAULT_PAGE_SETTINGS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // New templates arrive from the list page with ?name=&type= prefilled.
  const [templateName, setTemplateName] = useState(searchParams.get("name") || "Standard Invoice");
  const [templateType, setTemplateType] = useState(searchParams.get("type") || "standard");
  const [isDefault, setIsDefault] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // History is seeded with the initial layout so the very first change is
  // undoable back to the starting point.
  const [history, setHistory] = useState<DesignerComponent[][]>(() => [getStandardTemplate()]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const styleHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing template
  useEffect(() => {
    if (existingTemplate) {
      setTemplateName(existingTemplate.template_name);
      setTemplateType(existingTemplate.template_type);
      setIsDefault(existingTemplate.is_default);
      const layoutData = existingTemplate.layout_json;
      if (Array.isArray(layoutData) && layoutData.length > 0) {
        const comps = layoutData as unknown as DesignerComponent[];
        setComponents(comps);
        setHistory([comps]);
        setHistoryIndex(0);
      }
      const ts = existingTemplate.table_settings;
      if (ts && typeof ts === 'object' && 'columns' in (ts as any)) {
        setTableSettings(ts as unknown as TableSettings);
      }
      const ps = existingTemplate.page_settings;
      if (ps && typeof ps === 'object' && 'size' in (ps as any)) {
        setPageSettings(ps as unknown as PageSettings);
      }
    }
  }, [existingTemplate]);

  const pushHistory = useCallback((comps: DesignerComponent[]) => {
    setHistory(prev => [...prev.slice(0, historyIndex + 1), comps]);
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const selectedComponent = components.find(c => c.id === selectedId) || null;

  const defaultStyleFor = (type: string): DesignerComponent['style'] => {
    switch (type) {
      case 'divider': return { borderColor: '#e5e7eb', borderWidth: 1 };
      case 'image': return { imageFit: 'contain', borderRadius: 0 };
      case 'shape': return { backgroundColor: '#f3f4f6', borderStyle: 'none', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4 };
      default: return { fontSize: 12, color: '#000000', textAlign: 'left' };
    }
  };

  const handleAddComponent = useCallback((def: any) => {
    const maxY = components.length > 0 ? Math.max(...components.map(c => c.y + c.h)) : 0;
    const newComp: DesignerComponent = {
      id: newCompId(),
      type: def.type,
      category: def.category,
      label: def.label,
      binding: def.binding,
      defaultValue: def.defaultValue,
      x: 0,
      y: maxY,
      w: def.type === 'table' ? 12 : def.type === 'divider' ? 12 : def.type === 'image' ? 4 : def.type === 'shape' ? 6 : 6,
      h: def.type === 'table' ? 6 : def.type === 'divider' ? 1 : def.type === 'image' ? 3 : def.type === 'shape' ? 3 : 2,
      style: defaultStyleFor(def.type),
    };
    const updated = [...components, newComp];
    setComponents(updated);
    setSelectedId(newComp.id);
    pushHistory(updated);
  }, [components, pushHistory]);

  const handleLayoutChange = useCallback((layout: readonly LayoutItem[]) => {
    setComponents(prev => {
      let changed = false;
      const updated = prev.map(comp => {
        const item = layout.find(l => l.i === comp.id);
        if (!item) return comp;
        if (item.x === comp.x && item.y === comp.y && item.w === comp.w && item.h === comp.h) return comp;
        changed = true;
        return { ...comp, x: item.x, y: item.y, w: item.w, h: item.h };
      });
      if (!changed) return prev;
      // Record moves/resizes so they participate in undo/redo.
      setHistory(h => [...h.slice(0, historyIndex + 1), updated]);
      setHistoryIndex(i => i + 1);
      return updated;
    });
  }, [historyIndex]);

  const handleUpdateComponent = useCallback((id: string, updates: Partial<DesignerComponent>) => {
    setComponents(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, ...updates, style: updates.style ? { ...c.style, ...updates.style } : c.style } : c);
      // Debounced history push: colour pickers / typing fire per keystroke, but
      // one editing burst should be a single undo step.
      if (styleHistoryTimer.current) clearTimeout(styleHistoryTimer.current);
      styleHistoryTimer.current = setTimeout(() => {
        setHistory(h => [...h.slice(0, historyIndex + 1), updated]);
        setHistoryIndex(i => i + 1);
      }, 500);
      return updated;
    });
  }, [historyIndex]);

  const handleDeleteComponent = useCallback((id: string) => {
    const updated = components.filter(c => c.id !== id);
    setComponents(updated);
    setSelectedId(null);
    pushHistory(updated);
  }, [components, pushHistory]);

  const handleDuplicateComponent = useCallback((id: string) => {
    const comp = components.find(c => c.id === id);
    if (!comp) return;
    const dup: DesignerComponent = { ...comp, id: newCompId(), y: comp.y + comp.h };
    const updated = [...components, dup];
    setComponents(updated);
    setSelectedId(dup.id);
    pushHistory(updated);
  }, [components, pushHistory]);

  const handleUpdateTableSettings = useCallback((updates: Partial<TableSettings>) => {
    setTableSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const handleSave = async () => {
    await saveTemplate.mutateAsync({
      id: templateId,
      template_name: templateName,
      template_type: templateType,
      layout_json: components,
      page_settings: pageSettings,
      table_settings: tableSettings,
      is_default: isDefault,
    });
    navigate("/sales/invoice-templates");
  };

  const handleReset = () => {
    const fresh = getStandardTemplate();
    setComponents(fresh);
    setTableSettings(DEFAULT_TABLE_SETTINGS);
    setPageSettings(DEFAULT_PAGE_SETTINGS);
    setSelectedId(null);
    pushHistory(fresh);
    toast.info("Layout reset to default");
  };

  const handleSetDefault = () => {
    setIsDefault(true);
    toast.info("This template will be set as default on save");
  };

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    setHistoryIndex(prev => prev - 1);
    setComponents(history[historyIndex - 1]);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    setHistoryIndex(prev => prev + 1);
    setComponents(history[historyIndex + 1]);
  };

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      <DesignerToolbar
        templateName={templateName}
        templateType={templateType}
        pageSettings={pageSettings}
        isSaving={saveTemplate.isPending}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onNameChange={setTemplateName}
        onTypeChange={setTemplateType}
        onPageSettingsChange={updates => setPageSettings(prev => ({ ...prev, ...updates }))}
        onSave={handleSave}
        onPreview={() => setPreviewOpen(true)}
        onReset={handleReset}
        onSetDefault={handleSetDefault}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
      <div className="flex flex-1 overflow-hidden">
        <ComponentLibrary onAddComponent={handleAddComponent} />
        <DesignCanvas
          components={components}
          tableSettings={tableSettings}
          pageSettings={pageSettings}
          selectedId={selectedId}
          sampleData={SAMPLE_INVOICE_DATA}
          onSelect={setSelectedId}
          onLayoutChange={handleLayoutChange}
        />
        <PropertiesPanel
          component={selectedComponent}
          tableSettings={tableSettings}
          onUpdate={handleUpdateComponent}
          onDelete={handleDeleteComponent}
          onDuplicate={handleDuplicateComponent}
          onUpdateTableSettings={handleUpdateTableSettings}
        />
      </div>
      <InvoicePreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        components={components}
        tableSettings={tableSettings}
        pageSettings={pageSettings}
        data={SAMPLE_INVOICE_DATA}
      />
    </div>
  );
}
