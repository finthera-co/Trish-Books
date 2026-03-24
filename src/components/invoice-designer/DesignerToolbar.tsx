import { Save, Eye, RotateCcw, Star, Undo2, Redo2, FileText, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { PageSettings } from "./types";

interface Props {
  templateName: string;
  templateType: string;
  pageSettings: PageSettings;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onNameChange: (name: string) => void;
  onTypeChange: (type: string) => void;
  onPageSettingsChange: (settings: Partial<PageSettings>) => void;
  onSave: () => void;
  onPreview: () => void;
  onReset: () => void;
  onSetDefault: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export default function DesignerToolbar({
  templateName, templateType, pageSettings, isSaving,
  canUndo, canRedo,
  onNameChange, onTypeChange, onPageSettingsChange,
  onSave, onPreview, onReset, onSetDefault, onUndo, onRedo
}: Props) {
  return (
    <div className="border-b border-border bg-card px-4 py-2 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <FileText className="w-4 h-4 text-primary shrink-0" />
        <Input
          value={templateName}
          onChange={e => onNameChange(e.target.value)}
          className="h-8 text-sm font-medium max-w-[200px]"
          placeholder="Template name"
        />
        <Select value={templateType} onValueChange={onTypeChange}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="tax">Tax Invoice</SelectItem>
            <SelectItem value="pos">POS Invoice</SelectItem>
            <SelectItem value="service">Service Invoice</SelectItem>
            <SelectItem value="proforma">Proforma Invoice</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo} className="h-8">
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onRedo} disabled={!canRedo} className="h-8">
          <Redo2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              <Settings2 className="w-3.5 h-3.5 mr-1" />Page
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Page Settings</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label className="text-xs">Page Size</Label>
                <Select value={pageSettings.size} onValueChange={v => onPageSettingsChange({ size: v as any })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="Letter">Letter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Orientation</Label>
                <Select value={pageSettings.orientation} onValueChange={v => onPageSettingsChange({ orientation: v as any })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['top', 'bottom', 'left', 'right'] as const).map(side => (
                  <div key={side} className="space-y-1">
                    <Label className="text-[10px] capitalize">{side} Margin</Label>
                    <Input
                      type="number"
                      value={pageSettings.margins[side]}
                      onChange={e => onPageSettingsChange({ margins: { ...pageSettings.margins, [side]: Number(e.target.value) } })}
                      className="h-7 text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Button variant="outline" size="sm" onClick={onReset} className="h-8 text-xs">
          <RotateCcw className="w-3.5 h-3.5 mr-1" />Reset
        </Button>
        <Button variant="outline" size="sm" onClick={onSetDefault} className="h-8 text-xs">
          <Star className="w-3.5 h-3.5 mr-1" />Set Default
        </Button>
        <Button variant="outline" size="sm" onClick={onPreview} className="h-8 text-xs">
          <Eye className="w-3.5 h-3.5 mr-1" />Preview
        </Button>
        <Button size="sm" onClick={onSave} disabled={isSaving} className="h-8 text-xs">
          <Save className="w-3.5 h-3.5 mr-1" />{isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
