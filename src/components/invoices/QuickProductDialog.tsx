import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateProduct, useAccounts } from "@/hooks/useData";
import { useTaxGroups, useTaxCodes } from "@/hooks/useTaxEngine";
import AccountSelector from "@/components/shared/AccountSelector";

interface Props {
  onCreated?: (productId: string) => void;
}

// Radix Select cannot use "" as an item value, so optional overrides use a sentinel.
const NONE = "__none__";

const EMPTY_FORM = {
  name: "",
  sku: "",
  description: "",
  price: 0,
  type: "service" as "service" | "non_inventory",
  income_account_id: "",
  expense_account_id: "",
  // Encoded as "g:<groupId>" / "c:<codeId>" / "" — same scheme as ProductsTaxes.tsx.
  default_tax: "",
};

type ProductForm = typeof EMPTY_FORM;

export function QuickProductDialog({ onCreated }: Props) {
  const { data: accounts } = useAccounts();
  const { data: taxGroups } = useTaxGroups();
  const { data: taxCodes } = useTaxCodes();
  const createProduct = useCreateProduct();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);

  const set = (patch: Partial<ProductForm>) => setForm((f) => ({ ...f, ...patch }));
  const reset = () => setForm(EMPTY_FORM);

  const revenueAccounts = accounts?.filter((a) => a.account_type === "Income" || a.account_type === "Other Income" || a.account_type === "Revenue") || [];
  const activeGroups = (taxGroups || []).filter((g) => g.is_active);
  const activeCodes = (taxCodes || []).filter((c) => c.is_active);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const default_tax_group_id = form.default_tax.startsWith("g:") ? form.default_tax.slice(2) : null;
    const default_tax_code_id = form.default_tax.startsWith("c:") ? form.default_tax.slice(2) : null;

    const product = await createProduct.mutateAsync({
      name: form.name.trim(),
      sku: form.sku.trim() || undefined,
      description: form.description.trim() || undefined,
      price: form.price,
      default_tax_group_id,
      default_tax_code_id,
      income_account_id: form.income_account_id || undefined,
      type: form.type,
      expense_account_id: form.expense_account_id || undefined,
    });

    onCreated?.(product.id);
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" title="Create new product">
          <Plus className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New Product / Service</DialogTitle></DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Consulting Service" autoFocus />
            </div>
            <div>
              <Label>SKU / Code</Label>
              <Input value={form.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Price</Label>
              <Input type="number" step="0.01" value={form.price || ""} onChange={(e) => set({ price: Number(e.target.value) })} placeholder="0.00" />
            </div>
            <div>
              <Label>Default sales tax</Label>
              <Select value={form.default_tax || NONE} onValueChange={(v) => set({ default_tax: v === NONE ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="No tax" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No tax</SelectItem>
                  {activeGroups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.code} — {g.name}</SelectItem>)}
                  {activeCodes.map((c) => <SelectItem key={c.id} value={`c:${c.id}`}>{c.code} — {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Income Account</Label>
            <Select value={form.income_account_id || NONE} onValueChange={(v) => set({ income_account_id: v === NONE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Select account...</SelectItem>
                {revenueAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Product Type</Label>
            <Select value={form.type} onValueChange={(v) => set({ type: v as "service" | "non_inventory" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="service">Service</SelectItem>
                <SelectItem value="non_inventory">Non-Inventory</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.type === "non_inventory" && (
            <div>
              <Label>COGS / Expense Account</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1">Debited when this product is sold</p>
              <AccountSelector value={form.expense_account_id} onChange={(id) => set({ expense_account_id: id })}
                types={["Cost of Goods Sold", "Expense"]} placeholder="Search account…" />
            </div>
          )}

          <Button className="w-full" onClick={handleSave} disabled={createProduct.isPending || !form.name.trim()}>
            {createProduct.isPending ? "Creating..." : "Create Product"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
