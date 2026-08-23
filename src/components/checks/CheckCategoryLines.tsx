import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import AccountSelector from "@/components/shared/AccountSelector";
import type { VoucherLine } from "@/hooks/usePaymentVouchers";

const LINE_ACCOUNT_TYPES = ["Expense", "Cost of Goods Sold", "Other Expense", "Liability"];

interface Customer { id: string; name: string }
interface CostCenter { id: string; name: string }

interface Props {
  disabled: boolean;
  lines: VoucherLine[];
  onChange: (lines: VoucherLine[]) => void;
  paymentAccountId: string;
  customers: Customer[];
  classTrackingEnabled: boolean;
  costCenters: CostCenter[];
  errors: Record<string, string>;
}

export default function CheckCategoryLines({
  disabled, lines, onChange, paymentAccountId, customers, classTrackingEnabled, costCenters, errors,
}: Props) {
  const updateLine = (idx: number, patch: Partial<VoucherLine>) => {
    onChange(
      lines.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        if ("customer_id" in patch && !patch.customer_id) next.is_billable = false;
        return next;
      })
    );
  };

  const addLines = (count = 1) => {
    const blank: VoucherLine = { account_id: "", description: "", amount: 0, customer_id: null, is_billable: false, cost_center_id: null, is_taxable: false };
    onChange([...lines, ...Array.from({ length: count }, () => ({ ...blank }))]);
  };

  const duplicateLine = (idx: number) => {
    onChange([...lines.slice(0, idx + 1), { ...lines[idx], id: undefined }, ...lines.slice(idx + 1)]);
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    onChange(lines.filter((_, i) => i !== idx));
  };

  const clearAll = () => {
    const hasData = lines.some((l) => l.account_id || l.amount || l.description);
    if (hasData && !window.confirm("Clear all lines? This cannot be undone.")) return;
    onChange([{ account_id: "", description: "", amount: 0, customer_id: null, is_billable: false, cost_center_id: null, is_taxable: false }]);
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b">
        <span className="font-semibold text-sm">Category details</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="min-w-[180px]">Category</TableHead>
              <TableHead className="min-w-[160px]">Description</TableHead>
              <TableHead className="min-w-[110px] text-right">Amount</TableHead>
              <TableHead className="w-16 text-center">Billable</TableHead>
              <TableHead className="w-14 text-center">Tax</TableHead>
              <TableHead className="min-w-[150px]">Customer / Project</TableHead>
              {classTrackingEnabled && <TableHead className="min-w-[110px]">Class</TableHead>}
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, idx) => {
              const accErr = errors[`line-${idx}-account`];
              const amtErr = errors[`line-${idx}-amount`];
              return (
                <TableRow key={idx} className={accErr || amtErr ? "bg-destructive/5" : undefined}>
                  <TableCell className="text-center text-muted-foreground">
                    {idx === 0 ? (
                      <button
                        type="button"
                        onClick={() => addLines(1)}
                        disabled={disabled}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary text-primary hover:bg-primary/10"
                        title="Add line"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    ) : (
                      <GripVertical className="h-4 w-4 mx-auto opacity-40" />
                    )}
                  </TableCell>
                  <TableCell>
                    <AccountSelector
                      value={line.account_id}
                      onChange={(v) => updateLine(idx, { account_id: v })}
                      types={LINE_ACCOUNT_TYPES}
                      placeholder="Search account…"
                      disabled={disabled}
                    />
                    {accErr && <p className="text-xs text-destructive mt-1">{accErr}</p>}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.description}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                      placeholder="Description"
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="text-right"
                      value={line.amount || ""}
                      onChange={(e) => updateLine(idx, { amount: parseFloat(e.target.value) || 0 })}
                      disabled={disabled}
                    />
                    {amtErr && <p className="text-xs text-destructive mt-1">{amtErr}</p>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={line.is_billable || false}
                      onCheckedChange={(v) => updateLine(idx, { is_billable: !!v })}
                      disabled={disabled || !line.customer_id}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={line.is_taxable || false}
                      onCheckedChange={(v) => updateLine(idx, { is_taxable: !!v })}
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={line.customer_id || "__none__"}
                      onValueChange={(v) => updateLine(idx, { customer_id: v === "__none__" ? null : v })}
                      disabled={disabled}
                    >
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  {classTrackingEnabled && (
                    <TableCell>
                      <Select
                        value={line.cost_center_id || "__none__"}
                        onValueChange={(v) => updateLine(idx, { cost_center_id: v === "__none__" ? null : v })}
                        disabled={disabled}
                      >
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {costCenters.map((cc) => (
                            <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => duplicateLine(idx)} disabled={disabled} title="Copy line">
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} disabled={lines.length <= 1 || disabled} title="Delete line">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex gap-2 px-4 py-3 border-t">
        <Button variant="outline" size="sm" onClick={() => addLines(4)} disabled={disabled}>Add lines</Button>
        <Button variant="outline" size="sm" onClick={clearAll} disabled={disabled}>Clear all lines</Button>
      </div>
    </div>
  );
}
