import { getNormalBalance } from "@/lib/accountTypes";

export interface BalanceSide {
  debit: number;
  credit: number;
}

/**
 * The single source of truth for turning an account's opening balance and its
 * summed posted journal movements into a displayable net balance.
 *
 * Used by the Chart of Accounts (QuickBooks view), the Account Report and the
 * Reports screens so the three never diverge. The arithmetic mirrors the
 * running-balance block in AccountReport: combine opening + movements per side,
 * net them in the account's normal direction, and report the absolute value
 * with the side it lands on.
 *
 * Normal direction is resolved through the canonical
 * `getNormalBalance(accountType, isContra)`, so contra accounts (e.g.
 * Accumulated Depreciation) correctly invert their parent type's normal side.
 *
 * Boundary: an exact-zero net reports the account's NORMAL side (not the
 * opposite), so a fully-netted account still displays on its conventional side.
 */
export function netAccountBalance(args: {
  accountType: string;
  isContra: boolean;
  opening: BalanceSide;
  movements: BalanceSide;
}): { balance: number; type: "debit" | "credit" } {
  const { accountType, isContra, opening, movements } = args;
  const debitNormal = getNormalBalance(accountType, isContra) === "Debit";

  const netDebit = (opening.debit ?? 0) + (movements.debit ?? 0);
  const netCredit = (opening.credit ?? 0) + (movements.credit ?? 0);

  const net = debitNormal ? netDebit - netCredit : netCredit - netDebit;
  const normalSide = debitNormal ? "debit" : "credit";
  const oppositeSide = debitNormal ? "credit" : "debit";

  return {
    balance: Math.abs(net),
    type: net >= 0 ? normalSide : oppositeSide,
  };
}
