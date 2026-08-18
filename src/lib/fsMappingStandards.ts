// Standards checks for the statement-mapping screen.
//
// Mapping is where a statement stops being arithmetic and starts being a
// presentation decision, so it is where LKAS 1 / IAS 1 can be broken silently:
// the totals still add up, they just add up the wrong things. These three
// checks are the ones a mapping can get wrong without any figure looking odd.
//
// They are warnings, never blocks. Each has a legitimate exception somewhere in
// the standards (LKAS 1.34 permits some net presentation, for instance), so the
// screen states the rule and the accountant decides.

import { isFsPnlAccountType } from "@/hooks/useFinancialStatements";

export type FsStandardsCode = "OFFSETTING" | "BS_ON_FACE" | "PNL_OFF_FACE";

export interface FsStandardsIssue {
  code: FsStandardsCode;
  /** The paragraph an accountant would cite when challenged on it. */
  reference: string;
  summary: string;
  /** Account codes that triggered it, so the note points somewhere. */
  accounts: string[];
}

export interface FsStandardsAccount {
  account_code: string;
  account_type: string;
}

export interface FsStandardsLine {
  label: string;
  /** True for the memorandum block below the EPS line — presentational rows
   * that sit outside profit or loss by construction. */
  isMemo: boolean;
  accounts: FsStandardsAccount[];
}

const DEBIT_TYPES = ["Asset", "Expense", "Cost of Goods Sold", "Other Expense"];
const CREDIT_TYPES = ["Liability", "Equity", "Income", "Other Income"];

/** Which side of the ledger a type normally sits on. Null for anything the
 * chart of accounts has not classified — unknown is not a violation. */
export function fsAccountSide(accountType: string | null | undefined): "debit" | "credit" | null {
  const t = accountType ?? "";
  if (DEBIT_TYPES.includes(t)) return "debit";
  if (CREDIT_TYPES.includes(t)) return "credit";
  return null;
}

function isBalanceSheetType(t: string): boolean {
  return ["Asset", "Liability", "Equity"].includes(t);
}

export function checkFsLine(line: FsStandardsLine): FsStandardsIssue[] {
  const issues: FsStandardsIssue[] = [];
  if (line.accounts.length === 0) return issues;

  // 1. Offsetting. A statement line is a single net figure, so putting
  //    debit-natured and credit-natured accounts on one line nets one against
  //    the other and the reader can no longer see either.
  const debits = line.accounts.filter((a) => fsAccountSide(a.account_type) === "debit");
  const credits = line.accounts.filter((a) => fsAccountSide(a.account_type) === "credit");
  if (debits.length > 0 && credits.length > 0) {
    // Name the minority side: that is the handful of accounts someone has to
    // look at, not the 60 that belong there.
    const odd = debits.length <= credits.length ? debits : credits;
    issues.push({
      code: "OFFSETTING",
      reference: "LKAS 1.32",
      summary: `Nets ${debits.length} debit-natured against ${credits.length} credit-natured account(s) into one figure. Offsetting is not permitted unless a Standard requires or permits it.`,
      accounts: odd.map((a) => a.account_code),
    });
  }

  // 2. A balance-sheet account on the face of profit or loss. It is not an item
  //    of income or expense, so it cannot be part of the period's result.
  if (!line.isMemo) {
    const bs = line.accounts.filter((a) => isBalanceSheetType(a.account_type));
    if (bs.length > 0) {
      issues.push({
        code: "BS_ON_FACE",
        reference: "LKAS 1.88",
        summary: `${bs.length} asset/liability/equity account(s) sit on the face of profit or loss. Only income and expenses of the period belong there.`,
        accounts: bs.map((a) => a.account_code),
      });
    }
  }

  // 3. The mirror image: income or expense parked in the memorandum block is
  //    excluded from the period's profit altogether.
  if (line.isMemo) {
    const pnl = line.accounts.filter((a) => isFsPnlAccountType(a.account_type));
    if (pnl.length > 0) {
      issues.push({
        code: "PNL_OFF_FACE",
        reference: "LKAS 1.88",
        summary: `${pnl.length} income/expense account(s) are parked outside profit or loss, so the period's result excludes them.`,
        accounts: pnl.map((a) => a.account_code),
      });
    }
  }

  return issues;
}
