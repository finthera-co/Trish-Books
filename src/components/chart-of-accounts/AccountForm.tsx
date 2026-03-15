import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AccountCategory } from "@/hooks/useAccountCategories";
import {
  ACCOUNT_TYPES,
  ACCOUNT_SUBTYPES,
  ACCOUNT_NUMBER_RANGES,
  getNormalBalance,
  getStatementPlacement,
  getTypeLabel,
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
}

export default function AccountForm({
  open,
  onOpenChange,
  onSubmit,
  accounts,
  categories,
  isPending,
  editAccount,
}: AccountFormProps) {
  const [accountName, setAccountName] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [accountType, setAccountType] = useState("Asset");
  const [accountSubtype, setAccountSubtype] = useState("");
  const [parentId, setParentId] = useState("");
  const [categoryId, setCategoryId] = useState("");

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
  }, [editAccount, open]);

  const filteredCategories = categories.filter(c => c.account_type === accountType);
  const subtypes = ACCOUNT_SUBTYPES[accountType] || [];
  const numberRange = ACCOUNT_NUMBER_RANGES[accountType];

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
              }}
              className={inputClass}
            >
              {ACCOUNT_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
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

          {/* Category */}
          {filteredCategories.length > 0 && (
            <div>
              <label className="text-sm font-medium">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={inputClass}
              >
                <option value="">None</option>
                {filteredCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

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
