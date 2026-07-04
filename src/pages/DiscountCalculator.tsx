import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Percent, Plus, Trash2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/currency";
import { useProducts } from "@/hooks/useData";

type DiscType = "pct" | "flat";

// Discount + optional tax on a single amount.
function calc(gross: number, discType: DiscType, discVal: number, taxPct: number) {
  const discount = discType === "pct"
    ? Math.round(gross * (discVal || 0) / 100 * 100) / 100
    : Math.min(discVal || 0, gross);
  const afterDiscount = Math.round((gross - discount) * 100) / 100;
  const tax = Math.round(afterDiscount * (taxPct || 0) / 100 * 100) / 100;
  const total = Math.round((afterDiscount + tax) * 100) / 100;
  return { discount, afterDiscount, tax, total };
}

const productPrice = (p: any) => Number(p?.inventory_item?.selling_price ?? p?.price) || 0;

interface Row { id: string; product_id: string; name: string; qty: number; price: number; discType: DiscType; discVal: number; taxPct: number; }
const emptyRow = (): Row => ({ id: crypto.randomUUID(), product_id: "", name: "", qty: 1, price: 0, discType: "pct", discVal: 0, taxPct: 0 });

export default function DiscountCalculator() {
  const navigate = useNavigate();
  const { data: products } = useProducts();
  const [mode, setMode] = useState<"simple" | "item">("simple");

  // ── Simple ──
  const [amount, setAmount] = useState("");
  const [sDiscType, setSDiscType] = useState<DiscType>("pct");
  const [sDiscVal, setSDiscVal] = useState("");
  const [sTax, setSTax] = useState("");
  const simple = calc(Number(amount) || 0, sDiscType, Number(sDiscVal) || 0, Number(sTax) || 0);

  // ── Item level ──
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const upd = (id: string, patch: Partial<Row>) => setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const pickProduct = (id: string, pid: string) => {
    const prod: any = (products || []).find((p: any) => p.id === pid);
    upd(id, { product_id: pid, name: prod?.name || "", price: productPrice(prod) });
  };
  const rowCalcs = useMemo(() => rows.map((r) => {
    const gross = Math.round((r.qty || 0) * (r.price || 0) * 100) / 100;
    return { gross, ...calc(gross, r.discType, r.discVal, r.taxPct) };
  }), [rows]);
  const totals = useMemo(() => rowCalcs.reduce((a, c) => ({
    gross: a.gross + c.gross, discount: a.discount + c.discount, tax: a.tax + c.tax, total: a.total + c.total,
  }), { gross: 0, discount: 0, tax: 0, total: 0 }), [rowCalcs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Percent className="w-6 h-6 text-primary" /> Discount Calculator</h1>
          <p className="text-sm text-muted-foreground">Work out discounts and final prices — one amount, or line by line from your inventory</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-border p-1 bg-muted/40">
        {([["simple", "Simple"], ["item", "Item level"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setMode(k)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === k ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === "simple" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <Card className="h-full">
            <CardHeader><CardTitle className="text-base">Enter details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Original amount</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Discount type</Label>
                  <Select value={sDiscType} onValueChange={(v) => setSDiscType(v as DiscType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pct">Percentage (%)</SelectItem>
                      <SelectItem value="flat">Flat amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Discount {sDiscType === "pct" ? "(%)" : "amount"}</Label>
                  <Input type="number" value={sDiscVal} onChange={(e) => setSDiscVal(e.target.value)} placeholder="0" className="font-mono" />
                </div>
              </div>
              <div>
                <Label>Tax (%) — optional</Label>
                <Input type="number" value={sTax} onChange={(e) => setSTax(e.target.value)} placeholder="0" className="font-mono" />
              </div>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Row label="Original amount" value={formatCurrency(Number(amount) || 0)} />
              <Row label="Discount" value={`- ${formatCurrency(simple.discount)}`} accent="red" />
              <Row label="Amount after discount" value={formatCurrency(simple.afterDiscount)} />
              {Number(sTax) > 0 && <Row label={`Tax (${sTax}%)`} value={`+ ${formatCurrency(simple.tax)}`} />}
              <div className="border-t border-border pt-3 flex items-center justify-between">
                <span className="font-semibold">Final price</span>
                <span className="text-2xl font-bold text-primary tabular-nums">{formatCurrency(simple.total)}</span>
              </div>
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <Tag className="w-4 h-4" /> You save {formatCurrency(simple.discount)}
                {Number(amount) > 0 && <span className="text-xs">({Math.round(simple.discount / (Number(amount) || 1) * 100)}%)</span>}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {/* Header */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="col-span-3">Product</span><span className="col-span-1 text-center">Qty</span>
                <span className="col-span-2 text-right">Unit price</span><span className="col-span-1 text-center">Disc</span>
                <span className="col-span-1 text-center">Type</span><span className="col-span-1 text-center">Tax%</span>
                <span className="col-span-2 text-right">Total</span><span className="col-span-1" />
              </div>
              {rows.map((r, idx) => (
                <div key={r.id} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3">
                    <Select value={r.product_id || "none"} onValueChange={(v) => v === "none" ? upd(r.id, { product_id: "", name: "" }) : pickProduct(r.id, v)}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick product" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Custom —</SelectItem>
                        {(products || []).map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name} — {formatCurrency(productPrice(p))}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!r.product_id && (
                      <Input className="h-8 text-xs mt-1" placeholder="Item name" value={r.name} onChange={(e) => upd(r.id, { name: e.target.value })} />
                    )}
                  </div>
                  <Input className="col-span-1 h-9 text-sm text-center" type="number" min={0} value={r.qty || ""} onChange={(e) => upd(r.id, { qty: Number(e.target.value) })} />
                  <Input className="col-span-2 h-9 text-sm text-right font-mono" type="number" value={r.price || ""} onChange={(e) => upd(r.id, { price: Number(e.target.value) })} />
                  <Input className="col-span-1 h-9 text-sm text-center font-mono" type="number" value={r.discVal || ""} onChange={(e) => upd(r.id, { discVal: Number(e.target.value) })} />
                  <Select value={r.discType} onValueChange={(v) => upd(r.id, { discType: v as DiscType })}>
                    <SelectTrigger className="col-span-1 h-9 text-xs px-2"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="pct">%</SelectItem><SelectItem value="flat">Flat</SelectItem></SelectContent>
                  </Select>
                  <Input className="col-span-1 h-9 text-sm text-center font-mono" type="number" value={r.taxPct || ""} onChange={(e) => upd(r.id, { taxPct: Number(e.target.value) })} />
                  <div className="col-span-2 text-right font-mono tabular-nums text-sm font-medium">{formatCurrency(rowCalcs[idx]?.total || 0)}</div>
                  <div className="col-span-1 flex justify-end">
                    {rows.length > 1 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))}><Trash2 className="w-4 h-4 text-muted-foreground" /></Button>}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full border-dashed" onClick={() => setRows((p) => [...p, emptyRow()])}>
                <Plus className="w-4 h-4 mr-1.5" /> Add item
              </Button>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-72 space-y-2 border-t border-border pt-3">
                <Row label="Subtotal" value={formatCurrency(totals.gross)} />
                <Row label="Total discount" value={`- ${formatCurrency(totals.discount)}`} accent="red" />
                <Row label="Total tax" value={`+ ${formatCurrency(totals.tax)}`} />
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="font-semibold">Grand total</span>
                  <span className="text-xl font-bold text-primary tabular-nums">{formatCurrency(totals.total)}</span>
                </div>
                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-1.5 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                  <Tag className="w-4 h-4" /> Total savings {formatCurrency(totals.discount)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: "red" }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${accent === "red" ? "text-destructive" : "text-foreground"}`}>{value}</span>
    </div>
  );
}
