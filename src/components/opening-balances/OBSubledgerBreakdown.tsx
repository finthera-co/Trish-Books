import { useState, useMemo, useEffect } from "react";
import { Plus, Trash2, AlertCircle, Users, Package, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import {
  useOpeningBalanceDetails,
  useSaveOpeningBalanceDetail,
  useDeleteOpeningBalanceDetail,
  useCreateMigratedAsset,
  getSubledgerType,
} from "@/hooks/useSubledger";
import { useCustomers, useActiveAccounts } from "@/hooks/useData";
import { useVendors, useInventoryItems, useFixedAssets } from "@/hooks/useSubledger";
import { useAssetCategories } from "@/hooks/useAssetCategories";

interface OBSubledgerBreakdownProps {
  accountId: string;
  accountSubtype: string | null | undefined;
  controlTotal: number;
  asOfDate?: string;
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
  asOfDate,
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
        asOfDate={asOfDate}
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
  asOfDate,
  onValidChange,
}: {
  accountId: string;
  entityType: string;
  controlTotal: number;
  entityLabel: string;
  asOfDate?: string;
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
    // Selecting an EXISTING entity (incl. a previously-migrated asset) only records
    // the allocation — it does NOT re-post any journal, so no double-posting.
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

      {/* Inline "create migrated asset" — fixed assets ONLY */}
      {entityType === "fixed_asset" && (
        <MigratedAssetCreator accountId={accountId} asOfDate={asOfDate} />
      )}

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

      {availableEntities.length === 0 && entityType !== "fixed_asset" && (
        <p className="text-xs text-muted-foreground italic">
          No more {entityLabel.toLowerCase()}s available. Create new ones in the {entityLabel}s page first.
        </p>
      )}
      {entityType === "fixed_asset" && availableEntities.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No existing assets to allocate. Use “+ New Asset (migrated)” above to add one — it captures
          cost and accumulated depreciation and posts only opening journals (no acquisition).
        </p>
      )}
    </div>
  );
}

/**
 * Inline form to create a MIGRATED fixed asset directly from the opening-balance
 * sub-ledger breakdown. Posts only opening journals (no acquisition) and records
 * the allocation so the asset appears against the control balance.
 */
function MigratedAssetCreator({
  accountId,
  asOfDate,
}: {
  accountId: string;
  asOfDate?: string;
}) {
  const createMigrated = useCreateMigratedAsset();
  const { data: categories } = useAssetCategories();
  const { data: accounts } = useActiveAccounts();

  const accumDepAccounts = useMemo(
    () =>
      (accounts || []).filter((a: any) =>
        (a.account_subtype || "").toLowerCase().includes("accumulated depreciation")
      ),
    [accounts]
  );

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [accumDep, setAccumDep] = useState("");
  const [lifeMonths, setLifeMonths] = useState("");
  const [salvage, setSalvage] = useState("");
  const [acqDate, setAcqDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accumDepAccountId, setAccumDepAccountId] = useState("");

  // Default the accum-dep account (and life) from the chosen category.
  useEffect(() => {
    if (!categoryId) return;
    const cat = (categories || []).find((c: any) => c.id === categoryId);
    if (!cat) return;
    if (cat.accumulated_depreciation_account_id) {
      setAccumDepAccountId(cat.accumulated_depreciation_account_id);
    }
    if (cat.default_useful_life_months && !lifeMonths) {
      setLifeMonths(String(cat.default_useful_life_months));
    }
  }, [categoryId, categories]);

  const reset = () => {
    setName("");
    setCost("");
    setAccumDep("");
    setLifeMonths("");
    setSalvage("");
    setAcqDate("");
    setCategoryId("");
    setAccumDepAccountId("");
    setOpen(false);
  };

  const costNum = parseFloat(cost) || 0;
  const accumNum = parseFloat(accumDep) || 0;
  const salvageNum = parseFloat(salvage) || 0;
  const lifeNum = parseInt(lifeMonths, 10) || 0;

  const canSave =
    !!name.trim() &&
    costNum > 0 &&
    lifeNum > 0 &&
    accumNum >= 0 &&
    accumNum <= costNum - salvageNum + 0.005 &&
    !!accumDepAccountId &&
    !!acqDate &&
    !createMigrated.isPending;

  const handleCreate = () => {
    if (!canSave) return;
    createMigrated.mutate(
      {
        account_id: accountId,
        asset_name: name.trim(),
        category_id: categoryId || undefined,
        accumulated_depreciation_account_id: accumDepAccountId,
        cost: costNum,
        opening_accum_dep: accumNum,
        salvage_value: salvageNum,
        useful_life_months: lifeNum,
        acquisition_date: acqDate,
        as_of_date: asOfDate || new Date().toISOString().slice(0, 10),
      },
      { onSuccess: () => reset() }
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> New Asset (migrated)
      </button>
    );
  }

  return (
    <div className="border border-primary/20 rounded-md p-3 bg-background space-y-2">
      <p className="text-xs font-semibold text-foreground">New migrated asset</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs text-muted-foreground space-y-1">
          Asset Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
            placeholder="e.g. Delivery Van"
          />
        </label>

        <label className="text-xs text-muted-foreground space-y-1">
          Cost (gross)
          <input
            type="number"
            min="0"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background text-right"
          />
        </label>

        <label className="text-xs text-muted-foreground space-y-1">
          Accumulated Depreciation
          <input
            type="number"
            min="0"
            step="0.01"
            value={accumDep}
            onChange={(e) => setAccumDep(e.target.value)}
            className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background text-right"
          />
        </label>

        <label className="text-xs text-muted-foreground space-y-1">
          Useful Life (months)
          <input
            type="number"
            min="1"
            step="1"
            value={lifeMonths}
            onChange={(e) => setLifeMonths(e.target.value)}
            className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background text-right"
          />
        </label>

        <label className="text-xs text-muted-foreground space-y-1">
          Salvage Value (optional)
          <input
            type="number"
            min="0"
            step="0.01"
            value={salvage}
            onChange={(e) => setSalvage(e.target.value)}
            className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background text-right"
          />
        </label>

        <label className="text-xs text-muted-foreground space-y-1">
          Original Acquisition Date
          <input
            type="date"
            value={acqDate}
            onChange={(e) => setAcqDate(e.target.value)}
            className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
          />
        </label>

        <label className="text-xs text-muted-foreground space-y-1">
          Category (optional)
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
          >
            <option value="">None</option>
            {(categories || []).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="col-span-2 text-xs text-muted-foreground space-y-1">
          Accumulated Depreciation Account
          <select
            value={accumDepAccountId}
            onChange={(e) => setAccumDepAccountId(e.target.value)}
            className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
          >
            <option value="">Select account…</option>
            {accumDepAccounts.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.account_code} — {a.account_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="h-8" onClick={handleCreate} disabled={!canSave}>
          {createMigrated.isPending ? "Posting…" : "Create & Allocate"}
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={reset} disabled={createMigrated.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
