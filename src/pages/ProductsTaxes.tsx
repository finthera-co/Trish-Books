import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useProducts, useCreateProduct, useTaxes, useCreateTax, useAccounts } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ProductsTaxes() {
  // Product form
  const [productOpen, setProductOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [productPrice, setProductPrice] = useState(0);
  const [productTaxId, setProductTaxId] = useState("");
  const [productAccountId, setProductAccountId] = useState("");

  // Tax form
  const [taxOpen, setTaxOpen] = useState(false);
  const [taxName, setTaxName] = useState("");
  const [taxRate, setTaxRate] = useState(0);

  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: taxes, isLoading: taxesLoading } = useTaxes();
  const { data: accounts } = useAccounts();
  const createProduct = useCreateProduct();
  const createTax = useCreateTax();

  const revenueAccounts = accounts?.filter(a => a.account_type === "Revenue") || [];

  const handleCreateProduct = async () => {
    await createProduct.mutateAsync({
      name: productName,
      description: productDesc || undefined,
      price: productPrice,
      tax_id: productTaxId || undefined,
      income_account_id: productAccountId || undefined,
    });
    setProductOpen(false);
    setProductName("");
    setProductDesc("");
    setProductPrice(0);
    setProductTaxId("");
    setProductAccountId("");
  };

  const handleCreateTax = async () => {
    await createTax.mutateAsync({ tax_name: taxName, tax_rate: taxRate });
    setTaxOpen(false);
    setTaxName("");
    setTaxRate(0);
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Products & Taxes</h1>
          <p className="page-description">Manage products/services and tax rates</p>
        </div>
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="taxes">Tax Rates</TabsTrigger>
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
                      <label className="text-sm font-medium">Tax Rate</label>
                      <select value={productTaxId} onChange={(e) => setProductTaxId(e.target.value)}
                        className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                        <option value="">No tax</option>
                        {taxes?.map(t => <option key={t.id} value={t.id}>{t.tax_name} ({Number(t.tax_rate)}%)</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Income Account</label>
                    <select value={productAccountId} onChange={(e) => setProductAccountId(e.target.value)}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground">
                      <option value="">Select account...</option>
                      {revenueAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>)}
                    </select>
                  </div>
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
                <thead><tr><th>Name</th><th>Description</th><th>Tax</th><th className="text-right">Price</th></tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium text-foreground">{p.name}</td>
                      <td className="text-muted-foreground">{p.description || "-"}</td>
                      <td>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                          {(p.taxes as any)?.tax_name ? `${(p.taxes as any).tax_name} (${Number((p.taxes as any).tax_rate)}%)` : "No tax"}
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
          <div className="flex justify-end">
            <Dialog open={taxOpen} onOpenChange={setTaxOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4" />Add Tax Rate</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Tax Rate</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-4">
                  <div>
                    <label className="text-sm font-medium">Tax Name</label>
                    <input type="text" value={taxName} onChange={(e) => setTaxName(e.target.value)}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="VAT" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Rate (%)</label>
                    <input type="number" value={taxRate || ""} onChange={(e) => setTaxRate(Number(e.target.value))}
                      className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="15" />
                  </div>
                  <Button onClick={handleCreateTax} disabled={!taxName || createTax.isPending} className="w-full">
                    {createTax.isPending ? "Creating..." : "Create Tax Rate"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="stat-card">
            {taxesLoading ? (
              <p className="text-center py-8 text-muted-foreground">Loading...</p>
            ) : !taxes?.length ? (
              <p className="text-center py-8 text-muted-foreground">No tax rates found. Create your first tax rate.</p>
            ) : (
              <table className="data-table">
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
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
