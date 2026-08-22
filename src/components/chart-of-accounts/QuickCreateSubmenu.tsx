import { useNavigate } from "react-router-dom";
import { Plus, Receipt, FileText, HandCoins, Banknote, PenLine, type LucideIcon } from "lucide-react";
import {
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { useMyPermissions } from "@/hooks/usePermissions";
import { resolveSubledgerType, type MappableAccount } from "@/lib/accountMappingEngine";
import { isBankOrCashAccount } from "@/lib/accountTypes";

interface QuickCreateItem {
  key: string;
  label: string;
  icon: LucideIcon;
  route: string;
  /** Permission module key required to show this item; omit for no extra gate. */
  requires?: string;
}

const EXPENSE_TYPES = new Set(["Expense", "Cost of Goods Sold", "Other Expense"]);
const INCOME_TYPES = new Set(["Income", "Other Income"]);

function resolveItems(account: MappableAccount & { id: string }, accountsMap: Map<string, MappableAccount>): QuickCreateItem[] {
  const subledgerType = resolveSubledgerType(account, accountsMap);
  const journalEntry: QuickCreateItem = {
    key: "journal_entry", label: "Journal Entry", icon: PenLine,
    route: `/accounting/journals?prefill_account=${account.id}`, requires: "journals",
  };

  if (subledgerType === "customer") {
    return [
      { key: "invoice", label: "New Invoice", icon: Receipt, route: `/sales/invoices/new?income_account=${account.id}`, requires: "sales" },
      { key: "receive_payment", label: "Receive Payment", icon: HandCoins, route: `/accounting/receive-payment?deposit_to=${account.id}` },
    ];
  }
  if (subledgerType === "vendor") {
    return [
      { key: "bill", label: "New Bill", icon: FileText, route: `/accounting/bills/new?expense_account=${account.id}` },
      { key: "make_payment", label: "Make Payment", icon: Banknote, route: `/banking/write-checks?action=new&from_account=${account.id}`, requires: "banking" },
    ];
  }
  // Fixed-asset / depreciation control accounts are entirely managed by the
  // Assets module (already reachable via "View Fixed Assets Subledger") —
  // nothing to quick-create here.
  if (subledgerType === "fixed_asset" || subledgerType === "asset_depreciation") {
    return [];
  }
  if (account.account_type === "Asset" && isBankOrCashAccount(account)) {
    return [
      { key: "receive_payment", label: "Receive Payment", icon: HandCoins, route: `/accounting/receive-payment?deposit_to=${account.id}` },
      { key: "make_payment", label: "Make Payment", icon: Banknote, route: `/banking/write-checks?action=new&from_account=${account.id}`, requires: "banking" },
      journalEntry,
    ];
  }
  if (INCOME_TYPES.has(account.account_type)) {
    return [
      { key: "invoice", label: "New Invoice", icon: Receipt, route: `/sales/invoices/new?income_account=${account.id}`, requires: "sales" },
      journalEntry,
    ];
  }
  if (EXPENSE_TYPES.has(account.account_type)) {
    return [
      { key: "bill", label: "New Bill", icon: FileText, route: `/accounting/bills/new?expense_account=${account.id}` },
      journalEntry,
    ];
  }
  // Asset (other), Liability, Equity
  return [journalEntry];
}

interface QuickCreateSubmenuProps {
  account: MappableAccount & { id: string; is_active?: boolean; is_postable?: boolean };
  accountsMap: Map<string, MappableAccount>;
}

/** Context-sensitive "Quick Create" submenu, resolved from the account's type/subledger role. */
export default function QuickCreateSubmenu({ account, accountsMap }: QuickCreateSubmenuProps) {
  const navigate = useNavigate();
  const { canEdit } = useMyPermissions();

  if (account.is_active === false || account.is_postable === false) return null;

  const items = resolveItems(account, accountsMap).filter((item) => !item.requires || canEdit(item.requires));
  if (items.length === 0) return null;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Plus className="w-4 h-4 mr-2" /> Quick Create
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {items.map((item) => (
          <ContextMenuItem key={item.key} onClick={() => navigate(item.route)}>
            <item.icon className="w-4 h-4 mr-2" /> {item.label}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
