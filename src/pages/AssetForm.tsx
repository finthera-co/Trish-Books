import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateAsset, useUpdateAsset, useFixedAsset } from "@/hooks/useFixedAssets";
import { useAssetCategories } from "@/hooks/useAssetCategories";
import { useAccounts } from "@/hooks/useData";

const assetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category_id: z.string().min(1, "Category is required"),
  cost: z.coerce.number().positive("Cost must be > 0"),
  salvage_value: z.coerce.number().min(0, "Salvage value must be ≥ 0"),
  useful_life_months: z.coerce.number().int().positive("Useful life must be > 0"),
  purchase_date: z.string().optional(),
  depreciation_start_date: z.string().optional(),
  payment_account_id: z.string().min(1, "Payment account is required"),
  description: z.string().optional(),
}).refine(d => d.salvage_value <= d.cost, { message: "Salvage value must be ≤ cost", path: ["salvage_value"] });

type AssetFormValues = z.infer<typeof assetSchema>;

export default function AssetForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== "new";
  const navigate = useNavigate();
  const { data: existingAsset } = useFixedAsset(isEdit ? id : undefined);
  const { data: categories } = useAssetCategories();
  const { data: accounts } = useAccounts();
  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();

  // Payment accounts: Cash, Bank, or AP type accounts
  const paymentAccounts = (accounts ?? []).filter(
    (a: any) => a.is_active && (
      a.account_type === "Asset" && (
        a.account_subtype?.toLowerCase().includes("cash") ||
        a.account_subtype?.toLowerCase().includes("bank") ||
        a.account_name?.toLowerCase().includes("cash") ||
        a.account_name?.toLowerCase().includes("bank")
      )
    ) || (
      a.account_type === "Liability" && (
        a.account_subtype?.toLowerCase().includes("payable") ||
        a.account_name?.toLowerCase().includes("payable")
      )
    )
  );

  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      name: "",
      category_id: "",
      cost: 0,
      salvage_value: 0,
      useful_life_months: 60,
      purchase_date: new Date().toISOString().split("T")[0],
      depreciation_start_date: new Date().toISOString().split("T")[0],
      payment_account_id: "",
      description: "",
    },
  });

  // Auto-fill useful life from selected category
  const selectedCategoryId = form.watch("category_id");
  useEffect(() => {
    if (!isEdit && selectedCategoryId && categories) {
      const cat = categories.find((c: any) => c.id === selectedCategoryId);
      if (cat) {
        form.setValue("useful_life_months", (cat as any).default_useful_life_months || 60);
      }
    }
  }, [selectedCategoryId, categories, isEdit]);

  useEffect(() => {
    if (existingAsset && isEdit) {
      form.reset({
        name: existingAsset.asset_name,
        category_id: existingAsset.category_id ?? "",
        cost: existingAsset.cost,
        salvage_value: existingAsset.salvage_value ?? 0,
        useful_life_months: existingAsset.useful_life_months ?? 60,
        purchase_date: existingAsset.acquisition_date ?? "",
        depreciation_start_date: existingAsset.start_date ?? existingAsset.acquisition_date ?? "",
        payment_account_id: "", // not stored on asset
        description: existingAsset.description ?? "",
      });
    }
  }, [existingAsset, isEdit]);

  const onSubmit = async (values: AssetFormValues) => {
    if (isEdit) {
      // Only update mutable fields (not accounting-sensitive ones)
      await updateAsset.mutateAsync({
        id,
        asset_name: values.name,
        description: values.description,
        category_id: values.category_id,
      });
    } else {
      await createAsset.mutateAsync(values);
    }
    navigate("/assets/register");
  };

  const hasDepreciation = isEdit && (existingAsset?.accumulated_depreciation ?? 0) > 0;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/assets/register")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">{isEdit ? "Edit Asset" : "New Asset"}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{isEdit ? "Update Asset Details" : "Asset Information"}</CardTitle>
          {hasDepreciation && (
            <p className="text-sm text-destructive">⚠ Financial fields are locked after depreciation has started.</p>
          )}
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset Name</FormLabel>
                  <FormControl><Input placeholder="MacBook Pro 16" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Category — the accounting rules engine */}
              <FormField control={form.control} name="category_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset Category</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={hasDepreciation}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(categories ?? []).map((cat: any) => (
                        <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Accounts are auto-resolved from the category. Manage categories under Asset Categories.
                  </p>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="cost" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost</FormLabel>
                    <FormControl><Input type="number" step="0.01" disabled={hasDepreciation} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="salvage_value" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Salvage Value</FormLabel>
                    <FormControl><Input type="number" step="0.01" disabled={hasDepreciation} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="useful_life_months" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Useful Life (months)</FormLabel>
                    <FormControl><Input type="number" disabled={hasDepreciation} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {!isEdit && (
                  <FormField control={form.control} name="payment_account_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Account</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Cash / Bank / AP" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {paymentAccounts.map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="purchase_date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Date</FormLabel>
                    <FormControl><Input type="date" disabled={hasDepreciation} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="depreciation_start_date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Depreciation Start Date</FormLabel>
                    <FormControl><Input type="date" disabled={hasDepreciation} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea placeholder="Optional description..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex gap-3 pt-4">
                <Button type="submit" disabled={createAsset.isPending || updateAsset.isPending}>
                  {isEdit ? "Update Asset" : "Create Asset"}
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate("/assets/register")}>Cancel</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
