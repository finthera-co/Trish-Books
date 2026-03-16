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

  const resetForm = () => {
    setName(""); setCondField("description"); setCondOp("contains"); setCondVal("");
    setAmtMin(""); setAmtMax(""); setActionType("auto_match"); setActionAccountId(""); setPriority("0");
  };

  const handleCreate = async () => {
    if (!name || !condVal) return;
    await createRule.mutateAsync({
      name,
      condition_field: condField,
      condition_operator: condOp,
      condition_value: condVal,
      condition_amount_min: amtMin ? parseFloat(amtMin) : undefined,
      condition_amount_max: amtMax ? parseFloat(amtMax) : undefined,
      action_type: actionType,
      action_account_id: actionAccountId || undefined,
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
                        <Badge variant="secondary">{r.action_type.replace("_", " ")}</Badge>
                        {r.accounts && <span className="ml-1">→ {r.accounts.account_name}</span>}
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Action</Label>
                  <Select value={actionType} onValueChange={setActionType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto_match">Auto Match</SelectItem>
                      <SelectItem value="assign_account">Assign Account</SelectItem>
                      <SelectItem value="create_expense">Create Expense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(actionType === "assign_account" || actionType === "create_expense") && (
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
