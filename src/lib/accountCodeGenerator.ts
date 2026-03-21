import { ACCOUNT_NUMBER_RANGES } from "./accountTypes";

interface AccountForCodeGen {
  id: string;
  account_code: string;
  account_type: string;
  parent_account_id: string | null;
}

/**
 * Generates the next account code based on hierarchical numbering.
 *
 * Top-level (no parent):  next available in the type range, stepping by 100
 * Child of top-level:     parent code + next 10-increment
 * Sub-child (depth 2+):   parent code + next 1-increment
 */
export function generateAccountCode(
  accountType: string,
  parentAccountId: string | null,
  allAccounts: AccountForCodeGen[]
): string {
  const range = ACCOUNT_NUMBER_RANGES[accountType];
  if (!range) return "";

  const typeAccounts = allAccounts.filter(a => a.account_type === accountType);
  const numericCodes = typeAccounts
    .map(a => parseInt(a.account_code, 10))
    .filter(n => !isNaN(n));

  if (!parentAccountId) {
    // Top-level account: find highest code in range, step by 100
    const topLevel = typeAccounts
      .filter(a => !a.parent_account_id)
      .map(a => parseInt(a.account_code, 10))
      .filter(n => !isNaN(n) && n >= range.min && n <= range.max);

    if (topLevel.length === 0) return String(range.min);

    const maxCode = Math.max(...topLevel);
    // Round up to next 100
    const next = Math.ceil((maxCode + 1) / 100) * 100;
    return next <= range.max ? String(next) : String(maxCode + 1);
  }

  // Child account: find parent's code and determine depth
  const parent = allAccounts.find(a => a.id === parentAccountId);
  if (!parent) return "";

  const parentCode = parseInt(parent.account_code, 10);
  if (isNaN(parentCode)) return "";

  // Determine depth: if parent itself has a parent, we're depth 2+ (step by 1)
  // Otherwise depth 1 (step by 10)
  const isGrandchild = !!parent.parent_account_id;
  const step = isGrandchild ? 1 : 10;

  // Find all direct children of this parent
  const siblings = allAccounts
    .filter(a => a.parent_account_id === parentAccountId)
    .map(a => parseInt(a.account_code, 10))
    .filter(n => !isNaN(n));

  if (siblings.length === 0) {
    return String(parentCode + step);
  }

  const maxSibling = Math.max(...siblings);
  return String(maxSibling + step);
}
