import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  onCreated?: (customerId: string) => void;
}

export function QuickCustomerDialog({ onCreated }: Props) {
  const { appUser } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "" });

  const reset = () => setForm({ name: "", email: "", phone: "", address: "" });

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Customer name is required");
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          tenant_id: appUser!.tenant_id,
          name: form.name.trim(),
          email: form.email || null,
          phone: form.phone || null,
          address: form.address || null,
        })
        .select()
        .single();
      if (error) throw error;
      toast.success("Customer created");
      qc.invalidateQueries({ queryKey: ["customers"] });
      onCreated?.(data.id);
      reset();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to create customer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="shrink-0" title="Create new customer">
          <Plus className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Address</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <Button className="w-full" onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? "Creating..." : "Create Customer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
