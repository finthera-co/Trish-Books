import { useNavigate } from "react-router-dom";
import { FileText, BookOpen, Scale, DollarSign, TrendingUp } from "lucide-react";
import {
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { isAccountControlled, mapAccountRoute, type MappableAccount } from "@/lib/accountMappingEngine";
import { getStatementPlacement } from "@/lib/accountTypes";

interface RunReportSubmenuProps<T extends MappableAccount & { id: string }> {
  account: T;
  accountsMap: Map<string, MappableAccount>;
  onAccountTransactions: (account: T) => void;
}

/** "Run Report" submenu — every report view scoped to or highlighting this account. */
export default function RunReportSubmenu<T extends MappableAccount & { id: string }>({
  account,
  accountsMap,
  onAccountTransactions,
}: RunReportSubmenuProps<T>) {
  const navigate = useNavigate();

  const isControlled = isAccountControlled(account, accountsMap);
  const subledgerRoute = isControlled ? mapAccountRoute(account, accountsMap) : null;
  const isPnLAccount = getStatementPlacement(account.account_type ?? "") === "Profit & Loss";

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FileText className="w-4 h-4 mr-2" /> Run Report
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onClick={() => navigate(`/accounting/ledger?account=${account.id}&tab=general-ledger`)}>
          <BookOpen className="w-4 h-4 mr-2" /> General Ledger
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAccountTransactions(account)}>
          <FileText className="w-4 h-4 mr-2" /> Account Transactions
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigate(`/accounting/trial-balance?highlight=${account.id}`)}>
          <Scale className="w-4 h-4 mr-2" /> Trial Balance
        </ContextMenuItem>
        <ContextMenuItem onClick={() => navigate(isControlled && subledgerRoute ? subledgerRoute : `/accounting/ledger?account=${account.id}`)}>
          <DollarSign className="w-4 h-4 mr-2" /> Account Balance
        </ContextMenuItem>
        {isPnLAccount && (
          <ContextMenuItem onClick={() => navigate("/reports/financial?report=pnl")}>
            <TrendingUp className="w-4 h-4 mr-2" /> Profit & Loss Impact
          </ContextMenuItem>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
