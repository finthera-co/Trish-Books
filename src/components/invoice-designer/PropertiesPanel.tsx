import { useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash2, Copy, Upload, Loader2, X } from "lucide-react";
import type { DesignerComponent, TableSettings } from "./types";
import { BINDING_VARIABLES } from "./types";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  component: DesignerComponent | null;
  tableSettings: TableSettings;
  onUpdate: (id: string, updates: Partial<DesignerComponent>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdateTableSettings: (settings: Partial<TableSettings>) => void;
}

export default function PropertiesPanel({ component, tableSettings, onUpdate, onDelete, onDuplicate, onUpdateTableSettings }: Props) {
  const { appUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (!component) {
    return (
      <div className="w-60 border-l border-border bg-card flex items-center justify-center p-4">
        <p className="text-xs text-muted-foreground text-center">Select a component to edit its properties</p>
      </div>
    );
  }

  const style = component.style || {};
  const updateStyle = (updates: Record<string, any>) => {
    onUpdate(component.id, { style: { ...style, ...updates } });
  };

  const handleUploadImage = async (file: File) => {
    if (!appUser?.tenant_id) { toast.error("No tenant"); return; }
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${appUser.tenant_id}/${component.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("invoice-assets").getPublicUrl(path);
      updateStyle({ imageUrl: pub.publicUrl });
      toast.success("Logo uploaded");
    } catch (e: any) {
      toast.error("Upload failed: " + (e.message || "Unknown error"));
    } finally {
      setUploading(false);
    }
  };

  const allBindings = Object.values(BINDING_VARIABLES).flat();

  return (
    <div className="w-60 border-l border-border bg-card flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Properties</h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDuplicate(component.id)}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(component.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Basic Info */}
          <div className="space-y-2">
            <Label className="text-xs">Label</Label>
            <Input value={component.label} onChange={e => onUpdate(component.id, { label: e.target.value })} className="h-8 text-xs" />
          </div>

          {component.type !== 'table' && component.type !== 'divider' && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">Default Value</Label>
                <Input value={component.defaultValue || ''} onChange={e => onUpdate(component.id, { defaultValue: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Data Binding</Label>
                <Select value={component.binding || '_none'} onValueChange={v => onUpdate(component.id, { binding: v === '_none' ? undefined : v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None (static)</SelectItem>
                    {allBindings.map(b => <SelectItem key={b} value={b}>{`{{${b}}}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <Separator />

          {/* Text Styling */}
          {component.type === 'text' && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">Styling</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">Font Size</Label>
                  <Input type="number" value={style.fontSize || 12} onChange={e => updateStyle({ fontSize: Number(e.target.value) })} className="h-7 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Weight</Label>
                  <Select value={style.fontWeight || 'normal'} onValueChange={v => updateStyle({ fontWeight: v })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="bold">Bold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">Text Color</Label>
                  <div className="flex gap-1">
                    <input type="color" value={style.color || '#000000'} onChange={e => updateStyle({ color: e.target.value })} className="w-7 h-7 rounded border cursor-pointer" />
                    <Input value={style.color || '#000000'} onChange={e => updateStyle({ color: e.target.value })} className="h-7 text-[10px] flex-1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Background</Label>
                  <div className="flex gap-1">
                    <input type="color" value={style.backgroundColor || '#ffffff'} onChange={e => updateStyle({ backgroundColor: e.target.value })} className="w-7 h-7 rounded border cursor-pointer" />
                    <Input value={style.backgroundColor || ''} onChange={e => updateStyle({ backgroundColor: e.target.value })} className="h-7 text-[10px] flex-1" placeholder="none" />
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Alignment</Label>
                <div className="flex gap-1">
                  {(['left', 'center', 'right'] as const).map(a => (
                    <Button key={a} variant={style.textAlign === a ? 'default' : 'outline'} size="sm" className="flex-1 h-7 text-[10px]" onClick={() => updateStyle({ textAlign: a })}>
                      {a.charAt(0).toUpperCase() + a.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Font Style</Label>
                <Select value={style.fontStyle || 'normal'} onValueChange={v => updateStyle({ fontStyle: v })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="italic">Italic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">Padding</Label>
                  <Input type="number" value={style.padding || 0} onChange={e => updateStyle({ padding: Number(e.target.value) })} className="h-7 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Border Radius</Label>
                  <Input type="number" value={style.borderRadius || 0} onChange={e => updateStyle({ borderRadius: Number(e.target.value) })} className="h-7 text-xs" />
                </div>
              </div>
            </div>
          )}

          {/* Divider Styling */}
          {component.type === 'divider' && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">Divider Style</h4>
              <div className="space-y-1">
                <Label className="text-[10px]">Color</Label>
                <input type="color" value={style.borderColor || '#e5e7eb'} onChange={e => updateStyle({ borderColor: e.target.value })} className="w-full h-7 rounded border cursor-pointer" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Thickness</Label>
                <Input type="number" value={style.borderWidth || 1} onChange={e => updateStyle({ borderWidth: Number(e.target.value) })} className="h-7 text-xs" />
              </div>
            </div>
          )}

          {/* Table Styling */}
          {component.type === 'table' && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">Table Columns</h4>
              {tableSettings.columns.map((col, i) => (
                <div key={col.key} className="flex items-center gap-2">
                  <Switch checked={col.visible} onCheckedChange={v => {
                    const cols = [...tableSettings.columns];
                    cols[i] = { ...cols[i], visible: v };
                    onUpdateTableSettings({ columns: cols });
                  }} />
                  <Input value={col.label} onChange={e => {
                    const cols = [...tableSettings.columns];
                    cols[i] = { ...cols[i], label: e.target.value };
                    onUpdateTableSettings({ columns: cols });
                  }} className="h-7 text-xs flex-1" />
                </div>
              ))}
              <Separator />
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">Table Styling</h4>
              <div className="space-y-1">
                <Label className="text-[10px]">Header Background</Label>
                <input type="color" value={tableSettings.headerBg} onChange={e => onUpdateTableSettings({ headerBg: e.target.value })} className="w-full h-7 rounded border cursor-pointer" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Header Text Color</Label>
                <input type="color" value={tableSettings.headerColor} onChange={e => onUpdateTableSettings({ headerColor: e.target.value })} className="w-full h-7 rounded border cursor-pointer" />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={tableSettings.showAlternateRows} onCheckedChange={v => onUpdateTableSettings({ showAlternateRows: v })} />
                <Label className="text-xs">Alternate Row Colors</Label>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
