import { useEffect, useMemo } from "react";
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
import { useAccounts } from "@/hooks/useData";
import { buildAccountsMap, resolveSubledgerType } from "@/lib/accountMappingEngine";

const assetSchema = z.object({
  asset_name: z.string().min(1, "Name is required"),
  cost: z.coerce.number().positive("Cost must be greater than 0"),
  salvage_value: z.coerce.number().min(0, "Salvage value must be ≥ 0"),
  useful_life_months: z.coerce.number().int().positive("Useful life must be > 0"),
  depreciation_method: z.string().default("straight_line"),
  acquisition_date: z.string().optional(),
  start_date: z.string().optional(),
  description: z.string().optional(),
  asset_account_id: z.string().optional(),
  depreciation_account_id: z.string().optional(),
  depr_expense_account_id: z.string().optional(),
}).refine(d => d.salvage_value <= d.cost, { message: "Salvage value must be ≤ cost", path: ["salvage_value"] });

type AssetFormValues = z.infer<typeof assetSchema>;

export default function AssetForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== "new";
  const navigate = useNavigate();
  const { data: existingAsset } = useFixedAsset(isEdit ? id : undefined);
  const { data: accounts } = useAccounts();
  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();

  // Build accounts map for subledger resolution
  const accountsMap = useMemo(() => {
    if (!accounts) return new Map();
    return buildAccountsMap(accounts as any[]);
  }, [accounts]);

  // Dynamic category dropdown: accounts where resolved subledger = fixed_asset AND not a root control account
  // This means any account under the Fixed Asset control hierarchy (children, grandchildren, etc.)
  const assetCategoryAccounts = useMemo(() => {
    if (!accounts) return [];
    return (accounts as any[]).filter(a => {
      if (!a.is_active) return false;
      if (a.account_type !== "Asset") return false;
      const resolved = resolveSubledgerType(a, accountsMap);
      if (resolved !== "fixed_asset") return false;
      // Exclude the root control account itself — only allow leaf/child categories
      // But if a control account has no children, allow it as a category
      const hasChildren = (accounts as any[]).some(c => c.parent_account_id === a.id);
      if (a.is_control_account && hasChildren) return false;
      return true;
    });
  }, [accounts, accountsMap]);

  // Depreciation (contra-asset) accounts: resolved subledger = asset_depreciation
  const depreciationAccounts = useMemo(() => {
    if (!accounts) return [];
    return (accounts as any[]).filter(a => {
      if (!a.is_active) return false;
      if (a.account_type !== "Asset") return false;
      const resolved = resolveSubledgerType(a, accountsMap);
      return resolved === "asset_depreciation";
    });
  }, [accounts, accountsMap]);

  const expenseAccounts = accounts?.filter(a => a.account_type === "Expense" && a.is_active) ?? [];

  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      asset_name: "",
      cost: 0,
      salvage_value: 0,
      useful_life_months: 12,
      depreciation_method: "straight_line",
      acquisition_date: new Date().toISOString().split("T")[0],
      start_date: new Date().toISOString().split("T")[0],
      description: "",
    },
  });

  useEffect(() => {
    if (existingAsset && isEdit) {
      form.reset({
        asset_name: existingAsset.asset_name,
        cost: existingAsset.cost,
        salvage_value: existingAsset.salvage_value ?? 0,
        useful_life_months: existingAsset.useful_life_months ?? 12,
        depreciation_method: existingAsset.depreciation_method ?? "straight_line",
        acquisition_date: existingAsset.acquisition_date ?? "",
        start_date: existingAsset.start_date ?? existingAsset.acquisition_date ?? "",
        description: existingAsset.description ?? "",
        asset_account_id: existingAsset.asset_account_id ?? "",
        depreciation_account_id: existingAsset.depreciation_account_id ?? "",
        depr_expense_account_id: (existingAsset as any).depr_expense_account_id ?? "",
      });
    }
  }, [existingAsset, isEdit]);

  const onSubmit = async (values: AssetFormValues) => {
    if (isEdit) {
      await updateAsset.mutateAsync({ id, ...values } as any);
    } else {
      await createAsset.mutateAsync(values as any);
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
              <FormField control={form.control} name="asset_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset Name</FormLabel>
                  <FormControl><Input placeholder="Office Equipment" {...field} /></FormControl>
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
                <FormField control={form.control} name="depreciation_method" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Depreciation Method</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={hasDepreciation}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="straight_line">Straight Line</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="acquisition_date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="start_date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Depreciation Start Date</FormLabel>
                    <FormControl><Input type="date" disabled={hasDepreciation} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* COA Account Linking — Dynamic from subledger hierarchy */}
              <div className="border-t pt-4 mt-4">
                <h3 className="text-sm font-semibold text-foreground mb-1">Account Linking (Chart of Accounts)</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Categories are loaded dynamically from your COA. New accounts created under Fixed Assets appear automatically.
                </p>
                <div className="space-y-4">
                  <FormField control={form.control} name="asset_account_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asset Category (COA)</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select asset category" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {assetCategoryAccounts.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="depreciation_account_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Accumulated Depreciation Account</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select depreciation account" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {depreciationAccounts.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="depr_expense_account_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Depreciation Expense Account</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select expense account" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {expenseAccounts.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
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
