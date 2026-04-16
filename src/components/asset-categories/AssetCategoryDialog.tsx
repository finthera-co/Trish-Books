import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccounts } from "@/hooks/useData";
import { useAssetCategories, useCreateAssetCategory, useUpdateAssetCategory } from "@/hooks/useAssetCategories";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  asset_account_id: z.string().min(1, "Asset account is required"),
  accumulated_depreciation_account_id: z.string().min(1, "Accum. depreciation account is required"),
  depreciation_expense_account_id: z.string().min(1, "Depreciation expense account is required"),
  disposal_gain_account_id: z.string().optional(),
  disposal_loss_account_id: z.string().optional(),
  depreciation_method: z.string().default("straight_line"),
  default_useful_life_months: z.coerce.number().int().positive().default(60),
  proration_method: z.string().default("full_month"),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: string | null;
}

export default function AssetCategoryDialog({ open, onOpenChange, editingId }: Props) {
  const { data: accounts } = useAccounts();
  const { data: categories } = useAssetCategories();
  const createCat = useCreateAssetCategory();
  const updateCat = useUpdateAssetCategory();

  const existing = editingId ? categories?.find((c: any) => c.id === editingId) : null;

  const assetAccounts = (accounts ?? []).filter((a: any) => a.is_active && a.account_type === "Asset");
  const expenseAccounts = (accounts ?? []).filter((a: any) => a.is_active && a.account_type === "Expense");
  const incomeAccounts = (accounts ?? []).filter((a: any) => a.is_active && (a.account_type === "Revenue" || a.account_type === "Income"));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      asset_account_id: "",
      accumulated_depreciation_account_id: "",
      depreciation_expense_account_id: "",
      disposal_gain_account_id: "",
      disposal_loss_account_id: "",
      depreciation_method: "straight_line",
      default_useful_life_months: 60,
      proration_method: "full_month",
    },
  });

  useEffect(() => {
    if (existing) {
      form.reset({
        name: (existing as any).name,
        asset_account_id: (existing as any).asset_account_id ?? "",
        accumulated_depreciation_account_id: (existing as any).accumulated_depreciation_account_id ?? "",
        depreciation_expense_account_id: (existing as any).depreciation_expense_account_id ?? "",
        disposal_gain_account_id: (existing as any).disposal_gain_account_id ?? "",
        disposal_loss_account_id: (existing as any).disposal_loss_account_id ?? "",
        depreciation_method: (existing as any).depreciation_method ?? "straight_line",
        default_useful_life_months: (existing as any).default_useful_life_months ?? 60,
        proration_method: (existing as any).proration_method ?? "full_month",
      });
    } else {
      form.reset();
    }
  }, [existing, open]);

  const onSubmit = async (values: FormValues) => {
    // Convert empty strings to null for optional UUID fields
    const sanitized = {
      ...values,
      disposal_gain_account_id: values.disposal_gain_account_id || null,
      disposal_loss_account_id: values.disposal_loss_account_id || null,
    };
    if (editingId) {
      await updateCat.mutateAsync({ id: editingId, ...sanitized });
    } else {
      await createCat.mutateAsync(sanitized as any);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? "Edit Category" : "New Asset Category"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Category Name</FormLabel>
                <FormControl><Input placeholder="e.g. IT Equipment" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="asset_account_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Asset Account (Dr on acquisition)</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {assetAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="accumulated_depreciation_account_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Accumulated Depreciation Account (Cr)</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {assetAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="depreciation_expense_account_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Depreciation Expense Account (Dr)</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {expenseAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="disposal_gain_account_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Disposal Gain Account</FormLabel>
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {incomeAccounts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="disposal_loss_account_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Disposal Loss Account</FormLabel>
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {expenseAccounts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="depreciation_method" render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="straight_line">Straight Line</SelectItem>
                      <SelectItem value="declining_balance">Declining Balance</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="default_useful_life_months" render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Life (mo)</FormLabel>
                  <FormControl><Input type="number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="proration_method" render={({ field }) => (
                <FormItem>
                  <FormLabel>Proration</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="full_month">Full Month</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={createCat.isPending || updateCat.isPending}>
                {editingId ? "Update" : "Create"} Category
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
