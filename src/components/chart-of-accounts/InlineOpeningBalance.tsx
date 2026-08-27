import { useState } from "react";
import { Check, X, Info, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatCurrency } from "@/lib/currency";
import { useSaveAccountOpeningBalance } from "@/hooks/useOpeningBalanceSettings";
import { isOpeningBalanceEligible, OPENING_BALANCE_INELIGIBLE_REASON, requiresSubledger, isControlAccount, getControlAccountModule, getControlAccountRoute, deriveSubledgerFields } from "@/lib/accountTypes";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import SubledgerExpansion from "./SubledgerExpansion";

interface InlineOpeningBalanceProps {
  accountId: string;
  accountType: string;
  accountSubtype?: string | null;
  currentBalance: number;
  currentType: string;
  normalBalance: string;
  isLocked: boolean;
}

export default function InlineOpeningBalance({
  accountId,
  accountType,
  accountSubtype,
  currentBalance,
  currentType,
  normalBalance,
  isLocked,
}: InlineOpeningBalanceProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [balType, setBalType] = useState<"debit" | "credit">("debit");
  const saveMutation = useSaveAccountOpeningBalance();
  const navigate = useNavigate();

  const needsSubledger = requiresSubledger(accountSubtype);
  const controlAccount = isControlAccount(accountSubtype);
  const { subledger_type } = deriveSubledgerFields(accountSubtype);
  const moduleName = getControlAccountModule(subledger_type);
  const moduleRoute = getControlAccountRoute(subledger_type);

  // Income/Expense accounts cannot have an OPENING balance (they reset each
  // fiscal year), but they do have a period balance — and this column is the
  // account's balance, not its opening balance. Showing "N/A" here hid every
  // P&L figure in the Chart of Accounts; show the period movement read-only
  // instead, with the tooltip explaining why it isn't editable.
  if (!isOpeningBalanceEligible(accountType)) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-sm text-foreground/80 cursor-help justify-end">
              {currentBalance ? (
                <>
                  {formatCurrency(currentBalance)}{" "}
                  <span className="text-[10px] text-muted-foreground uppercase">{currentType}</span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              <Info className="w-3 h-3 text-muted-foreground/60" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[260px] text-xs">
            <p className="font-medium mb-1">Period balance</p>
            <p>{OPENING_BALANCE_INELIGIBLE_REASON}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Control accounts: show derived balance with subledger link
  if (controlAccount) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-right">
              {currentBalance ? (
                <button
                  onClick={() => moduleRoute && navigate(moduleRoute)}
                  className="text-sm text-foreground/80 hover:underline cursor-pointer inline-flex items-center gap-1"
                >
                  {formatCurrency(currentBalance)}{" "}
                  <span className="text-[10px] text-muted-foreground uppercase">{currentType}</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </button>
              ) : (
                <button
                  onClick={() => moduleRoute && navigate(moduleRoute)}
                  className="text-xs text-muted-foreground hover:underline cursor-pointer inline-flex items-center gap-1"
                >
                  Managed by {moduleName || "subledger"}
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[280px] text-xs">
            <p className="font-medium mb-1">Control Account</p>
            <p>This balance is derived from {moduleName || "subledger"} transactions. Opening balances must be entered through the {moduleName || "subledger"} module.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (isLocked) {
    return (
      <div>
        {currentBalance ? (
          <span className="text-sm text-foreground/80">
            {formatCurrency(currentBalance)}{" "}
            <span className="text-[10px] text-muted-foreground uppercase">{currentType}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        {needsSubledger && (
          <SubledgerExpansion
            accountId={accountId}
            accountSubtype={accountSubtype}
            controlTotal={currentBalance || 0}
            isLocked={true}
          />
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <div>
      <div className="flex items-center gap-1 justify-end">
          <input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 text-sm border border-input rounded px-2 py-1 bg-background text-foreground text-right focus:outline-none focus:ring-2 focus:ring-ring/20"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                saveMutation.mutate({ accountId, openingBalance: parseFloat(value) || 0, openingBalanceType: balType });
                setEditing(false);
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <select
            value={balType}
            onChange={(e) => setBalType(e.target.value as "debit" | "credit")}
            className="text-[10px] border border-input rounded px-1 py-1 bg-background"
          >
            <option value="debit">Dr</option>
            <option value="credit">Cr</option>
          </select>
          <button
            onClick={() => {
              saveMutation.mutate({ accountId, openingBalance: parseFloat(value) || 0, openingBalanceType: balType });
              setEditing(false);
            }}
            className="p-0.5 rounded hover:bg-success/10 text-success"
            disabled={saveMutation.isPending}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setEditing(false)} className="p-0.5 rounded hover:bg-destructive/10 text-destructive">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {needsSubledger && (
          <SubledgerExpansion
            accountId={accountId}
            accountSubtype={accountSubtype}
            controlTotal={parseFloat(value) || 0}
            isLocked={false}
          />
        )}
      </div>
    );
  }

  return (
    <div className="text-right">
      <button
        onClick={() => {
          setValue(currentBalance?.toString() || "0");
          setBalType((currentType as "debit" | "credit") || (normalBalance === "Debit" ? "debit" : "credit"));
          setEditing(true);
        }}
        className="text-sm w-full hover:underline cursor-pointer text-foreground/80 text-right"
        title="Click to edit opening balance"
      >
        {currentBalance ? (
          <>
            {formatCurrency(currentBalance)}{" "}
            <span className="text-[10px] text-muted-foreground uppercase">{currentType}</span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </button>
      {needsSubledger && currentBalance > 0 && (
        <SubledgerExpansion
          accountId={accountId}
          accountSubtype={accountSubtype}
          controlTotal={currentBalance}
          isLocked={false}
        />
      )}
    </div>
  );
}
