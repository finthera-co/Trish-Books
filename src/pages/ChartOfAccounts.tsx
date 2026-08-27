import { Plus, Search, Download, BookOpen, ChevronRight, Edit2, Power, Trash2, LayoutList, LayoutGrid, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAccounts, useCreateAccount, useUpdateAccount } from "@/hooks/useData";
import { formatCurrency } from "@/lib/currency";
import { useAccountCategories, useCreateAccountCategory, useEnsureOBEAccount } from "@/hooks/useAccountCategories";
import { useAuth } from "@/contexts/AuthContext";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useOBEBalance } from "@/hooks/useOpeningBalanceEquity";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import AccountForm from "@/components/chart-of-accounts/AccountForm";
import { usePersistedFormState } from "@/hooks/usePersistedFormState";
import COAHealthCheck from "@/components/chart-of-accounts/COAHealthCheck";
import DeleteAccountDialog from "@/components/chart-of-accounts/DeleteAccountDialog";
import AccountContextMenu from "@/components/chart-of-accounts/AccountContextMenu";
import AccountTransactionsSheet from "@/components/chart-of-accounts/AccountTransactionsSheet";
import SetOpeningBalanceDialog from "@/components/chart-of-accounts/SetOpeningBalanceDialog";
import MoveAccountDialog from "@/components/chart-of-accounts/MoveAccountDialog";
import AccountHistorySheet from "@/components/chart-of-accounts/AccountHistorySheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import InlineOpeningBalance from "@/components/chart-of-accounts/InlineOpeningBalance";
import { useSystemSetting } from "@/hooks/useOpeningBalanceSettings";
import { useFiscalPeriods, usePeriodOpeningBalances, usePeriodAccountMovements, useCumulativeAccountMovements, useEnsureCurrentFiscalPeriod } from "@/hooks/useFiscalPeriodBalances";
import { netAccountBalance } from "@/lib/accountBalances";
import FiscalPeriodSelector from "@/components/FiscalPeriodSelector";

import {
  ACCOUNT_TYPES,
  typeColors,
  getTypeLabel,
  getNormalBalance,
  getStatementPlacement,
  isOpeningBalanceEquityAccount,
  isContraAccount,
  getAccountTypeLabel,
  isPeriodBasedAccount,
} from "@/lib/accountTypes";
import {
  buildAccountsMap,
  isDirectControl,
  isAccountControlled,
  resolveSubledgerType,
  mapAccountRoute,
  getModuleLabel,
  canCreateChildUnder,
  canEditAccountType,
  canDeleteAccount,
  type MappableAccount,
} from "@/lib/accountMappingEngine";

export interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype?: string | null;
  parent_account_id: string | null;
  category_id: string | null;
  is_active: boolean;
  is_postable?: boolean;
  account_level?: number;
  account_path?: string | null;
  control_account_type?: string;
  opening_balance?: number;
  opening_balance_type?: string;
  description?: string | null;
  account_categories?: { name: string } | null;
  children?: Account[];
}

/** Callbacks shared by every account-row context menu, grouped so adding one
 * doesn't mean threading a new prop through AccountRow/FlatAccountRow/
 * TypeSection/CategorySection individually. */
interface AccountRowActions {
  onEdit: (a: Account) => void;
  onToggleActive: (a: Account) => void;
  onDelete: (a: Account) => void;
  onGenerateReport: (a: Account) => void;
  onViewTransactions: (a: Account) => void;
  onAddChild: (a: Account) => void;
  onSetOpeningBalance: (a: Account) => void;
  onMoveAccount: (a: Account) => void;
  onDuplicate: (a: Account) => void;
  onViewHistory: (a: Account) => void;
}

function buildTree(accounts: Account[]): Account[] {
  const map = new Map<string, Account>();
  const roots: Account[] = [];
  accounts.forEach(a => map.set(a.id, { ...a, children: [] }));
  accounts.forEach(a => {
    const node = map.get(a.id)!;
    if (a.parent_account_id && map.has(a.parent_account_id)) {
      map.get(a.parent_account_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function sortTreeByName(nodes: Account[]): Account[] {
  return [...nodes]
    .sort((a, b) => a.account_name.localeCompare(b.account_name, undefined, { sensitivity: "base" }))
    .map(n => ({
      ...n,
      children: n.children && n.children.length > 0 ? sortTreeByName(n.children) : n.children,
    }));
}

interface CategoryGroup {
  id: string;
  name: string;
  accounts: Account[];
}

interface TypeGroup {
  type: string;
  categories: CategoryGroup[];
  uncategorized: Account[];
}

type PostedMovement = { debit: number; credit: number };

function getAccountDisplayBalance(
  account: Account,
  periodOBMap?: Map<string, PostedMovement>,
  movementsMap?: Map<string, PostedMovement>
): { balance: number; type: string } {
  const isContra = isContraAccount(account);

  // Posted journal movement contribution. For balance-sheet accounts this map
  // carries the CUMULATIVE posted movements up to the period end; for P&L
  // accounts it carries only the in-period movements (see the page-level
  // movementsMap memo).
  const movements = movementsMap?.get(account.id) ?? { debit: 0, credit: 0 };

  let opening: PostedMovement;
  if (isPeriodBasedAccount(account.account_type)) {
    // P&L accounts reset each fiscal year, so they carry only the period
    // opening balance (or the stored opening field as a fallback), never the
    // lifetime balance — movements here are in-period only.
    const periodOB = periodOBMap?.get(account.id);
    if (periodOB) {
      opening = { debit: periodOB.debit, credit: periodOB.credit };
    } else {
      const ob = Number((account as any).opening_balance ?? 0);
      const debitNormal = getNormalBalance(account.account_type, isContra) === "Debit";
      const obType = (account as any).opening_balance_type ?? (debitNormal ? "debit" : "credit");
      opening = obType === "debit" ? { debit: ob, credit: 0 } : { debit: 0, credit: ob };
    }
  } else {
    // Balance-sheet accounts: the cumulative movements already include the
    // opening-balance journal entry (opening balances are posted to the ledger
    // against OBE) plus every posted transaction up to the period end, so the
    // movement total IS the current balance. Adding the opening_balance field
    // again would double-count it.
    opening = { debit: 0, credit: 0 };
  }

  return netAccountBalance({
    accountType: account.account_type,
    isContra,
    opening,
    movements,
  });
}

// Recursively roll a parent's balance = own posted/opening balance
// + sum of all descendant balances. Signed net is accumulated as raw
// debit/credit so credit-normal children (e.g. Accumulated Depreciation)
// correctly reduce a debit-normal parent group.
function computeRollupBalance(
  account: Account,
  periodOBMap?: Map<string, PostedMovement>,
  movementsMap?: Map<string, PostedMovement>
): { balance: number; type: string } {
  // Own balance, expressed as a signed debit-positive number.
  const own = getAccountDisplayBalance(account, periodOBMap, movementsMap);
  let signedDebitNet = own.type === "debit" ? own.balance : -own.balance;

  for (const child of account.children ?? []) {
    const childRes = computeRollupBalance(child, periodOBMap, movementsMap);
    signedDebitNet += childRes.type === "debit" ? childRes.balance : -childRes.balance;
  }

  return {
    balance: Math.abs(signedDebitNet),
    type: signedDebitNet >= 0 ? "debit" : "credit",
  };
}

function AccountRow({
  account,
  depth = 0,
  actions,
  periodOBMap,
  isPeriodClosed,
  hasFiscalPeriod,
  canEdit,
  parentIsControl,
  globalAccountsMap,
  movementsMap,
}: {
  account: Account;
  depth?: number;
  actions: AccountRowActions;
  periodOBMap?: Map<string, { debit: number; credit: number }>;
  isPeriodClosed?: boolean;
  hasFiscalPeriod?: boolean;
  canEdit?: boolean;
  parentIsControl?: boolean;
  globalAccountsMap?: Map<string, MappableAccount>;
  movementsMap?: Map<string, { debit: number; credit: number }>;
}) {
  const [expanded, setExpanded] = useState(true);
  const navigate = useNavigate();
  const hasChildren = account.children && account.children.length > 0;

  // Use global accounts map for full hierarchy resolution
  // useMemo must be called unconditionally (Rules of Hooks); fall back to it
  // only when no shared map is supplied.
  const fallbackAccountsMap = useMemo(() => buildAccountsMap([account]), [account]);
  const accountsMap = globalAccountsMap ?? fallbackAccountsMap;

  const controlAcct = isDirectControl(account);
  const isControlled = isAccountControlled(account, accountsMap);
  const subledgerRoute = isControlled ? mapAccountRoute(account, accountsMap) : null;
  const subledgerModule = getModuleLabel(account, accountsMap);
  const { balance: displayBalance, type: displayType } = getAccountDisplayBalance(account, periodOBMap, movementsMap);

  // Any account with children shows a rolled-up figure. computeRollupBalance
  // already folds in the account's OWN posted balance, so this is correct even
  // for postable control accounts (e.g. 1650 Accumulated Depreciation) that
  // both receive postings and sit above child accounts.
  const isParentAccount = (account.children?.length ?? 0) > 0;
  const rollupResult = isParentAccount ? computeRollupBalance(account, periodOBMap, movementsMap) : null;

  // Determine if this account inherits control status from parent
  const isInheritedControl = !controlAcct && parentIsControl;

  const childCheck = canCreateChildUnder(account, accountsMap);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <tr className={`hover:!bg-muted/20 transition-colors ${!account.is_active ? "opacity-50" : ""}`}>
            <td className="relative" style={{ paddingLeft: `${depth * 28 + 16}px` }}>
              {depth > 0 &&
                Array.from({ length: depth }).map((_, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 border-l border-border/50"
                    style={{ left: `${i * 28 + 24}px` }}
                  />
                ))}
              <div className="flex items-center gap-2">
                {hasChildren ? (
                  <button onClick={() => setExpanded(!expanded)} className="p-0.5 rounded hover:bg-muted">
                    <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
                  </button>
                ) : <span className="w-4" />}
                <span className="font-mono text-xs text-muted-foreground">{account.account_code}</span>
                {controlAcct ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">This account is managed by subledger transactions. Direct posting is not allowed.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
                {(controlAcct || isInheritedControl) && subledgerRoute ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(subledgerRoute); }}
                    className="font-medium text-sm text-primary hover:underline cursor-pointer text-left"
                    title={`View ${subledgerModule} Subledger`}
                  >
                    {account.account_name}
                  </button>
                ) : (
                  <span className="font-medium text-sm text-foreground/80">
                    {account.account_name}
                  </span>
                )}
                {account.account_subtype && (
                  <span className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                    {account.account_subtype}
                  </span>
                )}
                {/* Summary badge for non-postable parent accounts */}
                {isParentAccount && (
                  <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900 px-1.5 py-0.5 rounded">
                    Summary
                  </span>
                )}
                {/* Control account badge */}
                {controlAcct && subledgerModule && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded inline-flex items-center gap-1 cursor-default">
                          <ShieldCheck className="w-3 h-3" />
                          Managed by {subledgerModule}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs max-w-[200px]">Balance is derived from {subledgerModule.toLowerCase()} subledger. Click the account name to view breakdown.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {/* Inherited control label for children of control accounts */}
                {isInheritedControl && subledgerModule && (
                  <span className="text-[10px] bg-muted/50 text-muted-foreground/70 px-1.5 py-0.5 rounded italic">
                    Managed by {subledgerModule} (inherited)
                  </span>
                )}
                {!account.is_active && (
                  <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Inactive</span>
                )}
              </div>
            </td>
            <td className="text-xs text-muted-foreground">
              {getNormalBalance(account.account_type)}
            </td>
            <td className="text-right">
              {(controlAcct || isInheritedControl) && subledgerRoute ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => navigate(subledgerRoute)}
                        className="text-sm font-mono text-primary hover:underline cursor-pointer"
                      >
                        {formatCurrency(displayBalance)}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Click to view {subledgerModule?.toLowerCase()} breakdown</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : isParentAccount && rollupResult ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-sm font-mono text-muted-foreground inline-flex items-center gap-1 cursor-default">
                        {formatCurrency(rollupResult.balance)}
                        <span className="text-[9px] font-sans bg-muted px-1 py-0.5 rounded">Σ</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs max-w-[220px]">
                      Sum of all child-account balances. Post to a child account to change this value.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <InlineOpeningBalance
                  accountId={account.id}
                  accountType={account.account_type}
                  accountSubtype={account.account_subtype}
                  currentBalance={displayBalance}
                  currentType={displayType}
                  normalBalance={getNormalBalance(account.account_type, isContraAccount(account))}
                  isLocked={(account as any).is_locked || isPeriodClosed || false}
                />
              )}
            </td>
            <td className="text-right">
              <div className="flex items-center justify-end gap-1">
                {canEdit && (
                  <>
                    {childCheck.allowed && (
                      <button
                        onClick={() => actions.onAddChild(account)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary"
                        title="Add sub-account"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => actions.onEdit(account)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => actions.onToggleActive(account)}
                      className={`p-1 rounded hover:bg-muted ${account.is_active ? "text-muted-foreground hover:text-destructive" : "text-success hover:text-success"}`}
                      title={account.is_active ? "Deactivate" : "Activate"}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    {!(account as any).is_system && (
                      <button
                        onClick={() => actions.onDelete(account)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </td>
          </tr>
        </ContextMenuTrigger>
        <AccountContextMenu
          account={account}
          accountsMap={accountsMap}
          canEdit={canEdit}
          onEdit={actions.onEdit}
          onDelete={actions.onDelete}
          onToggleActive={actions.onToggleActive}
          onGenerateReport={actions.onGenerateReport}
          onViewTransactions={actions.onViewTransactions}
          onAddChild={actions.onAddChild}
          onSetOpeningBalance={actions.onSetOpeningBalance}
          onMoveAccount={actions.onMoveAccount}
          onDuplicate={actions.onDuplicate}
          onViewHistory={actions.onViewHistory}
          hasFiscalPeriod={hasFiscalPeriod}
          isPeriodClosed={isPeriodClosed}
        />
      </ContextMenu>
      {expanded && account.children?.sort((a, b) => a.account_code.localeCompare(b.account_code)).map((child) => (
        <AccountRow
          key={child.id}
          account={child}
          depth={depth + 1}
          actions={actions}
          periodOBMap={periodOBMap}
          isPeriodClosed={isPeriodClosed}
          hasFiscalPeriod={hasFiscalPeriod}
          canEdit={canEdit}
          parentIsControl={controlAcct || parentIsControl}
          globalAccountsMap={accountsMap}
          movementsMap={movementsMap}
        />
      ))}
    </>
  );
}

// ─── Flat row for Classic view ──────────────────────────────
function FlatAccountRow({
  account,
  actions,
  periodOBMap,
  isPeriodClosed,
  hasFiscalPeriod,
  canEdit,
  globalAccountsMap,
  movementsMap,
}: {
  account: Account;
  actions: AccountRowActions;
  periodOBMap?: Map<string, { debit: number; credit: number }>;
  isPeriodClosed?: boolean;
  hasFiscalPeriod?: boolean;
  canEdit?: boolean;
  globalAccountsMap?: Map<string, MappableAccount>;
  movementsMap?: Map<string, { debit: number; credit: number }>;
}) {
  const navigate = useNavigate();
  // useMemo must be called unconditionally (Rules of Hooks); fall back to it
  // only when no shared map is supplied.
  const fallbackAccountsMap = useMemo(() => buildAccountsMap([account]), [account]);
  const accountsMap = globalAccountsMap ?? fallbackAccountsMap;
  const controlAcct = isDirectControl(account);
  const isControlled = isAccountControlled(account, accountsMap);
  const subledgerRoute = isControlled ? mapAccountRoute(account, accountsMap) : null;
  const subledgerModule = getModuleLabel(account, accountsMap);
  const { balance: displayBalance, type: displayType } = getAccountDisplayBalance(account, periodOBMap, movementsMap);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr className={`hover:!bg-muted/20 transition-colors ${!account.is_active ? "opacity-50" : ""}`}>
          <td className="pl-4">
            <span className="font-mono text-xs text-muted-foreground">{account.account_code}</span>
          </td>
          <td>
            <div className="flex items-center gap-2">
              {controlAcct && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Control account — managed by subledger</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {(controlAcct || isControlled) && subledgerRoute ? (
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(subledgerRoute); }}
                  className="font-medium text-sm text-primary hover:underline cursor-pointer text-left"
                >
                  {account.account_name}
                </button>
              ) : (
                <span className="font-medium text-sm text-foreground/80">{account.account_name}</span>
              )}
              {controlAcct && subledgerModule && (
                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  Managed by {subledgerModule}
                </span>
              )}
              {!account.is_active && (
                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Inactive</span>
              )}
            </div>
          </td>
          <td>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${typeColors[account.account_type] || "bg-muted text-muted-foreground"}`}>
              {isContraAccount(account) ? getAccountTypeLabel(account.account_type, true) : getTypeLabel(account.account_type)}
            </span>
          </td>
          <td className="text-xs text-muted-foreground">
            {account.account_categories?.name || "—"}
          </td>
          <td className="text-xs text-muted-foreground">
            {account.account_subtype || "—"}
          </td>
          <td className="text-xs text-muted-foreground">
            {getNormalBalance(account.account_type)}
          </td>
          <td className="text-right">
            {(controlAcct || isControlled) && subledgerRoute ? (
              <button
                onClick={() => navigate(subledgerRoute)}
                className="text-sm font-mono text-primary hover:underline cursor-pointer"
              >
                {formatCurrency(displayBalance)}
              </button>
            ) : (
              <InlineOpeningBalance
                accountId={account.id}
                accountType={account.account_type}
                accountSubtype={account.account_subtype}
                currentBalance={displayBalance}
                currentType={displayType}
                normalBalance={getNormalBalance(account.account_type, isContraAccount(account))}
                isLocked={(account as any).is_locked || isPeriodClosed || false}
              />
            )}
          </td>
          <td className="text-right">
            <div className="flex items-center justify-end gap-1">
              {canEdit && (
                <>
                  <button onClick={() => actions.onEdit(account)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => actions.onToggleActive(account)}
                    className={`p-1 rounded hover:bg-muted ${account.is_active ? "text-muted-foreground hover:text-destructive" : "text-success hover:text-success"}`}
                    title={account.is_active ? "Deactivate" : "Activate"}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  {!(account as any).is_system && (
                    <button onClick={() => actions.onDelete(account)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          </td>
        </tr>
      </ContextMenuTrigger>
      <AccountContextMenu
        account={account}
        accountsMap={accountsMap}
        canEdit={canEdit}
        onEdit={actions.onEdit}
        onDelete={actions.onDelete}
        onToggleActive={actions.onToggleActive}
        onGenerateReport={actions.onGenerateReport}
        onViewTransactions={actions.onViewTransactions}
        onSetOpeningBalance={actions.onSetOpeningBalance}
        onMoveAccount={actions.onMoveAccount}
        onDuplicate={actions.onDuplicate}
        onViewHistory={actions.onViewHistory}
        hasFiscalPeriod={hasFiscalPeriod}
        isPeriodClosed={isPeriodClosed}
      />
    </ContextMenu>
  );
}

function TypeSection({
  typeGroup,
  actions,
  periodOBMap,
  isPeriodClosed,
  hasFiscalPeriod,
  canEdit,
  globalAccountsMap,
  movementsMap,
}: {
  typeGroup: TypeGroup;
  actions: AccountRowActions;
  periodOBMap?: Map<string, { debit: number; credit: number }>;
  isPeriodClosed?: boolean;
  hasFiscalPeriod?: boolean;
  canEdit?: boolean;
  globalAccountsMap?: Map<string, MappableAccount>;
  movementsMap?: Map<string, { debit: number; credit: number }>;
}) {
  const [expanded, setExpanded] = useState(true);
  const totalAccounts = typeGroup.categories.reduce((s, c) => s + c.accounts.length, 0) + typeGroup.uncategorized.length;

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td colSpan={4} className="py-2">
          <div className="flex items-center gap-2">
            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${typeColors[typeGroup.type] || "bg-muted text-muted-foreground"}`}>
              {getTypeLabel(typeGroup.type)}
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              {totalAccounts} account{totalAccounts !== 1 ? "s" : ""}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {getNormalBalance(typeGroup.type)} balance · {getStatementPlacement(typeGroup.type)}
            </span>
          </div>
        </td>
      </tr>
      {expanded && typeGroup.categories.map(cat => (
        <CategorySection
          key={cat.id}
          category={cat}
          accountType={typeGroup.type}
          actions={actions}
          periodOBMap={periodOBMap}
          isPeriodClosed={isPeriodClosed}
          hasFiscalPeriod={hasFiscalPeriod}
          canEdit={canEdit}
          globalAccountsMap={globalAccountsMap}
          movementsMap={movementsMap}
        />
      ))}
      {expanded && typeGroup.uncategorized.length > 0 && (
        <>
          <tr className="bg-muted/10">
            <td colSpan={4} style={{ paddingLeft: "32px" }}>
              <span className="text-xs font-semibold text-muted-foreground italic">Uncategorized</span>
            </td>
          </tr>
          {sortTreeByName(buildTree(typeGroup.uncategorized)).map(account => (
            <AccountRow
              key={account.id}
              account={account}
              depth={2}
              actions={actions}
              periodOBMap={periodOBMap}
              isPeriodClosed={isPeriodClosed}
              hasFiscalPeriod={hasFiscalPeriod}
              canEdit={canEdit}
              globalAccountsMap={globalAccountsMap}
              movementsMap={movementsMap}
            />
          ))}
        </>
      )}
    </>
  );
}

function CategorySection({
  category,
  accountType,
  actions,
  periodOBMap,
  isPeriodClosed,
  hasFiscalPeriod,
  canEdit,
  globalAccountsMap,
  movementsMap,
}: {
  category: CategoryGroup;
  accountType: string;
  actions: AccountRowActions;
  periodOBMap?: Map<string, { debit: number; credit: number }>;
  isPeriodClosed?: boolean;
  hasFiscalPeriod?: boolean;
  canEdit?: boolean;
  globalAccountsMap?: Map<string, MappableAccount>;
  movementsMap?: Map<string, { debit: number; credit: number }>;
}) {
  const [expanded, setExpanded] = useState(true);
  const tree = sortTreeByName(buildTree(category.accounts));

  return (
    <>
      <tr
        className="cursor-pointer hover:!bg-muted/20 transition-colors bg-muted/5"
        onClick={() => setExpanded(!expanded)}
      >
        <td colSpan={4} style={{ paddingLeft: "32px" }}>
          <div className="flex items-center gap-2 py-0.5">
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
            <span className="text-xs font-semibold text-foreground/70">{category.name}</span>
            <span className="text-[10px] text-muted-foreground">({category.accounts.length})</span>
          </div>
        </td>
      </tr>
      {expanded && tree.map(account => (
        <AccountRow
          key={account.id}
          account={account}
          depth={2}
          actions={actions}
          periodOBMap={periodOBMap}
          isPeriodClosed={isPeriodClosed}
          hasFiscalPeriod={hasFiscalPeriod}
          canEdit={canEdit}
          globalAccountsMap={globalAccountsMap}
          movementsMap={movementsMap}
        />
      ))}
    </>
  );
}

export default function ChartOfAccounts() {
  const navigate = useNavigate();
  const { appUser } = useAuth();
  const { canEdit: canEditAccounts } = useMyPermissions();
  // Persist whether the create/edit dialog is open (and which account is being
  // edited) so a browser refresh re-opens it. We store only the id, not the
  // whole record.
  const {
    state: createUi,
    setState: setCreateUi,
    clear: clearCreateUi,
  } = usePersistedFormState<{ open: boolean }>("coa-create-ui", { open: false });
  const formOpen = createUi.open;
  const setFormOpen = (open: boolean) => {
    setCreateUi({ open });
    if (!open) clearCreateUi();
  };

  const {
    state: editUi,
    setState: setEditUi,
    clear: clearEditUi,
  } = usePersistedFormState<{ editId: string | null }>("coa-edit-ui", { editId: null });
  const setEditAccount = (acc: Account | null) => {
    if (acc) setEditUi({ editId: acc.id });
    else {
      setEditUi({ editId: null });
      clearEditUi();
    }
  };

  const [parentSeedId, setParentSeedId] = useState<string | null>(null);
  const handleAddChild = (a: Account) => {
    setEditAccount(null);
    setParentSeedId(a.id);
    setFormOpen(true);
  };

  const handleDuplicate = (a: Account) => {
    setEditAccount(null);
    setParentSeedId(null);
    setDuplicateFromAccount(a);
    setFormOpen(true);
  };

  const [deleteAccount, setDeleteAccount] = useState<Account | null>(null);
  const [viewTransactionsAccount, setViewTransactionsAccount] = useState<Account | null>(null);
  const [openingBalanceAccount, setOpeningBalanceAccount] = useState<Account | null>(null);
  const [moveAccount, setMoveAccount] = useState<Account | null>(null);
  const [duplicateFromAccount, setDuplicateFromAccount] = useState<Account | null>(null);
  const [historyAccount, setHistoryAccount] = useState<Account | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [viewMode, setViewMode] = useState<"quickbooks" | "classic">("quickbooks");

  const { data: accounts, isLoading } = useAccounts();

  // Resolve the persisted edit id back to a live account record. If the account
  // no longer exists (e.g. deleted in another tab), this stays null and the
  // edit dialog simply won't re-open.
  const editAccount = useMemo<Account | null>(
    () =>
      editUi.editId
        ? ((accounts as Account[] | undefined)?.find((a) => a.id === editUi.editId) ?? null)
        : null,
    [editUi.editId, accounts]
  );

  const { data: obeBalanceData } = useOBEBalance();
  const { data: categories } = useAccountCategories();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const ensureOBE = useEnsureOBEAccount();
  const createCategory = useCreateAccountCategory();

  const { data: obStatus } = useSystemSetting("opening_balance_status");

  // Lazily guarantee a fiscal period covering today exists for this tenant, so
  // current-year balances/rollups are never gated behind a stale period.
  // Idempotent + self-healing across year rollovers (see RPC).
  useEnsureCurrentFiscalPeriod();

  // Fiscal period selector
  const { data: periods } = useFiscalPeriods();
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const { data: periodBalances } = usePeriodOpeningBalances(selectedPeriodId || null);

  // Auto-select the period that contains today (so balances reflect current
  // activity); fall back to the most recent period if none covers today.
  //
  // This runs ONCE, gated on a separate flag rather than on `!selectedPeriodId`.
  // "All periods" is the empty string, so keying off falsiness made the effect
  // re-fire the moment the user picked it and snap the selector straight back
  // to the current period — "All periods" was unreachable, and with it every
  // balance dated outside the current fiscal year.
  const [periodInitialized, setPeriodInitialized] = useState(false);
  useEffect(() => {
    if (periods?.length && !periodInitialized) {
      const today = new Date().toISOString().slice(0, 10);
      const current = periods.find(
        (p: any) => p.period_start <= today && today <= p.period_end
      );
      const latest = [...periods].sort((a: any, b: any) =>
        b.period_end.localeCompare(a.period_end)
      )[0];
      setSelectedPeriodId((current ?? latest).id);
      setPeriodInitialized(true);
    }
  }, [periods, periodInitialized]);

  // Ensure the single system account (Opening Balance Equity) exists. No bulk seeding.
  const [obeEnsured, setObeEnsured] = useState(false);
  useEffect(() => {
    if (!isLoading && accounts && (accounts as Account[]).length === 0 && !obeEnsured) {
      setObeEnsured(true);
      ensureOBE.mutate();
    }
  }, [isLoading, accounts, obeEnsured]);

  const selectedPeriod = periods?.find((p: any) => p.id === selectedPeriodId) as any;
  const isPeriodClosed = selectedPeriod?.status === "closed";
  const obeDisplay = useMemo(
    () => ({
      balance: Number(obeBalanceData?.balance) || 0,
      type: obeBalanceData?.type === "debit" ? "debit" : "credit",
    }),
    [obeBalanceData]
  );

  const periodOBMap = useMemo(() => {
    const map = new Map<string, { debit: number; credit: number }>();
    (periodBalances || []).forEach((ob: any) => {
      map.set(ob.account_id, { debit: Number(ob.debit) || 0, credit: Number(ob.credit) || 0 });
    });
    return map;
  }, [periodBalances]);

  // Global accounts map for mapping engine — built once, shared by all rows
  const globalAccountsMap = useMemo(() => {
    return buildAccountsMap(((accounts as any[]) || []) as MappableAccount[]);
  }, [accounts]);

  // Posted journal movement per account WITHIN the selected period — used for
  // P&L accounts, which reset each fiscal year. Server-side filtered by period
  // dates, status='posted' and voided_at is null.
  const { data: periodMovements } = usePeriodAccountMovements(
    selectedPeriod
      ? {
          id: selectedPeriod.id,
          period_start: selectedPeriod.period_start,
          period_end: selectedPeriod.period_end,
        }
      : null
  );

  // CUMULATIVE posted movements up to the period end — used for balance-sheet
  // accounts so their displayed figure is the true running current balance
  // (matching the petty cash ledger and OBE balance), reflecting every posted
  // transaction regardless of which period it falls in.
  //
  // Live fallback: if the most-recent period still ends before today (no period
  // covers the current date — e.g. the ensure-RPC hasn't populated yet, or
  // activity is dated beyond every defined period), cut off at null so the true
  // current balance shows rather than silently zeroing out current activity.
  // Explicitly selecting an OLDER period still respects its period_end, so
  // historical "as of" viewing is preserved.
  const cumulativeCutoff = useMemo(() => {
    if (!selectedPeriod) return null;
    const today = new Date().toISOString().slice(0, 10);
    const latestPeriod = [...(periods || [])].sort((a: any, b: any) =>
      b.period_end.localeCompare(a.period_end)
    )[0];
    const isLatest = latestPeriod?.id === selectedPeriod.id;
    if (isLatest && selectedPeriod.period_end < today) return null;
    return selectedPeriod.period_end;
  }, [selectedPeriod, periods]);
  const { data: cumulativeMovements } = useCumulativeAccountMovements(cumulativeCutoff);

  // One movements map for the rows: balance-sheet accounts get cumulative
  // movements, P&L accounts get in-period movements. getAccountDisplayBalance
  // pairs each with the correct opening-balance treatment.
  const movementsMap = useMemo(() => {
    const combined = new Map<string, { debit: number; credit: number }>();
    for (const account of (accounts as Account[] | undefined) || []) {
      // P&L accounts normally show movement WITHIN the selected period, since
      // they reset each fiscal year. But with "All periods" chosen there is no
      // window to scope to, and usePeriodAccountMovements is disabled — which
      // left every Income/Expense account with no movement source at all and
      // blanked its balance to "—". Fall back to the lifetime totals there,
      // which is exactly what "All periods" should mean.
      const src = isPeriodBasedAccount(account.account_type) && selectedPeriod
        ? periodMovements
        : cumulativeMovements;
      const m = src?.get(account.id);
      if (m) combined.set(account.id, m);
    }
    return combined;
  }, [accounts, periodMovements, cumulativeMovements, selectedPeriod]);

  const displayAccounts = useMemo(() => {
    return ((accounts as Account[] | undefined) || []).map((account) =>
      isOpeningBalanceEquityAccount(account)
        ? {
            ...account,
            opening_balance: obeDisplay.balance,
            opening_balance_type: obeDisplay.type,
          }
        : account
    );
  }, [accounts, obeDisplay]);

  const filteredAccounts = useMemo(() => {
    return displayAccounts.filter(a => {
      if (!showInactive && !a.is_active) return false;
      if (filterType !== "all" && a.account_type !== filterType) return false;
      if (search) {
        const s = search.toLowerCase();
        return a.account_code.toLowerCase().includes(s) ||
          a.account_name.toLowerCase().includes(s) ||
          (a.account_subtype || "").toLowerCase().includes(s);
      }
      return true;
    });
  }, [displayAccounts, search, filterType, showInactive]);

  // The category a sub-account is DISPLAYED under is its root ancestor's, not
  // its own. Grouping happens before buildTree, so an account whose category
  // differs from its parent's (typically a child left uncategorized) would be
  // split into another bucket, render as a detached root, and never roll up
  // into its parent's balance. Walking to the root keeps a branch intact.
  const rootCategoryOf = useMemo(() => {
    const byId = new Map(displayAccounts.map(a => [a.id, a]));
    const out = new Map<string, string | null>();
    for (const a of displayAccounts) {
      let node = a;
      const seen = new Set<string>([a.id]);
      while (node.parent_account_id) {
        const parent = byId.get(node.parent_account_id);
        // Missing parent or a cycle: stop and use the highest account reached.
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        node = parent;
      }
      out.set(a.id, node.category_id ?? null);
    }
    return out;
  }, [displayAccounts]);

  // Build Type → Category → Account hierarchy
  const typeGroups = useMemo((): TypeGroup[] => {
    const types = filterType !== "all" ? [filterType] : [...ACCOUNT_TYPES];
    return types.map(type => {
      const typeAccounts = filteredAccounts.filter(a => a.account_type === type);
      const typeCats = (categories || []).filter(c => c.account_type === type);
      const catGroups: CategoryGroup[] = typeCats
        .map(cat => ({
          id: cat.id,
          name: cat.name,
          accounts: typeAccounts.filter(a => rootCategoryOf.get(a.id) === cat.id),
        }))
        .filter(g => g.accounts.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      const categorizedIds = new Set(catGroups.flatMap(g => g.accounts.map(a => a.id)));
      const uncategorized = typeAccounts.filter(a => !categorizedIds.has(a.id));
      return { type, categories: catGroups, uncategorized };
    }).filter(g => g.categories.length > 0 || g.uncategorized.length > 0);
  }, [filteredAccounts, categories, filterType, rootCategoryOf]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    displayAccounts.forEach(a => {
      if (a.is_active || showInactive) counts[a.account_type] = (counts[a.account_type] || 0) + 1;
    });
    return counts;
  }, [displayAccounts, showInactive]);

  // All account codes for uniqueness validation
  const existingCodes = useMemo(() => {
    return new Set((accounts as Account[] | undefined)?.map(a => a.account_code) || []);
  }, [accounts]);

  const handleCreate = async (data: any) => {
    await createAccount.mutateAsync(data);
    setFormOpen(false);
    setParentSeedId(null);
    setDuplicateFromAccount(null);
  };

  const handleEdit = async (data: any) => {
    if (!editAccount) return;
    await updateAccount.mutateAsync({ id: editAccount.id, ...data });
    setEditAccount(null);
  };

  const handleToggleActive = async (account: Account) => {
    await updateAccount.mutateAsync({ id: account.id, is_active: !account.is_active });
  };

  const handleExportCSV = () => {
    if (!accounts) return;
    const rows = [
      ["Code", "Name", "Type", "Detail Type", "Category", "Normal Balance", "Statement", "Status"],
      ...(accounts as Account[]).map(a => [
        a.account_code, a.account_name, a.account_type,
        a.account_subtype || "",
        a.account_categories?.name || "",
        getNormalBalance(a.account_type),
        getStatementPlacement(a.account_type),
        a.is_active ? "Active" : "Inactive",
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "chart-of-accounts.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const activeCount = (accounts as Account[] | undefined)?.filter(a => a.is_active).length || 0;
  const hasEditPermission = canEditAccounts("accounts");

  const accountRowActions: AccountRowActions = {
    onEdit: (a) => setEditAccount(a),
    onToggleActive: handleToggleActive,
    onDelete: (a) => setDeleteAccount(a),
    onGenerateReport: (a) => navigate(`/accounting/accounts/${a.id}/report`),
    onViewTransactions: (a) => setViewTransactionsAccount(a),
    onAddChild: handleAddChild,
    onSetOpeningBalance: (a) => setOpeningBalanceAccount(a),
    onMoveAccount: (a) => setMoveAccount(a),
    onDuplicate: handleDuplicate,
    onViewHistory: (a) => setHistoryAccount(a),
  };

  return (
    <div className="space-y-6">
      <div className="page-header gap-3 flex-nowrap overflow-x-auto">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="page-title whitespace-nowrap">Chart of Accounts</h1>
          <p className="page-description truncate hidden lg:block">
            {viewMode === "quickbooks" ? "Type → Category → Account hierarchy" : "Flat account listing"} ({activeCount} active)
          </p>
        </div>
        <div className="flex gap-2 flex-nowrap items-center shrink-0">
          <FiscalPeriodSelector value={selectedPeriodId} onChange={setSelectedPeriodId} className="shrink-0 [&>select]:max-w-[200px] [&>select]:truncate" />

          {/* View toggle */}
          <div className="flex border border-input rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("quickbooks")}
              className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${viewMode === "quickbooks" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              title="QuickBooks View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Grouped
            </button>
            <button
              onClick={() => setViewMode("classic")}
              className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${viewMode === "classic" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              title="Classic View"
            >
              <LayoutList className="w-3.5 h-3.5" />
              Flat
            </button>
          </div>

          <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={handleExportCSV} disabled={!accounts?.length}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <COAHealthCheck accounts={(accounts as any[]) || []} />
          {hasEditPermission && <Button className="whitespace-nowrap" onClick={() => { setParentSeedId(null); setDuplicateFromAccount(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4" /> Add Account
          </Button>}
        </div>
      </div>

      {/* OB Status Banner */}
      {obStatus === "finalized" && (
        <div className="bg-info/10 text-info text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2">
          Opening balances are finalized — click any balance to view (read-only)
        </div>
      )}
      {(!obStatus || obStatus === "draft") && (
        <div className="bg-info/10 text-info text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2">
          Click any opening balance to edit inline
        </div>
      )}

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setFilterType("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterType === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
        >
          All ({activeCount})
        </button>
        {ACCOUNT_TYPES.map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : `${typeColors[t] || "bg-muted text-muted-foreground"} hover:opacity-80`}`}
          >
            {getTypeLabel(t)} ({typeCounts[t] || 0})
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-input"
          />
          Show inactive
        </label>
      </div>

      <div className="stat-card">
        {/* Search */}
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by code, name, or detail type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">
              {search || filterType !== "all" ? "No matching accounts" : "No accounts yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search || filterType !== "all" ? "Try adjusting your filters." : "No accounts yet. Add your first account to begin."}
            </p>
          </div>
        ) : viewMode === "quickbooks" ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="w-24">Normal Bal.</th>
                <th className="w-36 text-right">Closing Balance</th>
                <th className="w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd)]:!bg-[hsl(var(--success)/16%)] [&>tr:nth-child(even)]:!bg-background">
              {typeGroups.map((tg) => (
                <TypeSection
                  key={tg.type}
                  typeGroup={tg}
                  actions={accountRowActions}
                  periodOBMap={periodOBMap}
                  isPeriodClosed={isPeriodClosed}
                  hasFiscalPeriod={!!selectedPeriodId}
                  canEdit={hasEditPermission}
                  globalAccountsMap={globalAccountsMap}
                  movementsMap={movementsMap}
                />
              ))}
            </tbody>
          </table>
        ) : (
          /* Classic flat view */
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-24">Code</th>
                <th>Name</th>
                <th className="w-24">Type</th>
                <th className="w-36">Category</th>
                <th className="w-36">Detail Type</th>
                <th className="w-24">Normal Bal.</th>
                <th className="w-32 text-right">Closing Balance</th>
                <th className="w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd)]:!bg-[hsl(var(--success)/16%)] [&>tr:nth-child(even)]:!bg-background">
              {filteredAccounts
                .sort((a, b) => a.account_code.localeCompare(b.account_code))
                .map(account => (
                  <FlatAccountRow
                    key={account.id}
                    account={account}
                    actions={accountRowActions}
                    periodOBMap={periodOBMap}
                    isPeriodClosed={isPeriodClosed}
                    hasFiscalPeriod={!!selectedPeriodId}
                    canEdit={hasEditPermission}
                    globalAccountsMap={globalAccountsMap}
                    movementsMap={movementsMap}
                  />
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create form */}
      <AccountForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) { setParentSeedId(null); setDuplicateFromAccount(null); } }}
        onSubmit={handleCreate}
        accounts={(accounts as Account[]) || []}
        categories={categories || []}
        isPending={createAccount.isPending}
        existingCodes={existingCodes}
        defaultParentId={parentSeedId}
        duplicateFrom={duplicateFromAccount}
        onCreateCategory={async (data) => {
          const result = await createCategory.mutateAsync(data);
          return result;
        }}
      />

      {/* Edit form */}
      {editAccount && (
        <AccountForm
          open={!!editAccount}
          onOpenChange={(open) => { if (!open) setEditAccount(null); }}
          onSubmit={handleEdit}
          accounts={(accounts as Account[]) || []}
          categories={categories || []}
          isPending={updateAccount.isPending}
          editAccount={editAccount}
          existingCodes={existingCodes}
          onCreateCategory={async (data) => {
            const result = await createCategory.mutateAsync(data);
            return result;
          }}
        />
      )}

      {/* Delete dialog */}
      <DeleteAccountDialog
        open={!!deleteAccount}
        onOpenChange={(open) => { if (!open) setDeleteAccount(null); }}
        account={deleteAccount}
        allAccounts={(accounts as Account[]) || []}
      />

      {/* View Transactions slide-over */}
      <AccountTransactionsSheet
        account={viewTransactionsAccount}
        open={!!viewTransactionsAccount}
        onOpenChange={(open) => { if (!open) setViewTransactionsAccount(null); }}
      />

      {/* Set Opening Balance */}
      <SetOpeningBalanceDialog
        account={openingBalanceAccount}
        open={!!openingBalanceAccount}
        onOpenChange={(open) => { if (!open) setOpeningBalanceAccount(null); }}
        fiscalPeriodLabel={selectedPeriod?.name}
        isPeriodClosed={isPeriodClosed}
      />

      {/* Move Account */}
      <MoveAccountDialog
        account={moveAccount}
        accounts={(accounts as Account[]) || []}
        accountsMap={globalAccountsMap}
        open={!!moveAccount}
        onOpenChange={(open) => { if (!open) setMoveAccount(null); }}
      />

      {/* Account History */}
      <AccountHistorySheet
        account={historyAccount}
        open={!!historyAccount}
        onOpenChange={(open) => { if (!open) setHistoryAccount(null); }}
        accountsMap={globalAccountsMap}
        categories={categories}
      />
    </div>
  );
}
