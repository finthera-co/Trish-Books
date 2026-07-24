import { buildCanonicalMap, defaultCanonicalEntries } from "../canonicalize";
import type {
  AccountMapEntry,
  AccountMeta,
  CategorizationRule,
  ParsedLine,
  ResolutionContext,
} from "../types";

// Deterministic account ids used across the resolve/validate tests.
export const ACC = {
  bank: "acc-bank",
  salary: "acc-salary",
  bankCharges: "acc-bankcharges",
  rent: "acc-rent",
  harvest: "acc-harvest",
  suspense: "acc-suspense",
  capital: "acc-capital",
  arClearing: "acc-ar-clearing",
  inactive: "acc-inactive",
  header: "acc-header",
};

export function makeAccounts(overrides: Partial<Record<string, Partial<AccountMeta>>> = {}): Map<string, AccountMeta> {
  const base: AccountMeta[] = [
    { id: ACC.bank, isActive: true, isPostable: true, isControlAccount: false },
    { id: ACC.salary, isActive: true, isPostable: true, isControlAccount: false },
    { id: ACC.bankCharges, isActive: true, isPostable: true, isControlAccount: false },
    { id: ACC.rent, isActive: true, isPostable: true, isControlAccount: false },
    { id: ACC.harvest, isActive: true, isPostable: true, isControlAccount: false },
    { id: ACC.suspense, isActive: true, isPostable: true, isControlAccount: false },
    { id: ACC.capital, isActive: true, isPostable: true, isControlAccount: false },
    { id: ACC.arClearing, isActive: true, isPostable: true, isControlAccount: false },
    { id: ACC.inactive, isActive: false, isPostable: true, isControlAccount: false },
    { id: ACC.header, isActive: true, isPostable: false, isControlAccount: false },
  ];
  const map = new Map<string, AccountMeta>();
  for (const a of base) map.set(a.id, { ...a, ...(overrides[a.id] ?? {}) });
  return map;
}

export function makeAccountMap(entries?: AccountMapEntry[]): Map<string, AccountMapEntry> {
  const list: AccountMapEntry[] = entries ?? [
    { id: "map-salary", canonicalCategory: "salary", accountId: ACC.salary, expectedSide: "debit", isActive: true },
    { id: "map-bankcharges", canonicalCategory: "bank_charges", accountId: ACC.bankCharges, expectedSide: "debit", isActive: true },
    { id: "map-rent", canonicalCategory: "building_rent", accountId: ACC.rent, expectedSide: "debit", isActive: true },
    { id: "map-harvest", canonicalCategory: "harvest", accountId: ACC.harvest, expectedSide: "either", isActive: true },
    { id: "map-salaryrev", canonicalCategory: "salary_reversal", accountId: ACC.salary, expectedSide: "credit", isActive: true },
  ];
  return new Map(list.map((e) => [e.canonicalCategory, e]));
}

export function makeCtx(overrides: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    canonicalMap: buildCanonicalMap(defaultCanonicalEntries()),
    accountMap: makeAccountMap(),
    rules: [],
    accounts: makeAccounts(),
    amountCeiling: 100_000_000,
    ...overrides,
  };
}

let rowCounter = 1;

export function makeLine(partial: Partial<ParsedLine> = {}): ParsedLine {
  return {
    sheetName: "May 2024",
    rowIndex: rowCounter++,
    periodMonth: 5,
    periodYear: 2024,
    txnDate: "2024-05-10",
    rawDate: "2024-05-10",
    description: "",
    name: "",
    voucherNo: "",
    rawAccountType: "",
    debit: 0,
    credit: 0,
    bankFee: null,
    balance: null,
    isExcluded: false,
    parseFlags: [],
    ...partial,
  };
}

export function rule(partial: Partial<CategorizationRule> & { matchValue: string; accountId: string }): CategorizationRule {
  return {
    id: `rule-${partial.matchValue}`,
    matchField: "description",
    expectedSide: "either",
    priority: 100,
    isActive: true,
    ...partial,
  };
}
