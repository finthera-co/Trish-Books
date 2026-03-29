import { useState, useMemo } from "react";
import { Plus, Trash2, AlertCircle, Users, Package, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import {
  useOpeningBalanceDetails,
  useSaveOpeningBalanceDetail,
  useDeleteOpeningBalanceDetail,
  getSubledgerType,
} from "@/hooks/useSubledger";
import { useCustomers } from "@/hooks/useData";
import { useVendors, useInventoryItems, useFixedAssets } from "@/hooks/useSubledger";

interface OBSubledgerBreakdownProps {
  accountId: string;
  accountSubtype: string | null | undefined;
  controlTotal: number;
  onValidChange?: (isValid: boolean) => void;
}

const ENTITY_LABELS: Record<string, { label: string; icon: typeof Users }> = {
  customer: { label: "Customer", icon: Users },
  vendor: { label: "Vendor", icon: Users },
  inventory_item: { label: "Item", icon: Package },
  fixed_asset: { label: "Asset", icon: Building2 },
};

export default function OBSubledgerBreakdown({
  accountId,
  accountSubtype,
  controlTotal,
  onValidChange,
}: OBSubledgerBreakdownProps) {
  const entityType = getSubledgerType(accountSubtype);

  if (!entityType) return null;

  const meta = ENTITY_LABELS[entityType] || { label: "Entity", icon: Users };
  const Icon = meta.icon;

  return (
    <div className="mt-3 border border-primary/20 rounded-lg p-4 bg-primary/5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">
          Sub-ledger breakdown required
        </span>
        <span className="text-xs text-muted-foreground">
          — Total must equal {formatCurrency(Math.abs(controlTotal))}
        </span>
      </div>
      <SubledgerTable
        accountId={accountId}
        entityType={entityType}
        controlTotal={Math.abs(controlTotal)}
        entityLabel={meta.label}
        onValidChange={onValidChange}
      />
    </div>
  );
}

function SubledgerTable({
  accountId,
  entityType,
  controlTotal,
  entityLabel,
  onValidChange,
}: {
  accountId: string;
  entityType: string;
  controlTotal: number;
  entityLabel: string;
  onValidChange?: (isValid: boolean) => void;
}) {
  const { data: details, isLoading } = useOpeningBalanceDetails(accountId);
  const saveMutation = useSaveOpeningBalanceDetail();
  const deleteMutation = useDeleteOpeningBalanceDetail();

  const { data: customers } = useCustomers();
  const { data: vendors } = useVendors();
  const { data: inventoryItems } = useInventoryItems();
  const { data: fixedAssets } = useFixedAssets();

  const entityOptions = useMemo(() => {
    switch (entityType) {
      case "customer":
        return (customers || []).map((c: any) => ({ id: c.id, name: c.name }));
      case "vendor":
        return (vendors || []).map((v: any) => ({ id: v.id, name: v.name }));
      case "inventory_item":
        return (inventoryItems || []).map((i: any) => ({ id: i.id, name: i.item_name }));
      case "fixed_asset":
        return (fixedAssets || []).map((a: any) => ({ id: a.id, name: a.asset_name }));
      default:
        return [];
    }
  }, [entityType, customers, vendors, inventoryItems, fixedAssets]);

  const [newEntityId, setNewEntityId] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const detailTotal = useMemo(
    () => (details || []).reduce((sum: number, d: any) => sum + Number(d.amount), 0),
    [details]
  );

  const difference = controlTotal - detailTotal;
  const isBalanced = Math.abs(difference) < 0.005;

  // Notify parent of validity
  useMemo(() => {
    const hasDetails = (details || []).length > 0;
    onValidChange?.(isBalanced && hasDetails);
  }, [isBalanced, details, onValidChange]);

  const availableEntities = useMemo(() => {
    const usedIds = new Set((details || []).map((d: any) => d.entity_id));
    return entityOptions.filter((e) => !usedIds.has(e.id));
  }, [entityOptions, details]);

  const handleAdd = () => {
    if (!newEntityId || !newAmount) return;
    saveMutation.mutate({
      account_id: accountId,
      entity_type: entityType,
      entity_id: newEntityId,
      amount: parseFloat(newAmount) || 0,
    });
    setNewEntityId("");
    setNewAmount("");
  };

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-2">
      {/* Existing details */}
      {(details || []).map((d: any) => {
        const entity = entityOptions.find((e) => e.id === d.entity_id);
        return (
          <div
            key={d.id}
            className="flex items-center gap-2 text-sm bg-background rounded px-3 py-2 border border-border/50"
          >
            <span className="flex-1 text-foreground font-medium">
              {entity?.name || d.entity_id.slice(0, 8)}
            </span>
            <span className="font-mono text-foreground">
              {formatCurrency(d.amount)}
            </span>
            <button
              onClick={() => deleteMutation.mutate({ id: d.id, accountId })}
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      {/* Add new row */}
      <div className="flex items-center gap-2">
        <select
          value={newEntityId}
          onChange={(e) => setNewEntityId(e.target.value)}
          className="flex-1 h-8 text-sm border border-input rounded-md px-2 bg-background"
        >
          <option value="">Select {entityLabel}…</option>
          {availableEntities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          placeholder="Amount"
          className="w-28 h-8 text-sm border border-input rounded-md px-2 bg-background text-right"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={handleAdd}
          disabled={!newEntityId || !newAmount || saveMutation.isPending}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Totals & validation */}
      <div className="flex items-center justify-between text-xs pt-2 border-t border-border/50">
        <span className="text-muted-foreground">
          Sub-total: <span className="font-mono font-medium text-foreground">{formatCurrency(detailTotal)}</span>
        </span>
        <span
          className={`inline-flex items-center gap-1 font-medium ${
            isBalanced ? "text-success" : "text-destructive"
          }`}
        >
          {isBalanced ? (
            "✓ Balanced"
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5" />
              Diff: {formatCurrency(Math.abs(difference))}
            </>
          )}
        </span>
      </div>

      {availableEntities.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No more {entityLabel.toLowerCase()}s available. Create new ones in the {entityLabel}s page first.
        </p>
      )}
    </div>
  );
}
