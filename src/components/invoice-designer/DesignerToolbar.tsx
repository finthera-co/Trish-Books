import { Save, Eye, RotateCcw, Star, Undo2, Redo2, FileText, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
          <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
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
              <div className="space-y-2">
                <Label className="text-xs">Font Family</Label>
                <Select value={pageSettings.fontFamily || 'Helvetica'} onValueChange={v => onPageSettingsChange({ fontFamily: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Helvetica">Helvetica / Arial</SelectItem>
                    <SelectItem value="Georgia">Georgia</SelectItem>
                    <SelectItem value="Times">Times New Roman</SelectItem>
                    <SelectItem value="Courier">Courier</SelectItem>
                    <SelectItem value="Verdana">Verdana</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Date Format</Label>
                <Select value={pageSettings.dateFormat || 'DD/MM/YYYY'} onValueChange={v => onPageSettingsChange({ dateFormat: v as any })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DD MMM YYYY">03 Jul 2026</SelectItem>
                    <SelectItem value="DD/MM/YYYY">03/07/2026</SelectItem>
                    <SelectItem value="MM/DD/YYYY">07/03/2026</SelectItem>
                    <SelectItem value="YYYY-MM-DD">2026-07-03</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Page Footer</Label>
                  <Switch
                    checked={!!pageSettings.pageFooter?.enabled}
                    onCheckedChange={v => onPageSettingsChange({
                      pageFooter: { message: 'Thank you for your business', ...pageSettings.pageFooter, enabled: v },
                    })}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Logo, company name &amp; BR number, message, and page numbers on every page.
                </p>
                {pageSettings.pageFooter?.enabled && (
                  <Input
                    value={pageSettings.pageFooter.message ?? 'Thank you for your business'}
                    onChange={e => onPageSettingsChange({ pageFooter: { ...pageSettings.pageFooter!, message: e.target.value } })}
                    placeholder="Footer message"
                    className="h-7 text-xs"
                  />
                )}
              </div>
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Watermark</Label>
                  <Switch
                    checked={!!pageSettings.watermark?.enabled}
                    onCheckedChange={v => onPageSettingsChange({
                      watermark: { text: 'PAID', color: '#9ca3af', opacity: 0.12, ...pageSettings.watermark, enabled: v },
                    })}
                  />
                </div>
                {pageSettings.watermark?.enabled && (
                  <div className="space-y-2 pt-1">
                    <Input
                      value={pageSettings.watermark.text}
                      onChange={e => onPageSettingsChange({ watermark: { ...pageSettings.watermark!, text: e.target.value } })}
                      placeholder="e.g. PAID, DRAFT, ORIGINAL"
                      className="h-7 text-xs"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">Color</Label>
                        <input
                          type="color"
                          value={pageSettings.watermark.color}
                          onChange={e => onPageSettingsChange({ watermark: { ...pageSettings.watermark!, color: e.target.value } })}
                          className="w-full h-7 rounded border cursor-pointer"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">Opacity (%)</Label>
                        <Input
                          type="number" min="2" max="50"
                          value={Math.round((pageSettings.watermark.opacity ?? 0.12) * 100)}
                          onChange={e => onPageSettingsChange({ watermark: { ...pageSettings.watermark!, opacity: Number(e.target.value) / 100 } })}
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
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
