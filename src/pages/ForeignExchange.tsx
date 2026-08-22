import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Coins, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import {
  useExchangeRates, useUpsertExchangeRate, useFxRevaluations, useRunFxRevaluation,
  useApFxRevaluations, useRunApFxRevaluation,
} from "@/hooks/useForeignExchange";
import { formatDate } from "@/lib/format";
import { FOREIGN_CURRENCIES as CURRENCIES } from "@/lib/currencies";

export default function ForeignExchange() {
  const navigate = useNavigate();
  const { data: settings } = useAccountSettings();
  const { data: rates, isLoading } = useExchangeRates();
  const { data: revals } = useFxRevaluations();
  const { data: apRevals } = useApFxRevaluations();
  const upsertRate = useUpsertExchangeRate();
  const runReval = useRunFxRevaluation();
  const runApReval = useRunApFxRevaluation();

  const [rateForm, setRateForm] = useState({ currency: "USD", rate_date: new Date().toISOString().split("T")[0], rate_to_base: "" });
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().split("T")[0]);
  const [apPeriodEnd, setApPeriodEnd] = useState(new Date().toISOString().split("T")[0]);

  const fxConfigured = !!settings?.fx_gain_account_id && !!settings?.fx_loss_account_id;

  const handleAddRate = async () => {
    const r = Number(rateForm.rate_to_base);
    if (!r || r <= 0) return;
    await upsertRate.mutateAsync({ currency: rateForm.currency, rate_date: rateForm.rate_date, rate_to_base: r });
    setRateForm((f) => ({ ...f, rate_to_base: "" }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Coins className="w-6 h-6 text-primary" /> Foreign Exchange</h1>
          <p className="text-sm text-muted-foreground">Maintain rates and run period-end AR/AP revaluation (base currency: LKR)</p>
        </div>
      </div>

      {!fxConfigured && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          FX Gain and FX Loss accounts are not configured. Set them in Settings → Account Mapping before running a revaluation.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Add rate */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Add / update rate</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Currency</Label>
              <Select value={rateForm.currency} onValueChange={(v) => setRateForm({ ...rateForm, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rate date</Label>
              <Input type="date" value={rateForm.rate_date} onChange={(e) => setRateForm({ ...rateForm, rate_date: e.target.value })} />
            </div>
            <div>
              <Label>1 {rateForm.currency} = ? LKR</Label>
              <Input type="number" step="0.0001" value={rateForm.rate_to_base} onChange={(e) => setRateForm({ ...rateForm, rate_to_base: e.target.value })} placeholder="e.g. 305.50" className="font-mono" />
            </div>
            <Button className="w-full" onClick={handleAddRate} disabled={!rateForm.rate_to_base || upsertRate.isPending}>
              <Plus className="w-4 h-4 mr-1.5" /> {upsertRate.isPending ? "Saving…" : "Save rate"}
            </Button>
          </CardContent>
        </Card>

        {/* AR period-end revaluation */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">AR period-end revaluation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Revalues all open foreign-currency invoices to the closing rate, posts one net FX adjustment dated the period end, and an
              automatic reversal the next day. Re-running for the same date replaces the prior run.
            </p>
            <div className="flex items-end gap-3">
              <div>
                <Label>Period end date</Label>
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
              <Button onClick={() => runReval.mutate(periodEnd)} disabled={!fxConfigured || runReval.isPending}>
                <RefreshCw className="w-4 h-4 mr-1.5" /> {runReval.isPending ? "Running…" : "Run revaluation"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="hidden lg:block lg:col-span-1" />
        {/* AP period-end revaluation */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">AP period-end revaluation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Revalues all open foreign-currency bills to the closing rate, posts one net FX adjustment dated the period end, and an
              automatic reversal the next day. Since AP is a liability, a foreign bill costing MORE in base is a loss (the mirror image of AR).
            </p>
            <div className="flex items-end gap-3">
              <div>
                <Label>Period end date</Label>
                <Input type="date" value={apPeriodEnd} onChange={(e) => setApPeriodEnd(e.target.value)} />
              </div>
              <Button onClick={() => runApReval.mutate(apPeriodEnd)} disabled={!fxConfigured || runApReval.isPending}>
                <RefreshCw className="w-4 h-4 mr-1.5" /> {runApReval.isPending ? "Running…" : "Run revaluation"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rates table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Exchange rates</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : (rates || []).length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No rates yet</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Currency</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Rate (→ LKR)</TableHead></TableRow></TableHeader>
              <TableBody>
                {(rates || []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.currency}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(r.rate_date)}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono">{Number(r.rate_to_base).toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* AR revaluation history */}
      {(revals || []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">AR revaluation history</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Period end</TableHead><TableHead>Invoice</TableHead><TableHead>Currency</TableHead><TableHead className="text-right">Open (FC)</TableHead><TableHead className="text-right">FX delta (LKR)</TableHead></TableRow></TableHeader>
              <TableBody>
                {(revals || []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">{formatDate(r.period_end)}</TableCell>
                    <TableCell className="font-medium">{(r.invoices as any)?.invoice_number || "—"}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono">{Number(r.open_amount_fc).toFixed(2)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${Number(r.fx_delta) >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                      {Number(r.fx_delta) >= 0 ? "+" : ""}{formatCurrency(Number(r.fx_delta))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* AP revaluation history */}
      {(apRevals || []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">AP revaluation history</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Period end</TableHead><TableHead>Bill</TableHead><TableHead>Currency</TableHead><TableHead className="text-right">Open (FC)</TableHead><TableHead className="text-right">FX delta (LKR)</TableHead></TableRow></TableHeader>
              <TableBody>
                {(apRevals || []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">{formatDate(r.period_end)}</TableCell>
                    <TableCell className="font-medium">{(r.supplier_bills as any)?.bill_number || "—"}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono">{Number(r.open_amount_fc).toFixed(2)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${Number(r.fx_delta) >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                      {Number(r.fx_delta) >= 0 ? "+" : ""}{formatCurrency(Number(r.fx_delta))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
