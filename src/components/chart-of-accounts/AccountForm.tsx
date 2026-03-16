import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AccountCategory } from "@/hooks/useAccountCategories";
import { Plus } from "lucide-react";
import {
  ACCOUNT_TYPES,
  ACCOUNT_SUBTYPES,
  ACCOUNT_NUMBER_RANGES,
  getNormalBalance,
  getStatementPlacement,
} from "@/lib/accountTypes";

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype?: string | null;
  parent_account_id: string | null;
  category_id: string | null;
  is_active: boolean;
}

interface AccountFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    account_name: string;
    account_code: string;
    account_type: string;
    account_subtype?: string;
    parent_account_id?: string;
    category_id?: string;
  }) => Promise<void>;
  accounts: Account[];
  categories: AccountCategory[];
  isPending: boolean;
  editAccount?: Account | null;
  onCreateCategory?: (data: { name: string; account_type: string }) => Promise<AccountCategory | undefined>;
}

export default function AccountForm({
  open,
  onOpenChange,
  onSubmit,
  accounts,
  categories,
  isPending,
  editAccount,
  onCreateCategory,
}: AccountFormProps) {
  const [accountName, setAccountName] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [accountType, setAccountType] = useState("Asset");
  const [accountSubtype, setAccountSubtype] = useState("");
  const [parentId, setParentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  useEffect(() => {
    if (editAccount) {
      setAccountName(editAccount.account_name);
      setAccountCode(editAccount.account_code);
      setAccountType(editAccount.account_type);
      setAccountSubtype(editAccount.account_subtype || "");
      setParentId(editAccount.parent_account_id || "");
      setCategoryId(editAccount.category_id || "");
    } else {
      setAccountName("");
      setAccountCode("");
      setAccountType("Asset");
      setAccountSubtype("");
      setParentId("");
      setCategoryId("");
    }
    setShowNewCategory(false);
    setNewCategoryName("");
  }, [editAccount, open]);

  const filteredCategories = categories.filter(c => c.account_type === accountType);
  const subtypes = ACCOUNT_SUBTYPES[accountType] || [];
  const numberRange = ACCOUNT_NUMBER_RANGES[accountType];

  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !onCreateCategory) return;
    setCreatingCategory(true);
    try {
      const created = await onCreateCategory({ name: newCategoryName.trim(), account_type: accountType });
      if (created) {
        setCategoryId(created.id);
      }
      setNewCategoryName("");
      setShowNewCategory(false);
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleSubmit = async () => {
    await onSubmit({
      account_name: accountName,
      account_code: accountCode,
      account_type: accountType,
      account_subtype: accountSubtype || undefined,
      parent_account_id: parentId || undefined,
      category_id: categoryId || undefined,
    });
    setAccountName("");
    setAccountCode("");
    setAccountType("Asset");
    setAccountSubtype("");
    setParentId("");
    setCategoryId("");
  };

  const inputClass = "mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editAccount ? "Edit Account" : "Create New Account"}</DialogTitle>
          <DialogDescription>
            {editAccount ? "Update account details" : "Add a new account to your chart of accounts"}
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
                setShowNewCategory(false);
              }}
              className={inputClass}
            >
              {ACCOUNT_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Category - prominent placement */}
          <div>
            <label className="text-sm font-medium">Category <span className="text-destructive">*</span></label>
            <p className="text-[11px] text-muted-foreground mb-1">
              e.g. Current Assets, Non-Current Assets, Current Liabilities
            </p>
            {!showNewCategory ? (
              <div className="flex gap-2">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className={`${inputClass} flex-1`}
                >
                  <option value="">— Select category —</option>
                  {filteredCategories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {onCreateCategory && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 shrink-0"
                    onClick={() => setShowNewCategory(true)}
                  >
                    <Plus className="h-4 w-4 mr-1" /> New
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className={`${inputClass} flex-1 !mt-0`}
                  placeholder={`e.g. Current ${accountType}s`}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!newCategoryName.trim() || creatingCategory}
                  onClick={handleAddCategory}
                >
                  {creatingCategory ? "..." : "Add"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowNewCategory(false); setNewCategoryName(""); }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>

          {/* Detail Type (Subtype) */}
          <div>
            <label className="text-sm font-medium">Detail Type</label>
            <select
              value={accountSubtype}
              onChange={(e) => setAccountSubtype(e.target.value)}
              className={inputClass}
            >
              <option value="">— Select detail type —</option>
              {subtypes.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Account Code */}
            <div>
              <label className="text-sm font-medium">Account Number</label>
              <input
                type="text"
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                className={inputClass}
                placeholder={numberRange ? `${numberRange.min}–${numberRange.max}` : ""}
              />
              {numberRange && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Recommended: {numberRange.min}–{numberRange.max}
                </p>
              )}
            </div>
            {/* Account Name */}
            <div>
              <label className="text-sm font-medium">Account Name <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className={inputClass}
                placeholder="e.g. Cash on Hand"
              />
            </div>
          </div>

          {/* Parent Account */}
          <div>
            <label className="text-sm font-medium">Parent Account (optional)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className={inputClass}
            >
              <option value="">None (top-level)</option>
              {accounts
                ?.filter(a => a.id !== editAccount?.id && a.account_type === accountType)
                .map(a => (
                  <option key={a.id} value={a.id}>
                    {a.account_code} — {a.account_name}
                  </option>
                ))}
            </select>
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
            {accountSubtype && (
              <div className="flex justify-between">
                <span>Detail type:</span>
                <strong className="text-foreground">{accountSubtype}</strong>
              </div>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!accountName || !accountCode || isPending}
            className="w-full"
          >
            {isPending ? "Saving..." : editAccount ? "Update Account" : "Create Account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
