import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Send, Truck, Eye } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import {
  useLandedCostVouchers, useCreateLandedCostVoucher, usePostLandedCostVoucher,
  useDeleteLandedCostVoucher, useLandedCostVoucher, usePostedGRNs,
  type AllocationMethod, type LandedCostChargeInput,
} from "@/hooks/useLandedCosts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

function useOffsetAccounts() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["landed_cost_offset_accounts", appUser?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", appUser!.tenant_id)
        .eq("is_active", true)
        .in("account_type", ["Liability", "Asset"])
        .order("account_code");
      if (error) throw error;
      return data || [];
    },
    enabled: !!appUser?.tenant_id,
  });
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  posted: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-700",
};

const METHOD_LABELS: Record<AllocationMethod, string> = {
  value: "By Value",
  qty: "By Quantity",
  weight: "By Weight",
};

export function LandedCostsTab() {
  const { data: vouchers = [], isLoading } = useLandedCostVouchers();
  const post = usePostLandedCostVoucher();
  const del = useDeleteLandedCostVoucher();
  const [viewId, setViewId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" /> Landed Cost Allocation
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Allocate freight, customs &amp; insurance across GRN items by value, qty, or weight.
            Posts: <span className="font-mono">Dr Inventory / Cr Charge offset accounts</span>; FIFO lots and WAC are uplifted automatically.
          </p>
        </div>
        <NewLandedCostDialog />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : vouchers.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            No landed cost vouchers yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Total Charges</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.map((v: any) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.voucher_number}</TableCell>
                  <TableCell>{format(new Date(v.voucher_date), "yyyy-MM-dd")}</TableCell>
                  <TableCell>{METHOD_LABELS[v.allocation_method as AllocationMethod]}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(Number(v.total_charges))}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[v.status]}>{v.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="ghost" onClick={() => setViewId(v.id)}>
                      <Eye className="w-3 h-3" />
                    </Button>
                    {v.status === "draft" && (
                      <>
                        <Button size="sm" onClick={() => post.mutate(v.id)} disabled={post.isPending}>
                          <Send className="w-3 h-3 mr-1" /> Post
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => del.mutate(v.id)} disabled={del.isPending}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {viewId && <ViewLandedCostDialog id={viewId} onClose={() => setViewId(null)} />}
    </Card>
  );
}

function ViewLandedCostDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useLandedCostVoucher(id);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Landed Cost Voucher {data?.voucher_number}</DialogTitle>
          <DialogDescription>
            {data && `${METHOD_LABELS[data.allocation_method as AllocationMethod]} • ${data.status}`}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <div>Loading…</div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Linked GRNs</Label>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>GRN</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Value</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.grns.map((g: any) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-mono">{g.grn?.grn_number}</TableCell>
                      <TableCell>{g.grn?.receipt_date}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(g.grn?.total_value || 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <Label className="text-xs uppercase text-muted-foreground">Charges</Label>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Description</TableHead><TableHead>Offset Account</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.charges.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.description}</TableCell>
                      <TableCell className="font-mono text-xs">{c.account?.account_code} — {c.account?.account_name}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(Number(c.amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {data.allocations.length > 0 && (
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Allocations</Label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Basis</TableHead>
                      <TableHead className="text-right">Allocated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.allocations.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell>{a.item?.item_code ? `${a.item.item_code} — ` : ""}{a.item?.item_name}</TableCell>
                        <TableCell className="text-right font-mono">{Number(a.basis_value).toFixed(4)}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(Number(a.allocated_amount))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewLandedCostDialog() {
  const [open, setOpen] = useState(false);
  const { data: grns = [] } = usePostedGRNs();
  const { data: offsetAccounts = [] } = useOffsetAccounts();
  const create = useCreateLandedCostVoucher();

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [method, setMethod] = useState<AllocationMethod>("value");
  const [notes, setNotes] = useState("");
  const [grnIds, setGrnIds] = useState<string[]>([]);
  const [charges, setCharges] = useState<LandedCostChargeInput[]>([
    { description: "Freight", amount: 0, offset_account_id: "" },
  ]);

  // Eligible offset accounts: Liability (AP, Clearing) or Asset (Cash/Bank)
  const offsetAccounts = useMemo(
    () => (accounts || []).filter((a: any) => ["Liability", "Asset"].includes(a.account_type)),
    [accounts],
  );

  const totalCharges = charges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const valid =
    grnIds.length > 0 &&
    charges.length > 0 &&
    charges.every((c) => c.description.trim() && c.amount > 0 && c.offset_account_id);

  const reset = () => {
    setDate(format(new Date(), "yyyy-MM-dd"));
    setMethod("value");
    setNotes("");
    setGrnIds([]);
    setCharges([{ description: "Freight", amount: 0, offset_account_id: "" }]);
  };

  const submit = async () => {
    await create.mutateAsync({
      voucher_date: date,
      allocation_method: method,
      notes,
      grn_ids: grnIds,
      charges,
    });
    reset();
    setOpen(false);
  };

  const toggleGrn = (id: string) =>
    setGrnIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const updCharge = (i: number, patch: Partial<LandedCostChargeInput>) =>
    setCharges(charges.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="w-4 h-4 mr-2" /> New Landed Cost</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Landed Cost Voucher</DialogTitle>
          <DialogDescription>
            Pick the GRNs to absorb the cost, then list each charge (freight, customs, insurance) with its offset account.
            On posting, costs are debited to each item's inventory account proportionally.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Allocation Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as AllocationMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="value">By Value (line total)</SelectItem>
                <SelectItem value="qty">By Quantity</SelectItem>
                <SelectItem value="weight">By Weight (item × qty)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <div className="text-sm text-muted-foreground">
              <div>Total charges</div>
              <div className="font-bold text-foreground text-lg">{formatCurrency(totalCharges)}</div>
            </div>
          </div>
        </div>

        <div>
          <Label className="text-xs uppercase text-muted-foreground">Select Posted GRNs</Label>
          <div className="border rounded max-h-48 overflow-y-auto mt-1">
            {grns.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No posted GRNs available.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>GRN</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grns.map((g: any) => (
                    <TableRow key={g.id} className="cursor-pointer" onClick={() => toggleGrn(g.id)}>
                      <TableCell><Checkbox checked={grnIds.includes(g.id)} /></TableCell>
                      <TableCell className="font-mono text-xs">{g.grn_number}</TableCell>
                      <TableCell>{g.vendor?.name || "—"}</TableCell>
                      <TableCell>{g.receipt_date}</TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(g.total_value))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center">
            <Label className="text-xs uppercase text-muted-foreground">Charges</Label>
            <Button size="sm" variant="outline" onClick={() => setCharges([...charges, { description: "", amount: 0, offset_account_id: "" }])}>
              <Plus className="w-3 h-3 mr-1" /> Add charge
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Offset Account</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {charges.map((c, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input value={c.description} onChange={(e) => updCharge(i, { description: e.target.value })} placeholder="e.g. Freight" />
                  </TableCell>
                  <TableCell>
                    <Select value={c.offset_account_id} onValueChange={(v) => updCharge(i, { offset_account_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select offset account" /></SelectTrigger>
                      <SelectContent>
                        {offsetAccounts.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.account_code} — {a.account_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" min="0" className="text-right"
                      value={c.amount} onChange={(e) => updCharge(i, { amount: Number(e.target.value) })} />
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => setCharges(charges.filter((_, idx) => idx !== i))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>Save draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
