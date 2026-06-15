// Single source of truth for how accounts are ordered in every selector/dropdown.

export type SortableAccount = {
  account_code: string;
  account_name: string;
};

// Flip this to "code" to restore numeric Chart-of-Accounts order everywhere.
export const ACCOUNT_SORT_MODE: "name" | "code" = "name";

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function compareAccounts<T extends SortableAccount>(a: T, b: T): number {
  if (ACCOUNT_SORT_MODE === "code") {
    return collator.compare(a.account_code ?? "", b.account_code ?? "");
  }
  // Alphabetical by name, with code as the tie-breaker.
  const byName = collator.compare(a.account_name ?? "", b.account_name ?? "");
  return byName !== 0 ? byName : collator.compare(a.account_code ?? "", b.account_code ?? "");
}

export function sortAccounts<T extends SortableAccount>(list: T[]): T[] {
  return [...list].sort(compareAccounts);
}
