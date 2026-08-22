import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CreditCard, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/currency";
import { useCustomers, useInvoices } from "@/hooks/useData";
import { useARAccounts, useReceiveCustomerPayment } from "@/hooks/useARModule";
import AccountCombobox from "@/components/shared/AccountCombobox";

// One customer receipt settling many invoices in a single server-posted
// transaction: journal + allocations + AR sub-ledgers move together, any
// overpayment is held on account as a customer deposit.
export default function ReceivePayment() {
  const navigate = useNavigate();
  const { data: customers } = useCustomers();
  const { data: invoices } = useInvoices();
  const { data: accounts } = useARAccounts();
  const receivePayment = useReceiveCustomerPayment();
  // Deep-linked from a bank/cash account's context menu ("Quick Create → Receive Payment").
  const [searchParams] = useSearchParams();

  const [customerId, setCustomerId] = useState("");
  const [bankAccountId, setBankAccountId] = useState(() => searchParams.get("deposit_to") ?? "");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [selectedInvoices, setSelectedInvoices] = useState<Record<string, number>>({});
  const [withheldAmount, setWithheldAmount] = useState("");
  // Optional: total money actually received. When it exceeds the allocations,
  // the difference is held on account as a customer deposit.
  const [amountReceived, setAmountReceived] = useState("");

  const customerInvoices = useMemo(
    () =>
      ((invoices || []) as any[])
        .filter((i) => i.customer_id === customerId && i.balance_due > 0 && i.status !== "draft" && i.status !== "voided")
        .sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"))),
    [invoices, customerId],
  );

  const allocatedTotal = Object.values(selectedInvoices).reduce((s, v) => s + v, 0);
  const received = parseFloat(amountReceived || "") || 0;
  const overpayment = received > 0 ? Math.max(0, Math.round((received - allocatedTotal) * 100) / 100) : 0;
  const underAllocated = received > 0 && received < allocatedTotal - 0.005;

  const customer = (customers || []).find((c: any) => c.id === customerId) as any;
  const customerWithholds = !!customer?.withholds_tax;
  const grossReceipt = allocatedTotal + overpayment;
  const totalWithheld = customerWithholds ? Math.min(parseFloat(withheldAmount || "0") || 0, grossReceipt) : 0;
  const netBank = Math.round((grossReceipt - totalWithheld) * 100) / 100;

  // Mixed-currency receipts are rejected server-side; keep the UI honest too.
  const selectedCurrencies = new Set(
    Object.keys(selectedInvoices)
      .map((id) => (customerInvoices.find((i: any) => i.id === id) as any)?.currency || "LKR"),
  );
  const mixedCurrency = selectedCurrencies.size > 1;

  const handleApply = async () => {
    const allocations = Object.entries(selectedInvoices)
      .filter(([, a]) => a > 0)
      .map(([invoice_id, amount]) => ({ invoice_id, amount }));

    await receivePayment.mutateAsync({
      customer_id: customerId,
      payment_date: paymentDate,
      payment_method: paymentMethod,
      reference: reference || undefined,
      bank_account_id: bankAccountId,
      allocations,
      unapplied_amount: overpayment > 0 ? overpayment : undefined,
      overpayment_action: overpayment > 0 ? "deposit" : undefined,
      wht_amount: totalWithheld > 0 ? totalWithheld : undefined,
    });
    navigate("/sales/customers/" + customerId);
  };

  // Oldest-first auto-application of the amount received.
  const autoApply = () => {
    if (!(received > 0)) return;
    let remaining = received;
    const next: Record<string, number> = {};
    for (const inv of customerInvoices as any[]) {
      if (remaining <= 0.004) break;
      const take = Math.min(remaining, Number(inv.balance_due));
      next[inv.id] = Math.round(take * 100) / 100;
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    setSelectedInvoices(next);
  };

  const toggleInvoice = (invId: string, balanceDue: number) => {
    setSelectedInvoices((prev) => {
      if (prev[invId] !== undefined) {
        const next = { ...prev };
        delete next[invId];
        return next;
      }
      return { ...prev, [invId]: balanceDue };
    });
  };

  const canSubmit =
    !!customerId &&
    !!bankAccountId &&
    grossReceipt > 0 &&
    allocatedTotal >= 0 &&
    !mixedCurrency &&
    !underAllocated &&
    !receivePayment.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary" /> Receive Payment
          </h1>
          <p className="text-sm text-muted-foreground">One receipt can settle several invoices; any excess is held on the customer's account</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Payment Details */}
        <Card className="col-span-1">
          <CardHeader><CardTitle>Payment Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Customer *</Label>
              <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setSelectedInvoices({}); }}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {(customers || []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment Date</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Deposit To (Bank Account) *</Label>
              <AccountCombobox
                options={accounts?.bankAccounts || []}
                value={bankAccountId}
                onChange={setBankAccountId}
                placeholder="Select bank account"
              />
            </div>
            <div>
              <Label>Reference / Check #</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. CHK-001" />
            </div>

            <div className="pt-3 border-t border-border space-y-2">
              <Label>Amount received (optional)</Label>
              <div className="flex gap-2">
                <Input
                  type="number" step="0.01" min="0"
                  value={amountReceived}
                  onChange={(e) => setAmountReceived(e.target.value)}
                  placeholder={allocatedTotal > 0 ? allocatedTotal.toFixed(2) : "0.00"}
                />
                <Button type="button" variant="outline" size="icon" title="Auto-apply oldest first"
                  onClick={autoApply} disabled={!(received > 0) || customerInvoices.length === 0}>
                  <Wand2 className="w-4 h-4" />
                </Button>
              </div>
              {overpayment > 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  {formatCurrency(overpayment)} exceeds the allocations and will be held on account as a customer deposit.
                </p>
              )}
              {underAllocated && (
                <p className="text-[11px] text-destructive">
                  Allocations ({formatCurrency(allocatedTotal)}) exceed the amount received — reduce them or clear this field.
                </p>
              )}
            </div>

            {customerWithholds && (
              <div className="pt-3 border-t border-border space-y-2">
                <div>
                  <Label>Tax withheld by customer</Label>
                  <Input type="number" step="0.01" min="0" value={withheldAmount}
                    onChange={(e) => setWithheldAmount(e.target.value)} placeholder="0.00" />
                </div>
                {totalWithheld > 0 && (
                  <div className="p-2 rounded-md bg-muted/30 text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Gross AR settled</span><span className="font-mono">{formatCurrency(grossReceipt)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Withheld</span><span className="font-mono text-destructive">-{formatCurrency(totalWithheld)}</span></div>
                    <div className="flex justify-between font-semibold border-t pt-1"><span>Net bank</span><span className="font-mono">{formatCurrency(netBank)}</span></div>
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">Applied to invoices</p>
              <p className="text-2xl font-bold text-primary tabular-nums">{formatCurrency(allocatedTotal)}</p>
              {overpayment > 0 && (
                <p className="text-xs text-muted-foreground mt-1">+ {formatCurrency(overpayment)} on account</p>
              )}
            </div>

            {mixedCurrency && (
              <p className="text-[11px] text-destructive">
                Selected invoices are in different currencies — record separate receipts per currency.
              </p>
            )}

            <Button className="w-full" onClick={handleApply} disabled={!canSubmit}>
              {receivePayment.isPending ? "Posting..." : "Record Receipt"}
            </Button>
          </CardContent>
        </Card>

        {/* Right: Outstanding Invoices */}
        <Card className="col-span-2">
          <CardHeader><CardTitle>Outstanding Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!customerId ? (
              <p className="text-center py-8 text-muted-foreground">Select a customer to see outstanding invoices</p>
            ) : customerInvoices.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">No outstanding invoices for this customer</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Original</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerInvoices.map((inv: any) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedInvoices[inv.id] !== undefined}
                          onCheckedChange={() => toggleInvoice(inv.id, inv.balance_due)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {inv.invoice_number}
                        {(inv.currency || "LKR") !== "LKR" && (
                          <span className="ml-1 text-[10px] text-muted-foreground">{inv.currency}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{inv.due_date || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(Number(inv.total_amount), inv.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive font-semibold">{formatCurrency(inv.balance_due, inv.currency)}</TableCell>
                      <TableCell className="text-right">
                        {selectedInvoices[inv.id] !== undefined ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-28 text-right ml-auto"
                            value={selectedInvoices[inv.id]}
                            onChange={(e) =>
                              setSelectedInvoices((prev) => ({
                                ...prev,
                                [inv.id]: Math.min(Number(e.target.value) || 0, inv.balance_due),
                              }))
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
