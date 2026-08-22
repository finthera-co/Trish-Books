import { useState, useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useAccounts, useCreateAccount, useNextAccountCode } from "@/hooks/useData";
import { ACCOUNT_TYPES, ACCOUNT_SUBTYPES, getSubtypesForType } from "@/lib/accountTypes";
import { toast } from "sonner";

interface QuickAddAccountProps {
  /** Smart default account type for this mapping role, e.g. "Asset". Editable by the user. */
  accountType: string;
  /** Optional subtype override; if omitted, auto-suggested from the generated code. */
  defaultSubtype?: string;
  /** Pre-filled, editable account name. */
  defaultName?: string;
  /** Fired after a successful create with the new account id. */
  onCreated: (accountId: string) => void;
  disabled?: boolean;
}

/**
 * QuickAddAccount — compact "New" button + dialog that creates a GL account
 * pre-configured for a specific Account Mapping role, then auto-selects it.
 * Type is pre-filled but editable; detail type and code follow the chosen type.
 * Reuses useCreateAccount so audit log, control flags, and cache invalidation are inherited.
 */
export default function QuickAddAccount({
  accountType,
  defaultSubtype,
  defaultName = "",
  onCreated,
  disabled,
}: QuickAddAccountProps) {
  const { data: allAccounts, refetch: refetchAccounts } = useAccounts();
  const createAccount = useCreateAccount();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState(accountType);
  const [subtype, setSubtype] = useState("");

  // Auto-generated, top-level code inside the sub-band for the CURRENT type +
  // subtype — server-generated via next_account_code(), the single source of
  // truth for account numbering (see src/lib/accountCodeGenerator.ts header).
  const { data: autoCode = "" } = useNextAccountCode(type, null, subtype || null, open);

  const existingCodes = useMemo(
    () => new Set(
      (allAccounts || [])
        .map((a: { account_code: string | number }) => String(a.account_code).trim())
    ),
    [allAccounts]
  );

  // Built-in detail types plus any custom ones already used in this chart
  // (added from the full Chart of Accounts form).
  const subtypeOptions = useMemo(
    () => getSubtypesForType(type, (allAccounts || []) as { account_type: string; account_subtype?: string | null }[]),
    [type, allAccounts]
  );
  const isCodeDuplicate = existingCodes.has(String(autoCode).trim());

  // Reset to smart defaults each time the dialog opens.
  // Subtype drives the code via the autoCode memo, so resolve it directly here.
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setType(accountType);
    setSubtype(
      defaultSubtype ||
      (ACCOUNT_SUBTYPES[accountType] || [])[0] ||
      ""
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultName, defaultSubtype, accountType]);

  // When the user changes the type, pick that type's first subtype.
  // The autoCode memo then recomputes the code into the matching band.
  const handleTypeChange = (newType: string) => {
    setType(newType);
    setSubtype((ACCOUNT_SUBTYPES[newType] || [])[0] || "");
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Account name is required");
      return;
    }
    // Re-validate against the freshest account list to avoid a stale-cache duplicate.
    let codes = existingCodes;
    try {
      const fresh = await refetchAccounts();
      if (fresh.data) {
        codes = new Set(fresh.data.map((a: { account_code: string | number }) => String(a.account_code).trim()));
      }
    } catch {
      /* fall back to cached codes if refetch fails */
    }
    if (codes.has(String(autoCode).trim())) {
      toast.error(`Account code ${autoCode} already exists. Pick a different type or detail type.`);
      return;
    }
    try {
      const result = await createAccount.mutateAsync({
        account_name: name.trim(),
        account_code: autoCode,
        account_type: type,
        account_subtype: subtype || undefined,
        created_from: "ACCOUNT_MAPPING",
      });
      onCreated(result.id);
      setOpen(false);
    } catch {
      /* error toast handled by useCreateAccount */
    }
  };

  const inputClass =
    "mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="flex-shrink-0 gap-1 h-9"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus className="w-3.5 h-3.5" />
        New
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quick Add Account</DialogTitle>
            <DialogDescription>
              Creates a new account and selects it for this mapping. The type is pre-filled
              for this role — change it if you need something different.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-sm font-medium">Account Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Accounts Receivable"
                className="mt-1"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium">Type</Label>
                <select
                  value={type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className={inputClass}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-sm font-medium">Code</Label>
                <Input
                  value={autoCode}
                  readOnly
                  className="mt-1 bg-muted/40 text-muted-foreground"
                />
                {isCodeDuplicate && (
                  <p className="text-xs text-destructive mt-1">Code already in use</p>
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">Detail Type</Label>
              <select
                value={subtype}
                onChange={(e) => setSubtype(e.target.value)}
                className={inputClass}
              >
                {subtypeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createAccount.isPending || isCodeDuplicate}>
              {createAccount.isPending ? "Creating…" : "Create & Select"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
