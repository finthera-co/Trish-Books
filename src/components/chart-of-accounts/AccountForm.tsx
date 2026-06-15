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
import { usePersistedFormState } from "@/hooks/usePersistedFormState";

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
    normal_balance?: string;
    is_contra?: boolean;
  }) => Promise<void>;
  accounts: Account[];
  categories: AccountCategory[];
  isPending: boolean;
  editAccount?: Account | null;
  existingCodes?: Set<string>;
  onCreateCategory?: (data: { name: string; account_type: string }) => Promise<AccountCategory | undefined>;
}

type AccountDraft = {
  accountName: string;
  accountCode: string;
  accountType: string;
  accountSubtype: string;
  parentId: string;
  categoryId: string;
};

const emptyDraft: AccountDraft = {
  accountName: "",
  accountCode: "",
  accountType: "Asset",
  accountSubtype: "",
  parentId: "",
  categoryId: "",
};

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
  // User-entered fields live in one persisted draft so a browser refresh
  // doesn't lose half-filled data. Scope the key per-record: the new-account
  // draft is separate from each edit draft, so they never bleed into each other.
  const draftKey = editAccount ? `coa-account:edit:${editAccount.id}` : "coa-account:new";
  const {
    state: draft,
    setState: setDraft,
    clear: clearDraft,
  } = usePersistedFormState<AccountDraft>(draftKey, emptyDraft, { enabled: open });

  const setField = <K extends keyof AccountDraft>(k: K, v: AccountDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // Transient UI state — not worth persisting.
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Clear the draft on any user-initiated close (cancel / X / Escape). A page
  // refresh does NOT call this, so the draft survives refresh and is only
  // discarded on an explicit close or a successful submit.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      clearDraft();
      setDraft(emptyDraft);
    }
    onOpenChange(next);
  };

  // When opening an EDIT form, seed from the record — but only if the draft is
  // still empty, so a refresh mid-edit keeps in-progress changes instead of
  // clobbering them with the original values.
  useEffect(() => {
    if (!open) return;
    if (editAccount) {
      setDraft((d) => {
        const isEmpty =
          !d.accountName && !d.accountCode && !d.accountSubtype &&
          !d.parentId && !d.categoryId;
        return isEmpty
          ? {
              accountName: editAccount.account_name,
              accountCode: editAccount.account_code,
              accountType: editAccount.account_type,
              accountSubtype: editAccount.account_subtype || "",
              parentId: editAccount.parent_account_id || "",
              categoryId: editAccount.category_id || "",
            }
          : d;
      });
    }
    setShowNewCategory(false);
    setNewCategoryName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAccount, open]);

  // Auto-generate account code (new accounts only).
  // Top-level → QuickBooks-style sub-band by subtype.
  // Sub-account → preserve inherited child-stepping under the parent.
  useEffect(() => {
    if (editAccount) return;
    if (!open) return;

    setDraft((d) => {
      let code: string;
      let nextSubtype = d.accountSubtype;
      if (d.parentId) {
        // Child account: keep existing hierarchy stepping, unchanged.
        code = generateAccountCode(d.accountType, d.parentId, accounts);
        nextSubtype = d.accountSubtype || suggestSubtypeFromCode(code, d.accountType) || "";
      } else {
        // Top-level: band by subtype. First ensure we have a subtype to band on.
        const effectiveSubtype =
          d.accountSubtype || suggestSubtypeFromCode(
            generateAccountCode(d.accountType, null, accounts),
            d.accountType
          ) || (ACCOUNT_SUBTYPES[d.accountType] || [])[0] || "";
        nextSubtype = d.accountSubtype || effectiveSubtype;
        code = generateAccountCodeBanded(d.accountType, effectiveSubtype, accounts);
      }
      if (d.accountCode === code && d.accountSubtype === nextSubtype) return d;
      return { ...d, accountCode: code, accountSubtype: nextSubtype };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.accountType, draft.parentId, draft.accountSubtype, accounts, editAccount, open]);

  const filteredCategories = categories.filter(c => c.account_type === draft.accountType);
  const subtypes = ACCOUNT_SUBTYPES[draft.accountType] || [];
  const numberRange = ACCOUNT_NUMBER_RANGES[draft.accountType];
  const accountsMap = useMemo(() => buildAccountsMap(accounts), [accounts]);

  // Fixed-asset detail accounts MUST sit under a control parent so their balance
  // has somewhere to roll up. Require a parent when creating one of these.
  const requiresParentLink = useMemo(() => {
    const st = (draft.accountSubtype || "").toLowerCase();
    return (
      st.includes("fixed asset") ||
      st.includes("furniture") ||
      st.includes("vehicle") ||
      st.includes("building") ||
      st.includes("accumulated depreciation")
    );
  }, [draft.accountSubtype]);

  const missingRequiredParent = !editAccount && requiresParentLink && !draft.parentId;

  // Validate parent selection
  const parentValidation = useMemo(() => {
    if (!draft.parentId) return null;
    const parent = accounts.find(a => a.id === draft.parentId);
    if (!parent) return null;
    return canCreateChildUnder(parent, accountsMap);
  }, [draft.parentId, accounts, accountsMap]);

  // Check if editing a control account (restrict type changes)
  const editTypeRestriction = useMemo(() => {
    if (!editAccount) return null;
    return canEditAccountType(editAccount, accountsMap);
  }, [editAccount, accountsMap]);

  // Account code uniqueness check
  const isCodeDuplicate = existingCodes
    ? existingCodes.has(draft.accountCode) && (!editAccount || editAccount.account_code !== draft.accountCode)
    : false;

  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !onCreateCategory) return;
    setCreatingCategory(true);
    try {
      const created = await onCreateCategory({ name: newCategoryName.trim(), account_type: draft.accountType });
      if (created) {
        setField("categoryId", created.id);
      }
      setNewCategoryName("");
      setShowNewCategory(false);
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleSubmit = async () => {
    if (isCodeDuplicate) return;
    if (!draft.accountSubtype) return;
    await onSubmit({
      account_name: draft.accountName,
      account_code: draft.accountCode,
      account_type: draft.accountType,
      account_subtype: draft.accountSubtype || undefined,
      parent_account_id: draft.parentId || undefined,
      category_id: draft.categoryId || undefined,
      normal_balance: getNormalBalance(draft.accountType, isContraSubtype(draft.accountSubtype)).toLowerCase(),
      is_contra: isContraSubtype(draft.accountSubtype),
    });
    clearDraft();
    setDraft(emptyDraft);
  };

  const inputClass = "mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
              value={draft.accountType}
              onChange={(e) => {
                setDraft((d) => ({ ...d, accountType: e.target.value, accountSubtype: "", categoryId: "" }));
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
                  value={draft.categoryId}
                  onChange={(e) => setField("categoryId", e.target.value)}
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
                  placeholder={`e.g. Current ${draft.accountType}s`}
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
                  const suggestion = suggestSubtypeFromCode(draft.accountCode, draft.accountType);
                  if (suggestion) setField("accountSubtype", suggestion);
                }}
                title="Auto-assign based on account number range"
              >
                <Sparkles className="h-3 w-3" /> Quick Setup
              </Button>
            </div>
            <select
              value={draft.accountSubtype}
              onChange={(e) => setField("accountSubtype", e.target.value)}
              className={`${inputClass} ${!draft.accountSubtype ? "!border-destructive/40" : ""}`}
            >
              <option value="">— Select detail type —</option>
              {subtypes.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            {!draft.accountSubtype ? (
              <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Required — drives statement classification, subledger routing & validations. Use Quick Setup to auto-assign.
              </p>
            ) : deriveAccountFlags(draft.accountSubtype).is_control_account && (
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
                value={draft.accountCode}
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
                value={draft.accountName}
                onChange={(e) => setField("accountName", e.target.value)}
                className={inputClass}
                placeholder="e.g. Cash on Hand"
              />
            </div>
          </div>

          {/* Parent Account */}
          <div>
            <label className="text-sm font-medium">Parent Account (optional)</label>
            <select
              value={draft.parentId}
              onChange={(e) => setField("parentId", e.target.value)}
              className={inputClass}
            >
              <option value="">None (top-level)</option>
              {accounts
                ?.filter(a => {
                  if (a.id === editAccount?.id) return false;
                  if (a.account_type !== draft.accountType) return false;
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
            {missingRequiredParent && (
              <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Fixed-asset detail accounts must be linked to a parent control account
                so their balance rolls up. Select a Fixed Assets / PP&E parent.
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
              <strong className="text-foreground">{getAccountTypeLabel(draft.accountType, isContraSubtype(draft.accountSubtype))}</strong>
            </div>
            <div className="flex justify-between">
              <span>Normal balance:</span>
              <strong className="text-foreground">{getNormalBalance(draft.accountType, isContraSubtype(draft.accountSubtype))}</strong>
            </div>
            <div className="flex justify-between">
              <span>Financial statement:</span>
              <strong className="text-foreground">{getStatementPlacement(draft.accountType)}</strong>
            </div>
            {draft.accountSubtype && (
              <div className="flex justify-between">
                <span>Detail type:</span>
                <strong className="text-foreground">{draft.accountSubtype}</strong>
              </div>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!draft.accountName || !draft.accountCode || !draft.accountSubtype || isCodeDuplicate || isPending || missingRequiredParent}
            className="w-full"
          >
            {isPending ? "Saving..." : editAccount ? "Update Account" : "Create Account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
