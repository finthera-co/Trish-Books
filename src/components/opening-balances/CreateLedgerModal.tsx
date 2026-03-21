import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Plus } from "lucide-react";
import {
  ACCOUNT_TYPES,
  ACCOUNT_SUBTYPES,
  ACCOUNT_NUMBER_RANGES,
  getNormalBalance,
  getStatementPlacement,
  isOpeningBalanceEligible,
} from "@/lib/accountTypes";
import { generateAccountCode } from "@/lib/accountCodeGenerator";
import { useAccounts, useCreateAccount } from "@/hooks/useData";
import { useAccountCategories, useCreateAccountCategory } from "@/hooks/useAccountCategories";
import { toast } from "sonner";

interface CreateLedgerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after successful creation with the new account id and optional opening balance */
  onCreated: (accountId: string, openingBalance?: number, balanceType?: "debit" | "credit") => void;
}

export default function CreateLedgerModal({ open, onOpenChange, onCreated }: CreateLedgerModalProps) {
  const { data: allAccounts } = useAccounts();
  const { data: categories } = useAccountCategories();
  const createAccount = useCreateAccount();
  const createCategory = useCreateAccountCategory();

  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("Asset");
  const [accountSubtype, setAccountSubtype] = useState("");
  const [parentId, setParentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [balanceType, setBalanceType] = useState<"debit" | "credit">("debit");
  const [description, setDescription] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setAccountName("");
      setAccountType("Asset");
      setAccountSubtype("");
      setParentId("");
      setCategoryId("");
      setOpeningBalance(0);
      setBalanceType("debit");
      setDescription("");
      setShowNewCategory(false);
      setNewCategoryName("");
    }
  }, [open]);

  // Auto-set balance type based on normal balance
  useEffect(() => {
    setBalanceType(getNormalBalance(accountType) === "Debit" ? "debit" : "credit");
  }, [accountType]);

  const accountsForCodeGen = useMemo(() => {
    return (allAccounts || []).map((a: any) => ({
      id: a.id,
      account_code: a.account_code,
      account_type: a.account_type,
      parent_account_id: a.parent_account_id,
    }));
  }, [allAccounts]);

  const autoCode = useMemo(() => {
    return generateAccountCode(accountType, parentId || null, accountsForCodeGen);
  }, [accountType, parentId, accountsForCodeGen]);

  const filteredCategories = useMemo(() => {
    return (categories || []).filter(c => c.account_type === accountType);
  }, [categories, accountType]);

  const subtypes = ACCOUNT_SUBTYPES[accountType] || [];
  const numberRange = ACCOUNT_NUMBER_RANGES[accountType];

  const parentAccounts = useMemo(() => {
    return (allAccounts || []).filter((a: any) => a.account_type === accountType && a.is_active);
  }, [allAccounts, accountType]);

  const existingCodes = useMemo(() => {
    return new Set((allAccounts || []).map((a: any) => a.account_code));
  }, [allAccounts]);

  const isCodeDuplicate = existingCodes.has(autoCode);

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    try {
      const created = await createCategory.mutateAsync({ name: newCategoryName.trim(), account_type: accountType });
      if (created) setCategoryId(created.id);
      setNewCategoryName("");
      setShowNewCategory(false);
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleSubmit = async () => {
    if (!accountName.trim()) { toast.error("Account name is required"); return; }
    if (isCodeDuplicate) { toast.error("Account code conflict, try again"); return; }

    try {
      const result = await createAccount.mutateAsync({
        account_name: accountName.trim(),
        account_code: autoCode,
        account_type: accountType,
        account_subtype: accountSubtype || undefined,
        parent_account_id: parentId || undefined,
        category_id: categoryId || undefined,
      });

      onCreated(
        result.id,
        openingBalance > 0 ? openingBalance : undefined,
        openingBalance > 0 ? balanceType : undefined
      );
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    }
  };

  const inputClass = "mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Ledger Account</DialogTitle>
          <DialogDescription>
            Create a new account and add it directly to your opening balance entry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Account Type */}
          <div>
            <label className="text-sm font-medium">Account Type <span className="text-destructive">*</span></label>
            <select
              value={accountType}
              onChange={(e) => {
                setAccountType(e.target.value);
                setAccountSubtype("");
                setCategoryId("");
                setParentId("");
                setShowNewCategory(false);
              }}
              className={inputClass}
            >
              {ACCOUNT_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium">Category <span className="text-destructive">*</span></label>
            {!showNewCategory ? (
              <div className="flex gap-2">
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputClass} flex-1`}>
                  <option value="">— Select category —</option>
                  {filteredCategories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" className="mt-1 shrink-0" onClick={() => setShowNewCategory(true)}>
                  <Plus className="h-4 w-4 mr-1" /> New
                </Button>
              </div>
            ) : (
              <div className="flex gap-2 mt-1">
                <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)}
                  className={`${inputClass} flex-1 !mt-0`} placeholder={`e.g. Current ${accountType}s`} autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleAddCategory()} />
                <Button type="button" size="sm" disabled={!newCategoryName.trim() || creatingCategory} onClick={handleAddCategory}>
                  {creatingCategory ? "..." : "Add"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNewCategory(false); setNewCategoryName(""); }}>Cancel</Button>
              </div>
            )}
          </div>

          {/* Detail Type */}
          <div>
            <label className="text-sm font-medium">Detail Type</label>
            <select value={accountSubtype} onChange={(e) => setAccountSubtype(e.target.value)} className={inputClass}>
              <option value="">— Select detail type —</option>
              {subtypes.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Account Number */}
            <div>
              <label className="text-sm font-medium flex items-center gap-1">
                Account Number <Lock className="w-3 h-3 text-muted-foreground" />
              </label>
              <input type="text" value={autoCode} readOnly
                className={`${inputClass} bg-muted/50 cursor-not-allowed ${isCodeDuplicate ? "!border-destructive" : ""}`}
                placeholder={numberRange ? `${numberRange.min}–${numberRange.max}` : ""} />
              <p className="text-[10px] text-muted-foreground mt-1">Auto-generated</p>
            </div>
            {/* Account Name */}
            <div>
              <label className="text-sm font-medium">Account Name <span className="text-destructive">*</span></label>
              <input type="text" value={accountName} onChange={(e) => setAccountName(e.target.value)}
                className={inputClass} placeholder="e.g. Cash on Hand" />
            </div>
          </div>

          {/* Parent Account */}
          <div>
            <label className="text-sm font-medium">Parent Account (optional)</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputClass}>
              <option value="">None (top-level)</option>
              {parentAccounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </div>

          {/* Opening Balance (only for eligible types) */}
          {isOpeningBalanceEligible(accountType) && (
            <div>
              <label className="text-sm font-medium">Opening Balance (optional)</label>
              <div className="flex gap-2 mt-1">
                <input type="number" min="0" step="0.01" value={openingBalance || ""}
                  onChange={(e) => setOpeningBalance(parseFloat(e.target.value) || 0)}
                  className={`${inputClass} flex-1 !mt-0`} placeholder="0.00" />
                <select value={balanceType} onChange={(e) => setBalanceType(e.target.value as "debit" | "credit")}
                  className={`${inputClass} w-28 !mt-0`}>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Will be auto-filled into the OBE line
              </p>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="text-sm font-medium">Description (optional)</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className={inputClass} placeholder="Optional description" />
          </div>

          {/* Info panel */}
          <div className="bg-muted/50 rounded-lg px-3 py-2.5 text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Normal balance:</span>
              <strong className="text-foreground">{getNormalBalance(accountType)}</strong>
            </div>
            <div className="flex justify-between">
              <span>Financial statement:</span>
              <strong className="text-foreground">{getStatementPlacement(accountType)}</strong>
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={!accountName.trim() || !autoCode || isCodeDuplicate || createAccount.isPending} className="w-full">
            {createAccount.isPending ? "Creating..." : "Create & Add to OBE"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
