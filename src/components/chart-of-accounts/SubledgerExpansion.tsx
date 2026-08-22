import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Users, Building2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import {
  useOpeningBalanceDetails,
  useSaveOpeningBalanceDetail,
  useDeleteOpeningBalanceDetail,
  getSubledgerType,
} from "@/hooks/useSubledger";
import { useCustomers } from "@/hooks/useData";
import { useVendors, useFixedAssets } from "@/hooks/useSubledger";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SubledgerExpansionProps {
  accountId: string;
  accountSubtype: string | null | undefined;
  controlTotal: number;
  isLocked: boolean;
}

const ENTITY_LABELS: Record<string, { label: string; icon: typeof Users }> = {
  customer: { label: "Customer", icon: Users },
  vendor: { label: "Vendor", icon: Users },
  fixed_asset: { label: "Asset", icon: Building2 },
};

export default function SubledgerExpansion({
  accountId,
  accountSubtype,
  controlTotal,
  isLocked,
}: SubledgerExpansionProps) {
  const entityType = getSubledgerType(accountSubtype);
  const [expanded, setExpanded] = useState(false);

  if (!entityType) return null;

  const meta = ENTITY_LABELS[entityType] || { label: "Entity", icon: Users };
  const Icon = meta.icon;

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 font-medium"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Icon className="w-3 h-3" />
        Sub-ledger breakdown required
      </button>
      {expanded && (
        <SubledgerTable
          accountId={accountId}
          entityType={entityType}
          controlTotal={controlTotal}
          isLocked={isLocked}
          entityLabel={meta.label}
        />
      )}
    </div>
  );
}

function SubledgerTable({
  accountId,
  entityType,
  controlTotal,
  isLocked,
  entityLabel,
}: {
  accountId: string;
  entityType: string;
  controlTotal: number;
  isLocked: boolean;
  entityLabel: string;
}) {
  const { data: details, isLoading } = useOpeningBalanceDetails(accountId);
  const saveMutation = useSaveOpeningBalanceDetail();
  const deleteMutation = useDeleteOpeningBalanceDetail();

  // Load entity options based on type
  const { data: customers } = useCustomers();
  const { data: vendors } = useVendors();
  const { data: fixedAssets } = useFixedAssets();

  const entityOptions = useMemo(() => {
    switch (entityType) {
      case "customer":
        return (customers || []).map((c: any) => ({ id: c.id, name: c.name }));
      case "vendor":
        return (vendors || []).map((v: any) => ({ id: v.id, name: v.name }));
      case "fixed_asset":
        return (fixedAssets || []).map((a: any) => ({ id: a.id, name: a.asset_name }));
      default:
        return [];
    }
  }, [entityType, customers, vendors, fixedAssets]);

  const [newEntityId, setNewEntityId] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const detailTotal = useMemo(
    () => (details || []).reduce((sum: number, d: any) => sum + Number(d.amount), 0),
    [details]
  );

  const difference = controlTotal - detailTotal;
  const isBalanced = Math.abs(difference) < 0.005;

  // Filter out already-used entities
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
    return (
      <div className="ml-4 mt-1 text-xs text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="ml-4 mt-2 space-y-2 border-l-2 border-primary/20 pl-3">
      {/* Existing details */}
      {(details || []).map((d: any) => {
        const entity = entityOptions.find((e) => e.id === d.entity_id);
        return (
          <div
            key={d.id}
            className="flex items-center gap-2 text-xs bg-muted/20 rounded px-2 py-1.5"
          >
            <span className="flex-1 text-foreground/80 font-medium">
              {entity?.name || d.entity_id.slice(0, 8)}
            </span>
            <span className="font-mono text-foreground">
              {formatCurrency(d.amount)}
            </span>
            {!isLocked && (
              <button
                onClick={() => deleteMutation.mutate({ id: d.id, accountId })}
                className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}

      {/* Add new row */}
      {!isLocked && (
        <div className="flex items-center gap-2">
          <select
            value={newEntityId}
            onChange={(e) => setNewEntityId(e.target.value)}
            className="flex-1 h-7 text-xs border border-input rounded px-2 bg-background"
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
            className="w-24 h-7 text-xs border border-input rounded px-2 bg-background text-right"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={handleAdd}
            disabled={!newEntityId || !newAmount || saveMutation.isPending}
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Totals & validation */}
      <div className="flex items-center justify-between text-[10px] pt-1 border-t border-border/50">
        <span className="text-muted-foreground">
          Sub-total: <span className="font-mono font-medium text-foreground">{formatCurrency(detailTotal)}</span>
        </span>
        {controlTotal > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    isBalanced ? "text-success" : "text-destructive"
                  }`}
                >
                  {isBalanced ? (
                    "✓ Balanced"
                  ) : (
                    <>
                      <AlertCircle className="w-3 h-3" />
                      Diff: {formatCurrency(Math.abs(difference))}
                    </>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">
                {isBalanced
                  ? "Sub-ledger total matches the control account balance."
                  : `Sub-ledger total (${formatCurrency(detailTotal)}) must equal control account balance (${formatCurrency(controlTotal)}).`}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {availableEntities.length === 0 && !isLocked && (
        <p className="text-[10px] text-muted-foreground italic">
          No more {entityLabel.toLowerCase()}s available. Create new ones first.
        </p>
      )}
    </div>
  );
}
