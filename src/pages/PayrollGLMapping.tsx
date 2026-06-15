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
  type PayrollComponentAccount,
} from "@/hooks/usePayrollGLMapping";
import { useAccounts } from "@/hooks/useData";
import { sortAccounts } from "@/lib/accountSort";

const POSTABLE_KINDS = new Set(["base", "earning", "deduction", "employer_contribution"]);
const ALWAYS_INCLUDE = new Set(["NET_PAY"]);
const SKIP = new Set(["GROSS_PAY"]);

// Statutory remittance components — these need two GL accounts each (expense + liability payable),
// except EPF_EMPLOYEE which only needs the credit (liability) side.
const STATUTORY_REMITTANCE = new Set(["EPF_EMPLOYEE", "EPF_EMPLOYER", "ETF_EMPLOYER"]);

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

  // Two-dimensional map: component_code → posting_side → mapping row
  const mapByCodeSide = useMemo(() => {
    const m = new Map<string, Map<"debit" | "credit", PayrollComponentAccount>>();
    for (const x of mappings) {
      if (!m.has(x.component_code)) m.set(x.component_code, new Map());
      m.get(x.component_code)!.set(x.posting_side, x);
    }
    return m;
  }, [mappings]);

  const accountOptions = useMemo(
    () => sortAccounts((accounts || []).filter((a: any) => a.is_active)),
    [accounts]
  );

  const expenseAccountOptions = useMemo(
    () => accountOptions.filter((a: any) => a.account_type === "Expense"),
    [accountOptions]
  );

  const liabilityAccountOptions = useMemo(
    () => accountOptions.filter((a: any) => a.account_type === "Liability"),
    [accountOptions]
  );

  const accountById = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of accounts as any[]) m.set(a.id, a);
    return m;
  }, [accounts]);

  // Count fully-mapped components: statutory employer needs BOTH sides; others need their suggested side
  const fullyMappedCount = useMemo(() => {
    return postableComponents.filter((c) => {
      const sides = mapByCodeSide.get(c.code);
      if (STATUTORY_REMITTANCE.has(c.code) && c.code !== "EPF_EMPLOYEE") {
        return !!(sides?.get("debit")?.account_id && sides?.get("credit")?.account_id);
      }
      if (c.code === "EPF_EMPLOYEE") return !!sides?.get("credit")?.account_id;
      return !!sides?.get(SUGGESTED_SIDE[c.code] || "debit")?.account_id;
    }).length;
  }, [postableComponents, mapByCodeSide]);

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
          <p>
            <strong>EPF Employer & ETF Employer (two accounts required):</strong>
          </p>
          <ul className="ml-4 space-y-1 list-disc text-muted-foreground">
            <li><strong className="text-foreground">Expense Account (Dr)</strong> — payroll cost account debited when the run is posted (e.g. "EPF Employer Expense")</li>
            <li><strong className="text-foreground">Liability Payable (Cr)</strong> — payable account credited when run is posted; debited when you remit (e.g. "EPF Employer Contributions Payable")</li>
          </ul>
          <p className="mt-1">
            <strong>EPF Employee (one account):</strong>{" "}
            <span className="text-muted-foreground">Liability Payable (Cr) only — debited when remitted to the fund.</span>
          </p>
          <p>
            <strong>All other components:</strong>{" "}
            <span className="text-muted-foreground">Single account, standard side as shown in the Side column.</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Component Mappings</CardTitle>
          <CardDescription>
            {fullyMappedCount} of {postableComponents.length} components fully mapped
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
                  const sides = mapByCodeSide.get(c.code);
                  const isStatutoryEmployer = STATUTORY_REMITTANCE.has(c.code) && c.code !== "EPF_EMPLOYEE";
                  const isEPFEmployee = c.code === "EPF_EMPLOYEE";
                  const suggestedSide = SUGGESTED_SIDE[c.code] || "debit";
                  const singleMapping = !isStatutoryEmployer && !isEPFEmployee
                    ? sides?.get(suggestedSide)
                    : undefined;

                  const isMapped = isStatutoryEmployer
                    ? !!(sides?.get("debit")?.account_id && sides?.get("credit")?.account_id)
                    : isEPFEmployee
                      ? !!sides?.get("credit")?.account_id
                      : !!singleMapping?.account_id;

                  return (
                    <TableRow key={c.code}>
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{c.code}</div>
                      </TableCell>

                      {/* Side column — fixed badge for statutory, selector for others */}
                      <TableCell>
                        {isStatutoryEmployer ? (
                          <Badge variant="outline" className="font-mono text-xs whitespace-nowrap">Dr + Cr</Badge>
                        ) : isEPFEmployee ? (
                          <Badge variant="outline" className="font-mono text-xs">Cr</Badge>
                        ) : (
                          <Select
                            value={singleMapping?.posting_side || suggestedSide}
                            onValueChange={(v) =>
                              upsert.mutate({
                                id: singleMapping?.id,
                                component_code: c.code,
                                posting_side: v as "debit" | "credit",
                                account_id: singleMapping?.account_id || "",
                              })
                            }
                            disabled={!singleMapping?.account_id}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="debit">Debit</SelectItem>
                              <SelectItem value="credit">Credit</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>

                      {/* GL Account column */}
                      <TableCell>
                        {isStatutoryEmployer ? (
                          <div className="space-y-2">
                            {/* Expense account — debit side */}
                            <div className="flex items-end gap-1">
                              <div className="flex-1">
                                <p className="text-xs text-muted-foreground mb-1">Expense Account (Dr)</p>
                                <Select
                                  value={sides?.get("debit")?.account_id || ""}
                                  onValueChange={(v) =>
                                    upsert.mutate({
                                      id: sides?.get("debit")?.id,
                                      component_code: c.code,
                                      posting_side: "debit",
                                      account_id: v,
                                    })
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select expense account…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {expenseAccountOptions.map((a: any) => (
                                      <SelectItem key={a.id} value={a.id}>
                                        {a.account_code} — {a.account_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              {sides?.get("debit")?.id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-8 flex-shrink-0"
                                  onClick={() => remove.mutate(sides.get("debit")!.id)}
                                  title="Remove expense mapping"
                                >
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              )}
                            </div>
                            {/* Liability payable account — credit side */}
                            <div className="flex items-end gap-1">
                              <div className="flex-1">
                                <p className="text-xs text-muted-foreground mb-1">Liability Payable (Cr)</p>
                                <Select
                                  value={sides?.get("credit")?.account_id || ""}
                                  onValueChange={(v) =>
                                    upsert.mutate({
                                      id: sides?.get("credit")?.id,
                                      component_code: c.code,
                                      posting_side: "credit",
                                      account_id: v,
                                    })
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select liability payable account…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {liabilityAccountOptions.map((a: any) => (
                                      <SelectItem key={a.id} value={a.id}>
                                        {a.account_code} — {a.account_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              {sides?.get("credit")?.id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-8 flex-shrink-0"
                                  onClick={() => remove.mutate(sides.get("credit")!.id)}
                                  title="Remove liability mapping"
                                >
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : isEPFEmployee ? (
                          <div className="flex items-end gap-1">
                            <div className="flex-1">
                              <p className="text-xs text-muted-foreground mb-1">Liability Account (Cr)</p>
                              <Select
                                value={sides?.get("credit")?.account_id || ""}
                                onValueChange={(v) =>
                                  upsert.mutate({
                                    id: sides?.get("credit")?.id,
                                    component_code: c.code,
                                    posting_side: "credit",
                                    account_id: v,
                                  })
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select liability account…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {liabilityAccountOptions.map((a: any) => (
                                    <SelectItem key={a.id} value={a.id}>
                                      {a.account_code} — {a.account_name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {sides?.get("credit")?.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-8 flex-shrink-0"
                                onClick={() => remove.mutate(sides.get("credit")!.id)}
                                title="Remove liability mapping"
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <Select
                            value={singleMapping?.account_id || ""}
                            onValueChange={(v) =>
                              upsert.mutate({
                                id: singleMapping?.id,
                                component_code: c.code,
                                posting_side: suggestedSide,
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
                        )}
                      </TableCell>

                      <TableCell>
                        {isMapped ? (
                          <Badge variant="secondary">Mapped</Badge>
                        ) : (
                          <Badge variant="outline">Unmapped</Badge>
                        )}
                      </TableCell>

                      {/* Delete column — statutory components have inline delete buttons above */}
                      <TableCell>
                        {!STATUTORY_REMITTANCE.has(c.code) && singleMapping && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => remove.mutate(singleMapping.id)}
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
