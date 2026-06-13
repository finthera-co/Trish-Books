import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useReconciliationRules, useCreateRule, useUpdateRule, useDeleteRule } from "@/hooks/useReconciliationRules";
import { useAccounts } from "@/hooks/useData";
import { Settings2, Plus, Trash2 } from "lucide-react";

export default function ReconciliationRulesManager() {
  const { data: rules, isLoading } = useReconciliationRules();
  const { data: accounts } = useAccounts();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const [open, setOpen] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [condField, setCondField] = useState("description");
  const [condOp, setCondOp] = useState("contains");
  const [condVal, setCondVal] = useState("");
  const [amtMin, setAmtMin] = useState("");
  const [amtMax, setAmtMax] = useState("");
  const [actionType, setActionType] = useState("auto_match");
  const [actionAccountId, setActionAccountId] = useState("");
  const [priority, setPriority] = useState("0");
  // Rule action execution (auto-post a JE for rule-only matches)
  const [createExpense, setCreateExpense] = useState(false);
  const [direction, setDirection] = useState("outflow");
  const [taxAccountId, setTaxAccountId] = useState("");
  const [taxRatePct, setTaxRatePct] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [formError, setFormError] = useState("");

  const resetForm = () => {
    setName(""); setCondField("description"); setCondOp("contains"); setCondVal("");
    setAmtMin(""); setAmtMax(""); setActionType("auto_match"); setActionAccountId(""); setPriority("0");
    setCreateExpense(false); setDirection("outflow"); setTaxAccountId(""); setTaxRatePct(""); setCounterparty("");
    setFormError("");
  };

  const accountLabel =
    direction === "inflow" ? "Income account" : direction === "outflow" ? "Expense/Fee account" : "Account";

  const handleCreate = async () => {
    if (!name || !condVal) return;
    // Validation for action execution
    if (createExpense && !actionAccountId) {
      setFormError(`Select an ${accountLabel.toLowerCase()} — required to auto-create the journal entry.`);
      return;
    }
    const ratePct = taxRatePct ? parseFloat(taxRatePct) : 0;
    if (createExpense && ratePct > 0 && !taxAccountId) {
      setFormError("A tax rate is set but no tax account is selected.");
      return;
    }
    setFormError("");
    await createRule.mutateAsync({
      name,
      condition_field: condField,
      condition_operator: condOp,
      condition_value: condVal,
      condition_amount_min: amtMin ? parseFloat(amtMin) : undefined,
      condition_amount_max: amtMax ? parseFloat(amtMax) : undefined,
      action_type: createExpense ? "create_expense" : actionType,
      action_account_id: actionAccountId || undefined,
      action_create_expense: createExpense,
      action_direction: createExpense ? direction : undefined,
      tax_account_id: createExpense && taxAccountId ? taxAccountId : undefined,
      tax_rate: createExpense && ratePct > 0 ? ratePct / 100 : undefined,
      counterparty_name: createExpense && counterparty ? counterparty : undefined,
      priority: parseInt(priority) || 0,
    });
    resetForm();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="w-3 h-3 mr-1" /> Rules
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Auto-Reconciliation Rules
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing Rules */}
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : (rules || []).length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">No rules created yet.</p>
          ) : (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rules || []).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="mr-1">{r.condition_field}</Badge>
                        {r.condition_operator} "{r.condition_value}"
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.action_create_expense
                          ? <Badge className="bg-purple-600">Auto-post {r.action_direction || "outflow"}</Badge>
                          : <Badge variant="secondary">{r.action_type.replace("_", " ")}</Badge>}
                        {r.accounts && <span className="ml-1">→ {r.accounts.account_name}</span>}
                        {r.action_create_expense && Number(r.tax_rate) > 0 && (
                          <span className="ml-1 text-muted-foreground">+{(Number(r.tax_rate) * 100).toFixed(0)}% tax</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={r.is_active}
                          onCheckedChange={(checked) => updateRule.mutate({ id: r.id, is_active: checked })}
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => deleteRule.mutate(r.id)}>
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Create Rule Form */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-1">
                <Plus className="w-4 h-4" /> New Rule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Rule Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bank Charges" />
                </div>
                <div>
                  <Label className="text-xs">Priority</Label>
                  <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Condition Field</Label>
                  <Select value={condField} onValueChange={setCondField}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="description">Description</SelectItem>
                      <SelectItem value="amount">Amount</SelectItem>
                      <SelectItem value="reference">Reference</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Operator</Label>
                  <Select value={condOp} onValueChange={setCondOp}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="equals">Equals</SelectItem>
                      <SelectItem value="range">Amount Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Value</Label>
                  <Input value={condVal} onChange={(e) => setCondVal(e.target.value)} placeholder="e.g. BANK CHARGE" />
                </div>
              </div>

              {condOp === "range" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Min Amount</Label>
                    <Input type="number" value={amtMin} onChange={(e) => setAmtMin(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Max Amount</Label>
                    <Input type="number" value={amtMax} onChange={(e) => setAmtMax(e.target.value)} />
                  </div>
                </div>
              )}

              {/* Auto-post toggle: master switch for rule action execution */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="text-xs font-medium">Auto-create journal entry</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Post a balanced JE and clear the bank line when this rule matches an unmatched transaction.
                  </p>
                </div>
                <Switch checked={createExpense} onCheckedChange={setCreateExpense} />
              </div>

              {!createExpense ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Action</Label>
                    <Select value={actionType} onValueChange={setActionType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto_match">Auto Match</SelectItem>
                        <SelectItem value="assign_account">Assign Account</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {actionType === "assign_account" && (
                    <div>
                      <Label className="text-xs">Target Account</Label>
                      <Select value={actionAccountId} onValueChange={setActionAccountId}>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {(accounts || []).map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Direction</Label>
                      <Select value={direction} onValueChange={setDirection}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="outflow">Outflow (money out — fee/expense)</SelectItem>
                          <SelectItem value="inflow">Inflow (money in — income)</SelectItem>
                          <SelectItem value="either">Either (decide by sign)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">{accountLabel} <span className="text-destructive">*</span></Label>
                      <Select value={actionAccountId} onValueChange={setActionAccountId}>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {(accounts || []).map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Tax account <span className="text-muted-foreground">(optional)</span></Label>
                      <Select value={taxAccountId} onValueChange={setTaxAccountId}>
                        <SelectTrigger><SelectValue placeholder="No tax" /></SelectTrigger>
                        <SelectContent>
                          {(accounts || []).map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>{a.account_code} – {a.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Tax rate %</Label>
                      <Input
                        type="number" min="0" max="99" step="0.01"
                        value={taxRatePct} onChange={(e) => setTaxRatePct(e.target.value)}
                        placeholder="e.g. 18"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Counterparty / Payee <span className="text-muted-foreground">(optional)</span></Label>
                    <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="e.g. Acme Bank" />
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    Amount is treated as tax-inclusive. {direction === "inflow"
                      ? "Dr Bank / Cr income (and Cr tax)."
                      : "Dr expense (and Dr tax) / Cr Bank."}
                  </p>
                </div>
              )}

              {formError && <p className="text-[11px] text-destructive">{formError}</p>}

              <Button onClick={handleCreate} disabled={!name || !condVal || createRule.isPending} size="sm">
                {createRule.isPending ? "Creating..." : "Create Rule"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
