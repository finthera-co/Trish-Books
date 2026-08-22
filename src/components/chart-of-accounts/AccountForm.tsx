import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AccountCategory } from "@/hooks/useAccountCategories";
import { Plus, Lock, AlertTriangle } from "lucide-react";
import {
  ACCOUNT_TYPES,
  ACCOUNT_SUBTYPES,
  ACCOUNT_NUMBER_RANGES,
  getSubtypesForType,
  getNormalBalance,
  getStatementPlacement,
  isContraSubtype,
  getAccountTypeLabel,
  suggestSubtypeFromCode,
} from "@/lib/accountTypes";
import { Sparkles } from "lucide-react";
import { useNextAccountCode } from "@/hooks/useData";
import {
  buildAccountsMap,
  canCreateChildUnder,
  deriveAccountFlags,
  isDirectControl,
  canEditAccountType,
  flattenAccountTree,
  MAX_ACCOUNT_DEPTH,
} from "@/lib/accountMappingEngine";
import { usePersistedFormState } from "@/hooks/usePersistedFormState";

export interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype?: string | null;
  parent_account_id: string | null;
  category_id: string | null;
  is_active: boolean;
  account_level?: number | null;
  account_path?: string | null;
  description?: string | null;
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
    description?: string;
  }) => Promise<void>;
  accounts: Account[];
  categories: AccountCategory[];
  isPending: boolean;
  editAccount?: Account | null;
  existingCodes?: Set<string>;
  onCreateCategory?: (data: { name: string; account_type: string }) => Promise<AccountCategory | undefined>;
  /** Prefill the name on a fresh new-account draft (e.g. text typed in an account picker) */
  initialName?: string;
  /**
   * "Duplicate Account": pre-fills a fresh create-mode draft from an existing
   * account's type/subtype/parent/category/description, with the name seeded
   * as "Copy of {name}". Opening balance and transaction history are
   * deliberately not carried over. Ignored when `editAccount` is set.
   */
  duplicateFrom?: Account | null;
  /**
   * When provided, name matches against the existing chart become clickable so the
   * user can pick the account that already exists instead of creating a duplicate.
   */
  onUseExisting?: (account: Account) => void;
  /**
   * Namespace for the persisted draft. Defaults to "coa" so the Chart of Accounts
   * page keeps its existing draft; callers embedding this form elsewhere (e.g. the
   * journal entry dialog) pass their own scope so drafts don't bleed across screens.
   */
  draftScope?: string;
  /** Pre-seeds the parent when opened via "Add Sub-account". */
  defaultParentId?: string | null;
}

type AccountDraft = {
  accountName: string;
  accountCode: string;
  accountType: string;
  accountSubtype: string;
  parentId: string;
  categoryId: string;
  description: string;
};

/** Case/space-insensitive name key used for the duplicate-account check */
const normalizeName = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");

const emptyDraft: AccountDraft = {
  accountName: "",
  accountCode: "",
  accountType: "Asset",
  accountSubtype: "",
  parentId: "",
  categoryId: "",
  description: "",
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
  initialName,
  onUseExisting,
  draftScope = "coa",
  defaultParentId,
  duplicateFrom,
}: AccountFormProps) {
  // User-entered fields live in one persisted draft so a browser refresh
  // doesn't lose half-filled data. Scope the key per-record: the new-account
  // draft is separate from each edit draft, so they never bleed into each other.
  const draftKey = editAccount
    ? `${draftScope}-account:edit:${editAccount.id}`
    : `${draftScope}-account:new`;
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
  const [showNewSubtype, setShowNewSubtype] = useState(false);
  const [newSubtypeName, setNewSubtypeName] = useState("");

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
              description: editAccount.description || "",
            }
          : d;
      });
    } else {
      const seedParent = defaultParentId
        ? accounts.find(a => a.id === defaultParentId)
        : undefined;

      if (seedParent) {
        // Opened via "Add Sub-account": seed parent + inherited type, but
        // never clobber a draft the user has already started.
        setDraft((d) =>
          d.parentId || d.accountName
            ? d
            : {
                ...d,
                accountType: seedParent.account_type,
                parentId: seedParent.id,
                categoryId: seedParent.category_id || "",
              }
        );
      } else if (duplicateFrom) {
        // Opened via "Duplicate Account": copy type/subtype/parent/category/
        // description, never opening balance or history — but never clobber
        // a draft the user has already started.
        setDraft((d) =>
          d.accountName
            ? d
            : {
                ...d,
                accountName: `Copy of ${duplicateFrom.account_name}`,
                accountType: duplicateFrom.account_type,
                accountSubtype: duplicateFrom.account_subtype || "",
                parentId: duplicateFrom.parent_account_id || "",
                categoryId: duplicateFrom.category_id || "",
                description: duplicateFrom.description || "",
              }
        );
      } else if (initialName) {
        // Opened from an account picker with text already typed: use it as the name,
        // but never clobber a draft the user has already started.
        setDraft((d) => (d.accountName ? d : { ...d, accountName: initialName }));
      }
    }
    setShowNewCategory(false);
    setNewCategoryName("");
    setShowNewSubtype(false);
    setNewSubtypeName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAccount, open, defaultParentId, duplicateFrom?.id]);

  // Auto-generate account code (new accounts only) via the server-side
  // next_account_code() RPC — the authoritative generator; see
  // src/lib/accountCodeGenerator.ts for why client-side generation is retired.
  // Root accounts band by subtype (mirrors the old generateAccountCodeBanded);
  // children step numerically under the parent. Since the subtype starts
  // empty on a fresh draft, this resolves in two hops: an un-banded/unstepped
  // fallback code is fetched first, a subtype is guessed off it, and that
  // subtype's presence in the query key triggers a second, correctly-banded
  // fetch — converging without any manual orchestration.
  const { data: suggestedCode, isFetching: codeLoading } = useNextAccountCode(
    draft.accountType,
    draft.parentId || null,
    draft.accountSubtype || null,
    open && !editAccount
  );

  useEffect(() => {
    if (editAccount || !open || !suggestedCode) return;
    setDraft((d) => {
      const nextSubtype =
        d.accountSubtype ||
        suggestSubtypeFromCode(suggestedCode, d.accountType) ||
        (ACCOUNT_SUBTYPES[d.accountType] || [])[0] ||
        "";
      if (d.accountCode === suggestedCode && d.accountSubtype === nextSubtype) return d;
      return { ...d, accountCode: suggestedCode, accountSubtype: nextSubtype };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedCode, editAccount, open]);

  const filteredCategories = categories.filter(c => c.account_type === draft.accountType);
  const subtypes = useMemo(
    () => getSubtypesForType(draft.accountType, accounts),
    [draft.accountType, accounts]
  );
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

  // A detail type the tenant invented (or one carried over from an older chart):
  // it has no reserved number band and no subledger behaviour attached.
  const isCustomSubtype = useMemo(() => {
    const st = draft.accountSubtype.trim().toLowerCase();
    if (!st) return false;
    return !(ACCOUNT_SUBTYPES[draft.accountType] || []).some(m => m.toLowerCase() === st);
  }, [draft.accountSubtype, draft.accountType]);

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

  // Duplicate-name guard. Same name under the same parent is a real duplicate and
  // is blocked; the same name elsewhere in the chart (or a near match) is only
  // flagged, since "Fuel" under two different parents is legitimate.
  const nameMatches = useMemo(() => {
    const target = normalizeName(draft.accountName);
    if (!target) return { exactSameParent: null as Account | null, exactElsewhere: [] as Account[], similar: [] as Account[] };
    const exactSameParent: Account[] = [];
    const exactElsewhere: Account[] = [];
    const similar: Account[] = [];
    for (const a of accounts) {
      if (editAccount && a.id === editAccount.id) continue;
      const name = normalizeName(a.account_name);
      if (name === target) {
        if ((a.parent_account_id || "") === (draft.parentId || "")) exactSameParent.push(a);
        else exactElsewhere.push(a);
      } else if (target.length >= 3 && (name.includes(target) || target.includes(name))) {
        similar.push(a);
      }
    }
    return {
      exactSameParent: exactSameParent[0] || null,
      exactElsewhere: exactElsewhere.slice(0, 4),
      similar: similar.slice(0, 4),
    };
  }, [draft.accountName, draft.parentId, accounts, editAccount]);

  const isNameDuplicate = !!nameMatches.exactSameParent;

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

  // Custom detail type: not in the built-in list, so just adopt the typed value.
  // It becomes a selectable option everywhere once the account is saved with it.
  const handleAddSubtype = () => {
    const name = newSubtypeName.trim();
    if (!name) return;
    const existing = subtypes.find(st => st.toLowerCase() === name.toLowerCase());
    setField("accountSubtype", existing || name);
    setNewSubtypeName("");
    setShowNewSubtype(false);
  };

  const handleSubmit = async () => {
    if (isCodeDuplicate || isNameDuplicate) return;
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
      description: draft.description || undefined,
    });
    clearDraft();
    setDraft(emptyDraft);
  };

  const inputClass = "mt-1 w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editAccount ? "Edit Account" : duplicateFrom ? "Duplicate Account" : "Create New Account"}</DialogTitle>
          <DialogDescription>
            {editAccount
              ? "Update account details"
              : duplicateFrom
                ? `Same setup as ${duplicateFrom.account_code} — ${duplicateFrom.account_name}, without its balance or history`
                : "Add a new account to your chart of accounts"}
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
                setShowNewSubtype(false);
                setNewSubtypeName("");
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
              <div className="flex items-center gap-1">
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
                {!showNewSubtype && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => {
                      setNewSubtypeName("");
                      setShowNewSubtype(true);
                    }}
                    title="Add a detail type that isn't in the list"
                  >
                    <Plus className="h-3 w-3" /> New
                  </Button>
                )}
              </div>
            </div>
            {!showNewSubtype ? (
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
            ) : (
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={newSubtypeName}
                  onChange={(e) => setNewSubtypeName(e.target.value)}
                  className={`${inputClass} flex-1 !mt-0`}
                  placeholder={`e.g. custom ${getAccountTypeLabel(draft.accountType).toLowerCase()} detail type`}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddSubtype();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!newSubtypeName.trim()}
                  onClick={handleAddSubtype}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowNewSubtype(false); setNewSubtypeName(""); }}
                >
                  Cancel
                </Button>
              </div>
            )}
            {!draft.accountSubtype ? (
              <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Required — drives statement classification, subledger routing & validations. Use Quick Setup to auto-assign.
              </p>
            ) : deriveAccountFlags(draft.accountSubtype).is_control_account ? (
              <p className="text-[10px] text-warning mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                This detail type creates a control account managed by subledger. Manual posting will be restricted.
              </p>
            ) : isCustomSubtype ? (
              <p className="text-[10px] text-muted-foreground mt-1">
                Custom detail type — no reserved number band, so the account number is taken
                from the next free slot in the {getAccountTypeLabel(draft.accountType)} range
                {numberRange ? ` (${numberRange.min}–${numberRange.max})` : ""}.
              </p>
            ) : null}
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
                value={codeLoading && !draft.accountCode ? "…" : draft.accountCode}
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
                  {codeLoading ? "Generating…" : "Auto-generated"}
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
                className={`${inputClass} ${isNameDuplicate ? "!border-destructive !ring-destructive/20" : ""}`}
                placeholder="e.g. Cash on Hand"
              />
              {isNameDuplicate && (
                <p className="text-[10px] text-destructive mt-1 font-medium">
                  An account with this name already exists in the same place
                </p>
              )}
            </div>
          </div>

          {/* Duplicate / near-duplicate matches from the existing chart */}
          {(nameMatches.exactSameParent || nameMatches.exactElsewhere.length > 0 || nameMatches.similar.length > 0) && (
            <div
              className={`rounded-lg border px-3 py-2 space-y-1.5 ${
                isNameDuplicate ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5"
              }`}
            >
              <p className="text-[11px] font-medium flex items-center gap-1.5 text-foreground">
                <AlertTriangle className={`w-3 h-3 ${isNameDuplicate ? "text-destructive" : "text-warning"}`} />
                {isNameDuplicate ? "This account already exists" : "Similar accounts already exist"}
              </p>
              {[
                ...(nameMatches.exactSameParent ? [nameMatches.exactSameParent] : []),
                ...nameMatches.exactElsewhere,
                ...nameMatches.similar,
              ].map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-muted-foreground">
                    <span className="font-mono mr-1.5">{a.account_code}</span>
                    <span className="text-foreground">{a.account_name}</span>
                    <span className="ml-1.5">· {getAccountTypeLabel(a.account_type)}</span>
                    {!a.is_active && <span className="ml-1.5 italic">(inactive)</span>}
                  </span>
                  {onUseExisting && (
                    <button
                      type="button"
                      onClick={() => onUseExisting(a)}
                      className="shrink-0 text-primary hover:underline font-medium"
                    >
                      Use this
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Parent Account */}
          <div>
            <label className="text-sm font-medium">Parent Account (optional)</label>
            <select
              value={draft.parentId}
              onChange={(e) => setField("parentId", e.target.value)}
              className={inputClass}
            >
              <option value="">None (top-level)</option>
              {flattenAccountTree(accounts, {
                accountType: draft.accountType,
                excludeSubtreeOf: editAccount?.id,
              }).map(({ account: a, depth }) => {
                const check = canCreateChildUnder(a, accountsMap);
                const pad = "  ".repeat(depth);
                const lvl = a.account_level ?? depth + 1;
                return (
                  <option key={a.id} value={a.id} disabled={!check.allowed}>
                    {pad}{depth > 0 ? "└ " : ""}{a.account_code} — {a.account_name}
                    {` · L${lvl}`}
                    {!check.allowed ? " (max depth)" : ""}
                  </option>
                );
              })}
            </select>
            {parentValidation && !parentValidation.allowed && (
              <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {parentValidation.reason}
              </p>
            )}
            {parentValidation?.warning && (
              <p className="text-[10px] text-warning mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {parentValidation.warning}
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
              Sub-accounts inherit the parent's account type and subledger routing.
              Parents become summary accounts and can no longer be posted to directly.
              Maximum depth is {MAX_ACCOUNT_DEPTH} levels.
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium">Description (optional)</label>
            <textarea
              value={draft.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
              placeholder="Internal note about what this account is used for"
            />
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
            disabled={!draft.accountName || !draft.accountCode || !draft.accountSubtype || isCodeDuplicate || isNameDuplicate || isPending || missingRequiredParent}
            className="w-full"
          >
            {isPending ? "Saving..." : editAccount ? "Update Account" : "Create Account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
