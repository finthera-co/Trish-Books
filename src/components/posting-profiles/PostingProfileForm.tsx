import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import AccountSelector from "@/components/shared/AccountSelector";
import {
  MODULES, TRANSACTION_TYPES_BY_MODULE, ACCOUNT_ROLES,
  ACCOUNT_ROLE_LABELS, ROLE_ACCOUNT_TYPES, TRANSACTION_TYPE_LABELS,
  MODULE_LABELS,
  type PostingProfile, type Module, type AccountRole,
} from "@/hooks/usePostingProfiles";
import { useCustomers } from "@/hooks/useData";
import { useVendors } from "@/hooks/useSubledger";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (profile: Omit<PostingProfile, "id" | "accounts" | "created_at" | "updated_at">) => Promise<void>;
  editProfile?: PostingProfile | null;
  isPending?: boolean;
  defaultModule?: Module;
}

type ScopeType = "all" | "customer" | "vendor";

function parseScopeType(scope: Record<string, string> | null): ScopeType {
  if (!scope) return "all";
  if (scope.customer_id) return "customer";
  if (scope.vendor_id) return "vendor";
  return "all";
}

function parseScopeEntityId(scope: Record<string, string> | null): string {
  if (!scope) return "";
  return scope.customer_id || scope.vendor_id || "";
}

export default function PostingProfileForm({
  open, onOpenChange, onSubmit, editProfile, isPending, defaultModule,
}: Props) {
  const [module, setModule]               = useState<Module>(defaultModule ?? "AR");
  const [txnType, setTxnType]             = useState("");
  const [role, setRole]                   = useState<AccountRole>("CONTROL_DEBIT");
  const [glAccountId, setGlAccountId]     = useState<string | null>(null);
  const [scopeType, setScopeType]         = useState<ScopeType>("all");
  const [entityId, setEntityId]           = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split("T")[0]);
  const [effectiveTo, setEffectiveTo]     = useState("");
  const [priority, setPriority]           = useState(100);
  const [description, setDescription]     = useState("");
  const [isActive, setIsActive]           = useState(true);

  const { data: customers } = useCustomers();
  const { data: vendors }   = useVendors();

  // Populate form when editing
  useEffect(() => {
    if (editProfile) {
      setModule(editProfile.module as Module);
      setTxnType(editProfile.transaction_type);
      setRole(editProfile.account_role as AccountRole);
      setGlAccountId(editProfile.gl_account_id);
      setScopeType(parseScopeType(editProfile.entity_scope));
      setEntityId(parseScopeEntityId(editProfile.entity_scope));
      setEffectiveFrom(editProfile.effective_from);
      setEffectiveTo(editProfile.effective_to ?? "");
      setPriority(editProfile.priority);
      setDescription(editProfile.description ?? "");
      setIsActive(editProfile.is_active);
    } else {
      setModule(defaultModule ?? "AR");
      setTxnType(TRANSACTION_TYPES_BY_MODULE[defaultModule ?? "AR"][0] ?? "");
      setRole("CONTROL_DEBIT");
      setGlAccountId(null);
      setScopeType("all");
      setEntityId("");
      setEffectiveFrom(new Date().toISOString().split("T")[0]);
      setEffectiveTo("");
      setPriority(100);
      setDescription("");
      setIsActive(true);
    }
  }, [editProfile, open, defaultModule]);

  // Reset txnType when module changes
  useEffect(() => {
    const types = TRANSACTION_TYPES_BY_MODULE[module];
    if (!types.includes(txnType)) setTxnType(types[0] ?? "");
  }, [module]);

  const buildEntityScope = (): Record<string, string> | null => {
    if (scopeType === "all" || !entityId) return null;
    if (scopeType === "customer") return { customer_id: entityId };
    if (scopeType === "vendor")   return { vendor_id: entityId };
    return null;
  };

  const handleSubmit = async () => {
    if (!glAccountId || !txnType) return;
    await onSubmit({
      module,
      transaction_type: txnType,
      account_role:     role,
      gl_account_id:    glAccountId,
      entity_scope:     buildEntityScope(),
      effective_from:   effectiveFrom,
      effective_to:     effectiveTo || null,
      priority,
      description:      description || null,
      is_active:        isActive,
      tenant_id:        "",  // injected by the hook
    } as any);
    onOpenChange(false);
  };

  const inputClass =
    "mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground " +
    "focus:outline-none focus:ring-2 focus:ring-ring/20";

  const txnTypes = TRANSACTION_TYPES_BY_MODULE[module];
  const suggestedTypes = ROLE_ACCOUNT_TYPES[role] ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editProfile ? "Edit Posting Profile" : "Add Posting Profile"}</DialogTitle>
          <DialogDescription>
            Map a GL account to a specific sub-ledger event and account role.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Module + Transaction Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Module <span className="text-destructive">*</span></Label>
              <select
                value={module}
                onChange={(e) => setModule(e.target.value as Module)}
                disabled={!!editProfile}
                className={inputClass}
              >
                {MODULES.map((m) => (
                  <option key={m} value={m}>{MODULE_LABELS[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-sm font-medium">Transaction Type <span className="text-destructive">*</span></Label>
              <select
                value={txnType}
                onChange={(e) => setTxnType(e.target.value)}
                className={inputClass}
              >
                {txnTypes.map((t) => (
                  <option key={t} value={t}>{TRANSACTION_TYPE_LABELS[t] ?? t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Account Role */}
          <div>
            <Label className="text-sm font-medium">Account Role <span className="text-destructive">*</span></Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              What role this account plays in the generated journal entry
            </p>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AccountRole)}
              className={inputClass}
            >
              {ACCOUNT_ROLES.map((r) => (
                <option key={r} value={r}>{r} — {ACCOUNT_ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          {/* GL Account */}
          <div>
            <Label className="text-sm font-medium">GL Account <span className="text-destructive">*</span></Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              Suggested types: {suggestedTypes.join(", ")}
            </p>
            <AccountSelector
              value={glAccountId}
              onChange={(id) => setGlAccountId(id)}
              types={suggestedTypes}
              placeholder="Search accounts…"
            />
          </div>

          {/* Entity Scope */}
          <div>
            <Label className="text-sm font-medium">Scope</Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              Limit this profile to a specific entity, or leave as org-wide default
            </p>
            <div className="flex gap-2">
              <select
                value={scopeType}
                onChange={(e) => { setScopeType(e.target.value as ScopeType); setEntityId(""); }}
                className={`${inputClass} flex-shrink-0 w-36`}
              >
                <option value="all">All (default)</option>
                <option value="customer">Customer</option>
                <option value="vendor">Vendor</option>
              </select>

              {scopeType === "customer" && (
                <select
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  className={`${inputClass} flex-1`}
                >
                  <option value="">— Select customer —</option>
                  {(customers ?? []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}

              {scopeType === "vendor" && (
                <select
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  className={`${inputClass} flex-1`}
                >
                  <option value="">— Select vendor —</option>
                  {(vendors ?? []).map((v: any) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Effective Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Effective From <span className="text-destructive">*</span></Label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Effective To</Label>
              <input
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                min={effectiveFrom}
                className={inputClass}
              />
            </div>
          </div>

          {/* Priority + Active */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <Label className="text-sm font-medium">Priority</Label>
              <p className="text-[11px] text-muted-foreground mb-1">Lower wins (1 = highest)</p>
              <input
                type="number"
                min={1}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className={inputClass}
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                id="pp-is-active"
              />
              <Label htmlFor="pp-is-active">Active</Label>
            </div>
          </div>

          {/* Description */}
          <div>
            <Label className="text-sm font-medium">Description (optional)</Label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. AR control account for all standard invoices"
              className={inputClass}
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!glAccountId || !txnType || isPending}
            className="w-full"
          >
            {isPending ? "Saving…" : editProfile ? "Update Profile" : "Create Profile"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
