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
import { Switch } from "@/components/ui/switch";
import { useCreateAsset, useUpdateAsset, useFixedAsset } from "@/hooks/useFixedAssets";
import { useAssetCategories } from "@/hooks/useAssetCategories";
import { useAccounts } from "@/hooks/useData";

const assetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  use_category: z.boolean().default(true),
  category_id: z.string().optional(),
  cost: z.coerce.number().positive("Cost must be > 0"),
  salvage_value: z.coerce.number().min(0, "Salvage value must be ≥ 0"),
  useful_life_months: z.coerce.number().int().positive("Useful life must be > 0"),
  purchase_date: z.string().optional(),
  depreciation_start_date: z.string().optional(),
  payment_account_id: z.string().min(1, "Payment account is required"),
  description: z.string().optional(),
  asset_account_id: z.string().optional(),
  accumulated_depreciation_account_id: z.string().optional(),
  depreciation_expense_account_id: z.string().optional(),
  depreciation_method: z.string().default("straight_line"),
})
  .refine(d => d.salvage_value <= d.cost, { message: "Salvage value must be ≤ cost", path: ["salvage_value"] })
  .superRefine((d, ctx) => {
    if (d.use_category) {
      if (!d.category_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Category is required", path: ["category_id"] });
      }
    } else {
      if (!d.asset_account_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Asset account is required", path: ["asset_account_id"] });
      }
      if (!d.accumulated_depreciation_account_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Accum. depreciation account is required", path: ["accumulated_depreciation_account_id"] });
      }
      if (!d.depreciation_expense_account_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Depreciation expense account is required", path: ["depreciation_expense_account_id"] });
      }
    }
  });

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

  // Direct-account lists (mirror AssetCategoryDialog)
  const assetAccounts = (accounts ?? []).filter((a: any) => a.is_active && a.account_type === "Asset");
  const accumDepreciationAccounts = (accounts ?? []).filter((a: any) =>
    a.is_active &&
    a.account_type === "Asset" &&
    (a.account_subtype?.toLowerCase().includes("accumulated depreciation") ||
      a.account_subtype?.toLowerCase().includes("contra") ||
      a.is_contra === true)
  );
  const expenseAccounts = (accounts ?? []).filter((a: any) => a.is_active && a.account_type === "Expense");

  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      name: "",
      use_category: true,
      category_id: "",
      cost: 0,
      salvage_value: 0,
      useful_life_months: 60,
      purchase_date: new Date().toISOString().split("T")[0],
      depreciation_start_date: new Date().toISOString().split("T")[0],
      payment_account_id: "",
      description: "",
      asset_account_id: "",
      accumulated_depreciation_account_id: "",
      depreciation_expense_account_id: "",
      depreciation_method: "straight_line",
    },
  });

  // Auto-fill useful life from selected category
  const selectedCategoryId = form.watch("category_id");
  const useCategory = form.watch("use_category");
  useEffect(() => {
    if (!isEdit && useCategory && selectedCategoryId && categories) {
      const cat = categories.find((c: any) => c.id === selectedCategoryId);
      if (cat) {
        form.setValue("useful_life_months", (cat as any).default_useful_life_months || 60);
      }
    }
  }, [selectedCategoryId, categories, isEdit, useCategory]);

  useEffect(() => {
    if (existingAsset && isEdit) {
      form.reset({
        name: existingAsset.asset_name,
        use_category: !!existingAsset.category_id,
        category_id: existingAsset.category_id ?? "",
        cost: existingAsset.cost,
        salvage_value: existingAsset.salvage_value ?? 0,
        useful_life_months: existingAsset.useful_life_months ?? 60,
        purchase_date: existingAsset.acquisition_date ?? "",
        depreciation_start_date: existingAsset.start_date ?? existingAsset.acquisition_date ?? "",
        payment_account_id: "", // not stored on asset
        description: existingAsset.description ?? "",
        asset_account_id: (existingAsset as any).asset_account_id ?? "",
        accumulated_depreciation_account_id: (existingAsset as any).depreciation_account_id ?? "",
        depreciation_expense_account_id: (existingAsset as any).depr_expense_account_id ?? "",
        depreciation_method: existingAsset.depreciation_method ?? "straight_line",
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
        category_id: values.use_category ? values.category_id : null,
      });
    } else {
      const useCategory = values.use_category;
      const payload = {
        name: values.name,
        cost: values.cost,
        salvage_value: values.salvage_value,
        useful_life_months: values.useful_life_months,
        purchase_date: values.purchase_date,
        depreciation_start_date: values.depreciation_start_date,
        payment_account_id: values.payment_account_id,
        description: values.description,
        ...(useCategory
          ? { category_id: values.category_id }
          : {
              asset_account_id: values.asset_account_id,
              accumulated_depreciation_account_id: values.accumulated_depreciation_account_id,
              depreciation_expense_account_id: values.depreciation_expense_account_id,
              depreciation_method: values.depreciation_method,
            }),
      };
      await createAsset.mutateAsync(payload as Parameters<typeof createAsset.mutateAsync>[0]);
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

              {/* Toggle: drive accounts from a category, or supply them directly */}
              <FormField control={form.control} name="use_category" render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Use an asset category</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      On: accounts are resolved from the category. Off: choose the GL accounts directly.
                    </p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={hasDepreciation} />
                  </FormControl>
                </FormItem>
              )} />

              {useCategory ? (
                /* Category — the accounting rules engine */
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
              ) : (
                <div className="space-y-4">
                  <FormField control={form.control} name="asset_account_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asset Account</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={hasDepreciation}>
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
                      <FormLabel>Accumulated Depreciation Account</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={hasDepreciation}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {accumDepreciationAccounts.length > 0 ? (
                            accumDepreciationAccounts.map((a: any) => (
                              <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                            ))
                          ) : (
                            <SelectItem value="_none" disabled>No contra-asset accounts found</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="depreciation_expense_account_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Depreciation Expense Account</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={hasDepreciation}>
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

                  <FormField control={form.control} name="depreciation_method" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Depreciation Method</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={hasDepreciation}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="straight_line">Straight Line</SelectItem>
                          <SelectItem value="declining_balance">Declining Balance</SelectItem>
                          <SelectItem value="double_declining">Double Declining</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}

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
