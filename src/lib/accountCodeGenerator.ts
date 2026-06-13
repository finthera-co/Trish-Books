import { ACCOUNT_NUMBER_RANGES, getSubtypeBand } from "./accountTypes";

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

/**
 * Subtype-aware code generator (QuickBooks-style).
 * Places a new TOP-LEVEL account inside the sub-band for its subtype, stepping
 * by 10 within the band so there's room to insert later. Falls back to the
 * broad type range (existing behaviour) when the subtype has no mapped band.
 *
 * Always returns the lowest free code >= band.min that isn't already used.
 */
export function generateAccountCodeBanded(
  accountType: string,
  subtype: string | null | undefined,
  allAccounts: AccountForCodeGen[]
): string {
  const band = getSubtypeBand(subtype);

  // No mapped band → preserve legacy behaviour exactly.
  if (!band) {
    return generateAccountCode(accountType, null, allAccounts);
  }

  const used = new Set(
    allAccounts
      .map(a => parseInt(a.account_code, 10))
      .filter(n => !isNaN(n))
  );

  // Walk the band in steps of 10 and return the first free slot.
  for (let code = band.min; code <= band.max; code += 10) {
    if (!used.has(code)) return String(code);
  }
  // Band saturated in 10-steps → fall back to 1-steps within the band.
  for (let code = band.min; code <= band.max; code += 1) {
    if (!used.has(code)) return String(code);
  }
  // Band completely full (extremely unlikely) → next free in the type range.
  return generateAccountCode(accountType, null, allAccounts);
}
