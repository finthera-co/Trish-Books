import { useState, useCallback, useEffect } from "react";
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

let nextId = 100;

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
  const [templateName, setTemplateName] = useState("Standard Invoice");
  const [templateType, setTemplateType] = useState("standard");
  const [isDefault, setIsDefault] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [history, setHistory] = useState<DesignerComponent[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Load existing template
  useEffect(() => {
    if (existingTemplate) {
      setTemplateName(existingTemplate.template_name);
      setTemplateType(existingTemplate.template_type);
      setIsDefault(existingTemplate.is_default);
      const layoutData = existingTemplate.layout_json;
      if (Array.isArray(layoutData) && layoutData.length > 0) {
        setComponents(layoutData as unknown as DesignerComponent[]);
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

  const handleAddComponent = useCallback((def: any) => {
    const maxY = components.length > 0 ? Math.max(...components.map(c => c.y + c.h)) : 0;
    const newComp: DesignerComponent = {
      id: `comp-${++nextId}`,
      type: def.type,
      category: def.category,
      label: def.label,
      binding: def.binding,
      defaultValue: def.defaultValue,
      x: 0,
      y: maxY,
      w: def.type === 'table' ? 12 : def.type === 'divider' ? 12 : 6,
      h: def.type === 'table' ? 6 : def.type === 'divider' ? 1 : 2,
      style: def.type === 'divider' ? { borderColor: '#e5e7eb', borderWidth: 1 } : { fontSize: 12, color: '#000000', textAlign: 'left' },
    };
    const updated = [...components, newComp];
    setComponents(updated);
    setSelectedId(newComp.id);
    pushHistory(updated);
  }, [components, pushHistory]);

  const handleLayoutChange = useCallback((layout: readonly LayoutItem[]) => {
    setComponents(prev => prev.map(comp => {
      const item = layout.find(l => l.i === comp.id);
      if (!item) return comp;
      if (item.x === comp.x && item.y === comp.y && item.w === comp.w && item.h === comp.h) return comp;
      return { ...comp, x: item.x, y: item.y, w: item.w, h: item.h };
    }));
  }, []);

  const handleUpdateComponent = useCallback((id: string, updates: Partial<DesignerComponent>) => {
    setComponents(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, ...updates, style: updates.style ? { ...c.style, ...updates.style } : c.style } : c);
      return updated;
    });
  }, []);

  const handleDeleteComponent = useCallback((id: string) => {
    const updated = components.filter(c => c.id !== id);
    setComponents(updated);
    setSelectedId(null);
    pushHistory(updated);
  }, [components, pushHistory]);

  const handleDuplicateComponent = useCallback((id: string) => {
    const comp = components.find(c => c.id === id);
    if (!comp) return;
    const dup: DesignerComponent = { ...comp, id: `comp-${++nextId}`, y: comp.y + comp.h };
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
  };

  const handleReset = () => {
    setComponents(getStandardTemplate());
    setTableSettings(DEFAULT_TABLE_SETTINGS);
    setPageSettings(DEFAULT_PAGE_SETTINGS);
    setSelectedId(null);
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
