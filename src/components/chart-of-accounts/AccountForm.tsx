import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AccountCategory } from "@/hooks/useAccountCategories";
import { Plus, Lock, AlertTriangle } from "lucide-react";
import {
  ACCOUNT_TYPES,
  ACCOUNT_SUBTYPES,
  ACCOUNT_NUMBER_RANGES,
  getNormalBalance,
  getStatementPlacement,
  isContraSubtype,
  getAccountTypeLabel,
  suggestSubtypeFromCode,
} from "@/lib/accountTypes";
import { Sparkles } from "lucide-react";
import { generateAccountCode, generateAccountCodeBanded } from "@/lib/accountCodeGenerator";
import {
  buildAccountsMap,
  canCreateChildUnder,
  deriveAccountFlags,
  isDirectControl,
  canEditAccountType,
} from "@/lib/accountMappingEngine";

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
  existingCodes?: Set<string>;
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
  existingCodes,
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

  // Auto-generate account code (new accounts only).
  // Top-level → QuickBooks-style sub-band by subtype.
  // Sub-account → preserve inherited child-stepping under the parent.
  useEffect(() => {
    if (editAccount) return;
    if (!open) return;

    if (parentId) {
      // Child account: keep existing hierarchy stepping, unchanged.
      const code = generateAccountCode(accountType, parentId, accounts);
      setAccountCode(code);
      setAccountSubtype(prev => prev || suggestSubtypeFromCode(code, accountType) || "");
    } else {
      // Top-level: band by subtype. First ensure we have a subtype to band on.
      const effectiveSubtype =
        accountSubtype || suggestSubtypeFromCode(
          generateAccountCode(accountType, null, accounts),
          accountType
        ) || (ACCOUNT_SUBTYPES[accountType] || [])[0] || "";
      if (!accountSubtype && effectiveSubtype) {
        setAccountSubtype(effectiveSubtype);
      }
      const code = generateAccountCodeBanded(accountType, effectiveSubtype, accounts);
      setAccountCode(code);
    }
  }, [accountType, parentId, accountSubtype, accounts, editAccount, open]);

  const filteredCategories = categories.filter(c => c.account_type === accountType);
  const subtypes = ACCOUNT_SUBTYPES[accountType] || [];
  const numberRange = ACCOUNT_NUMBER_RANGES[accountType];
  const accountsMap = useMemo(() => buildAccountsMap(accounts), [accounts]);

  // Validate parent selection
  const parentValidation = useMemo(() => {
    if (!parentId) return null;
    const parent = accounts.find(a => a.id === parentId);
    if (!parent) return null;
    return canCreateChildUnder(parent, accountsMap);
  }, [parentId, accounts, accountsMap]);

  // Check if editing a control account (restrict type changes)
  const editTypeRestriction = useMemo(() => {
    if (!editAccount) return null;
    return canEditAccountType(editAccount, accountsMap);
  }, [editAccount, accountsMap]);

  // Account code uniqueness check
  const isCodeDuplicate = existingCodes
    ? existingCodes.has(accountCode) && (!editAccount || editAccount.account_code !== accountCode)
    : false;

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
    if (isCodeDuplicate) return;
    if (!accountSubtype) return;
    await onSubmit({
      account_name: accountName,
      account_code: accountCode,
      account_type: accountType,
      account_subtype: accountSubtype || undefined,
      parent_account_id: parentId || undefined,
      category_id: categoryId || undefined,
      normal_balance: getNormalBalance(accountType, isContraSubtype(accountSubtype)).toLowerCase(),
      is_contra: isContraSubtype(accountSubtype),
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
              disabled={editTypeRestriction !== null && !editTypeRestriction.allowed}
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

          {/* Detail Type (Subtype) — REQUIRED */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                Detail Type <span className="text-destructive">*</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => {
                  const suggestion = suggestSubtypeFromCode(accountCode, accountType);
                  if (suggestion) setAccountSubtype(suggestion);
                }}
                title="Auto-assign based on account number range"
              >
                <Sparkles className="h-3 w-3" /> Quick Setup
              </Button>
            </div>
            <select
              value={accountSubtype}
              onChange={(e) => setAccountSubtype(e.target.value)}
              className={`${inputClass} ${!accountSubtype ? "!border-destructive/40" : ""}`}
            >
              <option value="">— Select detail type —</option>
              {subtypes.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            {!accountSubtype ? (
              <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Required — drives statement classification, subledger routing & validations. Use Quick Setup to auto-assign.
              </p>
            ) : deriveAccountFlags(accountSubtype).is_control_account && (
              <p className="text-[10px] text-warning mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                This detail type creates a control account managed by subledger. Manual posting will be restricted.
              </p>
            )}
          </div>


          <div className="grid grid-cols-2 gap-4">
            {/* Account Code */}
            <div>
              <label className="text-sm font-medium flex items-center gap-1">
                Account Number <span className="text-destructive">*</span>
                <Lock className="w-3 h-3 text-muted-foreground" />
              </label>
              <input
                type="text"
                value={accountCode}
                readOnly
                className={`${inputClass} bg-muted/50 cursor-not-allowed ${isCodeDuplicate ? "!border-destructive !ring-destructive/20" : ""}`}
                placeholder={numberRange ? `${numberRange.min}–${numberRange.max}` : ""}
              />
              {isCodeDuplicate ? (
                <p className="text-[10px] text-destructive mt-1 font-medium">
                  This account number already exists
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Auto-generated
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
                ?.filter(a => {
                  if (a.id === editAccount?.id) return false;
                  if (a.account_type !== accountType) return false;
                  const acctMap = buildAccountsMap(accounts);
                  const check = canCreateChildUnder(a, acctMap);
                  return check.allowed;
                })
                .map(a => {
                  const flags = deriveAccountFlags(a.account_subtype);
                  return (
                    <option key={a.id} value={a.id}>
                      {a.account_code} — {a.account_name}
                      {flags.is_control_account && flags.allow_sub_accounts ? " (allows sub-categories)" : ""}
                    </option>
                  );
                })}
            </select>
            {parentValidation && !parentValidation.allowed && (
              <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {parentValidation.reason}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              Control accounts (AR, AP, Inventory) cannot have sub-accounts — use their subledger modules instead.
            </p>
          </div>

          {/* Info panel */}
          <div className="bg-muted/50 rounded-lg px-3 py-2.5 text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Classification:</span>
              <strong className="text-foreground">{getAccountTypeLabel(accountType, isContraSubtype(accountSubtype))}</strong>
            </div>
            <div className="flex justify-between">
              <span>Normal balance:</span>
              <strong className="text-foreground">{getNormalBalance(accountType, isContraSubtype(accountSubtype))}</strong>
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
            disabled={!accountName || !accountCode || !accountSubtype || isCodeDuplicate || isPending}
            className="w-full"
          >
            {isPending ? "Saving..." : editAccount ? "Update Account" : "Create Account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
