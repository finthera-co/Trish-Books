import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BookOpen, List, ExternalLink, Edit2, PenLine, Plus, Power, Trash2, DollarSign, FolderInput, Copy, History, Download } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  isAccountControlled,
  mapAccountRoute,
  getModuleLabel,
  canCreateChildUnder,
  canSetOpeningBalance,
  type MappableAccount,
} from "@/lib/accountMappingEngine";
import { useMyPermissions } from "@/hooks/usePermissions";
import { isOpeningBalanceEligible } from "@/lib/accountTypes";
import { exportAccountTransactionsCsv, exportAccountTransactionsExcel } from "@/lib/accountTransactionsExport";
import RunReportSubmenu from "./RunReportSubmenu";
import QuickCreateSubmenu from "./QuickCreateSubmenu";

interface AccountLike extends MappableAccount {
  id: string;
  account_code: string;
  account_name: string;
  is_active: boolean;
  is_system?: boolean;
}

interface AccountContextMenuProps<T extends AccountLike> {
  account: T;
  accountsMap: Map<string, MappableAccount>;
  canEdit?: boolean;
  onEdit: (account: T) => void;
  onDelete: (account: T) => void;
  onToggleActive: (account: T) => void;
  onGenerateReport: (account: T) => void;
  onViewTransactions: (account: T) => void;
  onAddChild?: (account: T) => void;
  onSetOpeningBalance?: (account: T) => void;
  onMoveAccount?: (account: T) => void;
  onDuplicate?: (account: T) => void;
  onViewHistory?: (account: T) => void;
  /** Whether a fiscal period is currently selected on the page — Set Opening Balance is hidden without one. */
  hasFiscalPeriod?: boolean;
  isPeriodClosed?: boolean;
  className?: string;
}

/**
 * Single source of truth for the account row context menu, shared by the
 * QuickBooks-style tree view (AccountRow) and the Classic flat view
 * (FlatAccountRow).
 *
 * Phase 1: navigation (Open Ledger, View Transactions) plus the existing
 * Edit/Add-child/Deactivate/Delete actions, now all consistently gated behind
 * `canEdit` (previously Edit/Delete were reachable via right-click even
 * without edit permission).
 *
 * Phase 2: Run Report / Quick Create submenus and Enter Journal Entry. These
 * are gated by their own target-module permission (journals/sales/banking),
 * independent of the `canEdit` (accounts) prop that gates account management.
 *
 * Phase 3: Set Opening Balance, Move Account, Duplicate Account — all inside
 * the `canEdit` (accounts) group alongside Edit/Add Sub-account.
 *
 * Phase 4: Account History and Export Transactions — both read-only, so they
 * sit in the always-visible group rather than behind `canEdit`.
 */
export default function AccountContextMenu<T extends AccountLike>({
  account,
  accountsMap,
  canEdit,
  onEdit,
  onDelete,
  onToggleActive,
  onGenerateReport,
  onViewTransactions,
  onAddChild,
  onSetOpeningBalance,
  onMoveAccount,
  onDuplicate,
  onViewHistory,
  hasFiscalPeriod,
  isPeriodClosed,
  className,
}: AccountContextMenuProps<T>) {
  const navigate = useNavigate();
  const { canEdit: canEditModule } = useMyPermissions();

  const isControlled = isAccountControlled(account, accountsMap);
  const subledgerRoute = isControlled ? mapAccountRoute(account, accountsMap) : null;
  const subledgerModule = getModuleLabel(account, accountsMap);
  const childCheck = onAddChild ? canCreateChildUnder(account, accountsMap) : null;

  const canEnterJournalEntry = account.is_active !== false && account.is_postable !== false && canEditModule("journals");

  const obCheck = canSetOpeningBalance(account, accountsMap);
  const showSetOpeningBalance =
    !!onSetOpeningBalance && obCheck.allowed && !!hasFiscalPeriod && isOpeningBalanceEligible(account.account_type ?? "");

  // Move Account only makes sense if there's somewhere else of the same type to move to.
  const hasOtherSameTypeAccount = useMemo(
    () => Array.from(accountsMap.values()).some((a) => a.id !== account.id && a.account_type === account.account_type),
    [accountsMap, account.id, account.account_type]
  );
  const showMoveAccount = !!onMoveAccount && !account.is_system && hasOtherSameTypeAccount;

  const handleOpenLedger = () => {
    if (isControlled && subledgerRoute) {
      navigate(subledgerRoute);
    } else {
      navigate(`/accounting/ledger?account=${account.id}`);
    }
  };

  const handleEnterJournalEntry = () => {
    if (isControlled) {
      toast.warning(`This is a control account. Use the ${subledgerModule ?? "subledger"} module for transactions that require subledger tracking.`);
    }
    navigate(`/accounting/journals?prefill_account=${account.id}`);
  };

  const handleExport = (format: "csv" | "excel") => {
    const exportFn = format === "csv" ? exportAccountTransactionsCsv : exportAccountTransactionsExcel;
    toast.promise(exportFn(account), {
      loading: "Preparing export…",
      success: (count) => (count > 0 ? `Exported ${count} transaction${count !== 1 ? "s" : ""}` : "No transactions to export"),
      error: "Export failed",
    });
  };

  return (
    <ContextMenuContent className={className ?? "w-56"}>
      <ContextMenuItem onClick={handleOpenLedger}>
        <BookOpen className="w-4 h-4 mr-2" /> Open Ledger
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onViewTransactions(account)}>
        <List className="w-4 h-4 mr-2" /> View Transactions
      </ContextMenuItem>
      <RunReportSubmenu account={account} accountsMap={accountsMap} onAccountTransactions={onGenerateReport} />
      {isControlled && subledgerRoute && (
        <ContextMenuItem onClick={() => navigate(subledgerRoute)}>
          <ExternalLink className="w-4 h-4 mr-2" /> View {subledgerModule} Subledger
        </ContextMenuItem>
      )}
      {onViewHistory && (
        <ContextMenuItem onClick={() => onViewHistory(account)}>
          <History className="w-4 h-4 mr-2" /> Account History
        </ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Download className="w-4 h-4 mr-2" /> Export Transactions
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={() => handleExport("csv")}>Export as CSV</ContextMenuItem>
          <ContextMenuItem onClick={() => handleExport("excel")}>Export as Excel</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {canEnterJournalEntry && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleEnterJournalEntry}>
            <PenLine className="w-4 h-4 mr-2" /> Enter Journal Entry
          </ContextMenuItem>
          <QuickCreateSubmenu account={account} accountsMap={accountsMap} />
        </>
      )}
      {canEdit && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onEdit(account)}>
            <Edit2 className="w-4 h-4 mr-2" /> Edit Account
          </ContextMenuItem>
          {onAddChild && (
            <ContextMenuItem
              onClick={() => onAddChild(account)}
              disabled={!childCheck?.allowed}
              title={childCheck?.reason ?? childCheck?.warning ?? undefined}
            >
              <Plus className="w-4 h-4 mr-2" /> Add Sub-account
            </ContextMenuItem>
          )}
          {showSetOpeningBalance && (
            <ContextMenuItem
              onClick={() => onSetOpeningBalance!(account)}
              disabled={isPeriodClosed}
              title={isPeriodClosed ? "This fiscal period is closed" : undefined}
            >
              <DollarSign className="w-4 h-4 mr-2" /> Set Opening Balance
            </ContextMenuItem>
          )}
          {showMoveAccount && (
            <ContextMenuItem onClick={() => onMoveAccount!(account)}>
              <FolderInput className="w-4 h-4 mr-2" /> Move Account
            </ContextMenuItem>
          )}
          {onDuplicate && (
            <ContextMenuItem onClick={() => onDuplicate(account)}>
              <Copy className="w-4 h-4 mr-2" /> Duplicate Account
            </ContextMenuItem>
          )}
          {!account.is_system && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onToggleActive(account)}>
                <Power className="w-4 h-4 mr-2" /> {account.is_active ? "Make Inactive" : "Activate"}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onDelete(account)} className="text-destructive focus:text-destructive">
                <Trash2 className="w-4 h-4 mr-2" /> Delete Account
              </ContextMenuItem>
            </>
          )}
        </>
      )}
    </ContextMenuContent>
  );
}
