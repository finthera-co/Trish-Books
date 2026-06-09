import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Info, Plus } from "lucide-react";
import { usePayrollComponents } from "@/hooks/usePayroll";
import {
  usePayrollGLMappings,
  useUpsertPayrollGLMapping,
  useDeletePayrollGLMapping,
  usePayrollDeptGLMappings,
  useUpsertPayrollDeptGL,
  useDeletePayrollDeptGL,
  SUGGESTED_SIDE,
} from "@/hooks/usePayrollGLMapping";
import { useAccounts } from "@/hooks/useData";

const POSTABLE_KINDS = new Set(["base", "earning", "deduction", "employer_contribution"]);
const ALWAYS_INCLUDE = new Set(["NET_PAY"]);
const SKIP = new Set(["GROSS_PAY"]);

function AddDeptOverrideDialog({ open, onOpenChange, components, accountOptions, onSave }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  components: any[];
  accountOptions: any[];
  onSave: (v: { department: string; component_code: string; account_id: string; posting_side: "debit" | "credit" }) => void;
}) {
  const [form, setForm] = useState({ department: "", component_code: "", account_id: "", posting_side: "debit" as "debit" | "credit" });

  const handleSave = () => {
    if (!form.department || !form.component_code || !form.account_id) return;
    onSave(form);
    setForm({ department: "", component_code: "", account_id: "", posting_side: "debit" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Department Override</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Department</Label>
            <Input
              placeholder="e.g. Engineering, Sales, HR"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </div>
          <div>
            <Label>Component</Label>
            <Select value={form.component_code} onValueChange={(v) => setForm({ ...form, component_code: v })}>
              <SelectTrigger><SelectValue placeholder="Select component…" /></SelectTrigger>
              <SelectContent>
                {components.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Posting Side</Label>
            <Select value={form.posting_side} onValueChange={(v) => setForm({ ...form, posting_side: v as "debit" | "credit" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="debit">Debit</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>GL Account</Label>
            <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
              <SelectContent>
                {accountOptions.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={handleSave} disabled={!form.department || !form.component_code || !form.account_id}>
            Save Override
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PayrollGLMapping() {
  const { data: components = [], isLoading: cLoad } = usePayrollComponents();
  const { data: accounts = [] } = useAccounts();
  const { data: mappings = [], isLoading: mLoad } = usePayrollGLMappings();
  const { data: deptMappings = [] } = usePayrollDeptGLMappings();
  const upsert = useUpsertPayrollGLMapping();
  const remove = useDeletePayrollGLMapping();
  const upsertDept = useUpsertPayrollDeptGL();
  const removeDept = useDeletePayrollDeptGL();
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);

  const postableComponents = useMemo(() => {
    const seen = new Set<string>();
    return components
      .filter((c) => !SKIP.has(c.code))
      .filter((c) => POSTABLE_KINDS.has(c.kind) || ALWAYS_INCLUDE.has(c.code))
      .filter((c) => (seen.has(c.code) ? false : (seen.add(c.code), true)));
  }, [components]);

  const mapByCode = useMemo(() => {
    const m = new Map<string, typeof mappings[number]>();
    for (const x of mappings) m.set(x.component_code, x);
    return m;
  }, [mappings]);

  const accountOptions = useMemo(
    () => (accounts || []).filter((a: any) => a.is_active).sort((a: any, b: any) => a.account_code.localeCompare(b.account_code)),
    [accounts]
  );

  const accountById = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of accounts as any[]) m.set(a.id, a);
    return m;
  }, [accounts]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Payroll → GL Account Mapping</h1>
        <p className="text-muted-foreground mt-1">
          Configure which Chart of Accounts entry each payroll component posts to. This is required before payroll runs can be posted to the General Ledger.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" /> Standard Posting Convention
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><strong>Debit (Expense):</strong> Basic, Overtime, Bonus, Allowances, EPF Employer, ETF Employer</p>
          <p><strong>Credit (Liability):</strong> EPF Employee (payable), Other Deductions (payable), Net Pay (salaries payable)</p>
          <p className="text-muted-foreground italic">
            On payment day, debit "Salaries Payable" and credit Bank/Cash via a separate Payment Voucher.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Component Mappings</CardTitle>
          <CardDescription>
            {mappings.length} of {postableComponents.length} components mapped
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cLoad || mLoad ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>GL Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {postableComponents.map((c) => {
                  const mapping = mapByCode.get(c.code);
                  const suggestedSide = SUGGESTED_SIDE[c.code] || "debit";
                  const side = mapping?.posting_side || suggestedSide;
                  return (
                    <TableRow key={c.code}>
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{c.code}</div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={side}
                          onValueChange={(v) =>
                            upsert.mutate({
                              id: mapping?.id,
                              component_code: c.code,
                              posting_side: v as "debit" | "credit",
                              account_id: mapping?.account_id || "",
                            })
                          }
                          disabled={!mapping?.account_id}
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="debit">Debit</SelectItem>
                            <SelectItem value="credit">Credit</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping?.account_id || ""}
                          onValueChange={(v) =>
                            upsert.mutate({
                              id: mapping?.id,
                              component_code: c.code,
                              posting_side: side,
                              account_id: v,
                            })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select account…" />
                          </SelectTrigger>
                          <SelectContent>
                            {accountOptions.map((a: any) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.account_code} — {a.account_name}{" "}
                                <span className="text-muted-foreground ml-1">({a.account_type})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {mapping ? (
                          <Badge variant="secondary">Mapped</Badge>
                        ) : (
                          <Badge variant="outline">Unmapped</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {mapping && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => remove.mutate(mapping.id)}
                            title="Remove mapping"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Department Cost Centre Overrides */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Department Cost Centre Overrides</CardTitle>
            <CardDescription>
              Optional: route specific components for a department to a different GL account than the global mapping.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDeptDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add Override
          </Button>
        </CardHeader>
        <CardContent>
          {deptMappings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No overrides configured — all departments use the global component mappings above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Component</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>GL Account</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deptMappings.map((dm) => {
                  const acct = accountById.get(dm.account_id);
                  return (
                    <TableRow key={dm.id}>
                      <TableCell className="font-medium">{dm.department}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{dm.component_code}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{dm.posting_side}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {acct ? `${acct.account_code} — ${acct.account_name}` : dm.account_id}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeDept.mutate(dm.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddDeptOverrideDialog
        open={deptDialogOpen}
        onOpenChange={setDeptDialogOpen}
        components={postableComponents}
        accountOptions={accountOptions}
        onSave={(v) => upsertDept.mutate(v)}
      />
    </div>
  );
}
