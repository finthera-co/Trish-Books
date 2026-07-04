import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Star, Copy, Pencil, Layout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useInvoiceTemplates, useDeleteInvoiceTemplate, useSaveInvoiceTemplate, useSetDefaultInvoiceTemplate } from "@/hooks/useInvoiceTemplates";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function InvoiceTemplates() {
  const navigate = useNavigate();
  const { data: templates, isLoading } = useInvoiceTemplates();
  const deleteTemplate = useDeleteInvoiceTemplate();
  const saveTemplate = useSaveInvoiceTemplate();
  const setDefaultTemplate = useSetDefaultInvoiceTemplate();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("New Invoice Template");
  const [newType, setNewType] = useState("standard");

  const handleCreate = () => {
    setCreateOpen(false);
    navigate(`/sales/invoices/designer?name=${encodeURIComponent(newName)}&type=${newType}`);
  };

  const handleDuplicate = async (template: any) => {
    await saveTemplate.mutateAsync({
      template_name: `${template.template_name} (Copy)`,
      template_type: template.template_type,
      layout_json: template.layout_json,
      page_settings: template.page_settings,
      table_settings: template.table_settings,
      is_default: false,
    });
  };

  const typeLabels: Record<string, string> = {
    standard: "Standard",
    tax: "Tax Invoice",
    pos: "POS",
    service: "Service",
    proforma: "Proforma",
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoice Templates</h1>
          <p className="page-description">Design and manage invoice layouts with drag-and-drop</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />New Template</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Create Template</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-sm font-medium">Template Name</label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Type</label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard Invoice</SelectItem>
                    <SelectItem value="tax">Tax Invoice</SelectItem>
                    <SelectItem value="pos">POS Invoice</SelectItem>
                    <SelectItem value="service">Service Invoice</SelectItem>
                    <SelectItem value="proforma">Proforma Invoice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} className="w-full">Open Designer</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground">Loading templates...</p>
      ) : !templates?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Layout className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-1">No templates yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create your first invoice template to get started</p>
            <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Create Template</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tmpl: any) => (
            <Card key={tmpl.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{tmpl.template_name}</CardTitle>
                    <CardDescription>{typeLabels[tmpl.template_type] || tmpl.template_type}</CardDescription>
                  </div>
                  {tmpl.is_default && <Badge variant="secondary"><Star className="w-3 h-3 mr-1" />Default</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/sales/invoices/designer?id=${tmpl.id}`)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleDuplicate(tmpl)}>
                    <Copy className="w-3.5 h-3.5 mr-1" />Duplicate
                  </Button>
                  {!tmpl.is_default && (
                    <Button size="sm" variant="outline" disabled={setDefaultTemplate.isPending}
                      onClick={() => setDefaultTemplate.mutate(tmpl.id)}>
                      <Star className="w-3.5 h-3.5 mr-1" />Default
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={() => deleteTemplate.mutate(tmpl.id)} disabled={tmpl.is_default}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
