import { Plus, ArrowRight, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useProducts, useCreateProduct, useTaxes, useAccounts } from "@/hooks/useData";
import { useUpsertInventoryItem } from "@/hooks/useProcurement";
import { useTaxGroups, useTaxCodes } from "@/hooks/useTaxEngine";
import { useInventoryRealtime } from "@/hooks/useInventoryRealtime";
import { toast } from "sonner";
import AccountSelector from "@/components/shared/AccountSelector";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

// A product's default tax is now either a group or a single code. We encode
// the Select value as "g:<id>" / "c:<id>" / "" so one control covers both.
type DefaultTaxValue = string;

export default function ProductsTaxes() {
  useInventoryRealtime();
  // Product form
  const [productOpen, setProductOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [productPrice, setProductPrice] = useState(0);
  const [defaultTax, setDefaultTax] = useState<DefaultTaxValue>("");
  const [productAccountId, setProductAccountId] = useState("");
  const [productExpenseAccountId, setProductExpenseAccountId] = useState("");
  const [productAssetAccountId, setProductAssetAccountId] = useState("");
  const [productType, setProductType] = useState<"service" | "non_inventory" | "inventory">("service");

  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: taxes, isLoading: taxesLoading } = useTaxes();
  const { data: taxGroups } = useTaxGroups();
  const { data: taxCodes } = useTaxCodes();
  const { data: accounts } = useAccounts();
  const createProduct = useCreateProduct();
  const upsertInventoryItem = useUpsertInventoryItem();

  const revenueAccounts = accounts?.filter((a) => a.account_type === "Revenue") || [];
  const activeGroups = (taxGroups || []).filter((g) => g.is_active);
  const activeCodes = (taxCodes || []).filter((c) => c.is_active);

  const handleCreateProduct = async () => {
    const default_tax_group_id = defaultTax.startsWith("g:") ? defaultTax.slice(2) : null;
    const default_tax_code_id = defaultTax.startsWith("c:") ? defaultTax.slice(2) : null;

    if (productType === "inventory") {
      if (!productName || !productAssetAccountId || !productExpenseAccountId) {
        toast.error("Inventory products require a name, an inventory asset account, and a COGS account.");
        return;
      }
      // 1. Create the inventory_items master row (links asset + COGS accounts so the
      //    activation trigger is satisfied and the post-invoice edge function can
      //    resolve COGS/stock). 2. Create the products row linked to it.
      const invId = await upsertInventoryItem.mutateAsync({
        item_name: productName,
        selling_price: productPrice,
        unit_cost: 0,
        account_id: productAssetAccountId,
        cogs_account_id: productExpenseAccountId,
        is_active: true,
      });
      await createProduct.mutateAsync({
        name: productName,
        description: productDesc || undefined,
        price: productPrice,
        default_tax_group_id,
        default_tax_code_id,
        income_account_id: productAccountId || undefined,
        expense_account_id: productExpenseAccountId,
        asset_account_id: productAssetAccountId,
        type: "inventory",
        inventory_item_id: invId,
      });
    } else {
      await createProduct.mutateAsync({
        name: productName,
        description: productDesc || undefined,
        price: productPrice,
        default_tax_group_id,
        default_tax_code_id,
        income_account_id: productAccountId || undefined,
        type: productType,
        expense_account_id: productExpenseAccountId || undefined,
      });
    }
    setProductOpen(false);
    setProductName("");
    setProductDesc("");
    setProductPrice(0);
    setDefaultTax("");
    setProductAccountId("");
    setProductType("service");
    setProductExpenseAccountId("");
    setProductAssetAccountId("");
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Products &amp; Taxes</h1>
          <p className="page-description">Manage products/services. Tax codes have moved to Tax Configuration.</p>
        </div>
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="taxes">Tax Rates (legacy)</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={productOpen} onOpenChange={setProductOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4" />Add Product</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Product/Service</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-4">
                  <div>
                    <label className="text-sm font-medium">Name</label>
                    <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Consulting Service" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <input type="text" value={productDesc} onChange={(e) => setProductDesc(e.target.value)}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Price</label>
                      <input type="number" value={productPrice || ""} onChange={(e) => setProductPrice(Number(e.target.value))}
                        className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Default sales tax (output VAT)</label>
                      {/* groups first, then codes (grouped sections) */}
                      <select value={defaultTax} onChange={(e) => setDefaultTax(e.target.value)}
                        className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                        <option value="">No tax</option>
                        {activeGroups.length > 0 && (
                          <optgroup label="Tax Groups">
                            {activeGroups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.code} — {g.name}</option>)}
                          </optgroup>
                        )}
                        {activeCodes.length > 0 && (
                          <optgroup label="Tax Codes">
                            {activeCodes.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.code} — {c.name}</option>)}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Income Account</label>
                    <select value={productAccountId} onChange={(e) => setProductAccountId(e.target.value)}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                      <option value="">Select account...</option>
                      {revenueAccounts.map((a) => <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Product Type</label>
                    <select value={productType} onChange={(e) => setProductType(e.target.value as "service" | "non_inventory" | "inventory")}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                      <option value="service">Service</option>
                      <option value="non_inventory">Non-Inventory</option>
                      <option value="inventory">Inventory</option>
                    </select>
                  </div>
                  {(productType === "non_inventory" || productType === "inventory") && (
                    <div>
                      <label className="text-sm font-medium">COGS / Expense Account</label>
                      <p className="text-xs text-muted-foreground mt-0.5 mb-1">Debited when this product is sold</p>
                      <AccountSelector value={productExpenseAccountId} onChange={(id) => setProductExpenseAccountId(id)}
                        types={["Cost of Goods Sold", "Expense"]} placeholder="Search account…" />
                    </div>
                  )}
                  {productType === "inventory" && (
                    <div>
                      <label className="text-sm font-medium">Inventory Asset Account</label>
                      <p className="text-xs text-muted-foreground mt-0.5 mb-1">Stock-on-hand balance sheet account</p>
                      <AccountSelector value={productAssetAccountId} onChange={(id) => setProductAssetAccountId(id)}
                        types={["Asset"]} placeholder="Search account…" />
                    </div>
                  )}
                  <Button onClick={handleCreateProduct} disabled={!productName || createProduct.isPending} className="w-full">
                    {createProduct.isPending ? "Creating..." : "Create Product"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="stat-card">
            {productsLoading ? (
              <p className="text-center py-8 text-muted-foreground">Loading...</p>
            ) : !products?.length ? (
              <p className="text-center py-8 text-muted-foreground">No products found. Create your first product.</p>
            ) : (
              <table className="data-table">
                <thead><tr><th>Name</th><th>Description</th><th>Default Tax</th><th className="text-right">Price</th></tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium text-foreground">{p.name}</td>
                      <td className="text-muted-foreground">{p.description || "-"}</td>
                      <td>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                          {(() => {
                            const gid = (p as any).default_tax_group_id;
                            const cid = (p as any).default_tax_code_id;
                            if (gid) return activeGroups.find((g) => g.id === gid)?.code ?? "Group";
                            if (cid) return activeCodes.find((c) => c.id === cid)?.code ?? "Code";
                            if ((p.taxes as any)?.tax_name) return `${(p.taxes as any).tax_name} (legacy)`;
                            return "No tax";
                          })()}
                        </span>
                      </td>
                      <td className="text-right font-medium text-foreground">LKR {Number(p.price).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="taxes" className="space-y-4 mt-4">
          <Alert>
            <ArrowRight className="h-4 w-4" />
            <AlertDescription>
              Tax codes have moved to{" "}
              <Link to="/settings/tax" className="font-medium underline">Tax Configuration</Link>. The list below is the
              legacy tax-rate table, kept read-only for reference — new sales and purchases use effective-dated tax codes
              and groups.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="w-4 h-4 text-muted-foreground" /> Legacy tax rates (read-only)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {taxesLoading ? (
                <p className="text-center py-8 text-muted-foreground">Loading...</p>
              ) : !taxes?.length ? (
                <p className="text-center py-8 text-muted-foreground">No legacy tax rates.</p>
              ) : (
                <table className="data-table w-full">
                  <thead><tr><th>Tax Name</th><th className="text-right">Rate</th></tr></thead>
                  <tbody>
                    {taxes.map((t) => (
                      <tr key={t.id}>
                        <td className="font-medium text-foreground">{t.tax_name}</td>
                        <td className="text-right font-medium text-foreground">{Number(t.tax_rate)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
