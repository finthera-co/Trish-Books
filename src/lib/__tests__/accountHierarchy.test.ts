import { describe, it, expect } from "vitest";
import {
  flattenAccountTree,
  canCreateChildUnder,
  buildAccountsMap,
  MAX_ACCOUNT_DEPTH,
  type MappableAccount,
} from "@/lib/accountMappingEngine";

const acct = (over: Partial<MappableAccount>): MappableAccount => ({
  id: "x",
  account_code: "1000",
  account_name: "Test",
  account_type: "Asset",
  account_subtype: null,
  parent_account_id: null,
  account_level: 1,
  ...over,
} as MappableAccount);

describe("flattenAccountTree", () => {
  const rows = [
    acct({ id: "a", account_code: "1000", account_level: 1 }),
    acct({ id: "b", account_code: "1010", parent_account_id: "a", account_level: 2 }),
    acct({ id: "c", account_code: "1011", parent_account_id: "b", account_level: 3 }),
    acct({ id: "d", account_code: "2000", account_type: "Liability", account_level: 1 }),
  ];

  it("returns depth-first order with correct depths", () => {
    const out = flattenAccountTree(rows, { accountType: "Asset" });
    expect(out.map(r => [r.account.account_code, r.depth])).toEqual([
      ["1000", 0], ["1010", 1], ["1011", 2],
    ]);
  });

  it("filters by account type", () => {
    const out = flattenAccountTree(rows, { accountType: "Liability" });
    expect(out).toHaveLength(1);
  });

  it("prunes the excluded subtree, not just the node", () => {
    const out = flattenAccountTree(rows, { accountType: "Asset", excludeSubtreeOf: "b" });
    expect(out.map(r => r.account.id)).toEqual(["a"]);
  });

  it("sorts siblings numerically", () => {
    const many = [
      acct({ id: "p", account_code: "1000" }),
      acct({ id: "s9", account_code: "1090", parent_account_id: "p", account_level: 2 }),
      acct({ id: "s1", account_code: "1010", parent_account_id: "p", account_level: 2 }),
    ];
    const out = flattenAccountTree(many, { accountType: "Asset" });
    expect(out.map(r => r.account.account_code)).toEqual(["1000", "1010", "1090"]);
  });
});

describe("canCreateChildUnder", () => {
  const map = buildAccountsMap([]);

  it("blocks at max depth", () => {
    const r = canCreateChildUnder(acct({ account_level: MAX_ACCOUNT_DEPTH }), map);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/depth/i);
  });

  it("allows at depth 4", () => {
    expect(canCreateChildUnder(acct({ account_level: 4 }), map).allowed).toBe(true);
  });

  it("allows but warns under an AR control account", () => {
    const r = canCreateChildUnder(
      acct({ account_subtype: "Accounts Receivable" }),
      map
    );
    expect(r.allowed).toBe(true);
    expect(r.warning).toBeTruthy();
  });

  it("defaults missing account_level to 1", () => {
    expect(canCreateChildUnder(acct({ account_level: undefined }), map).allowed).toBe(true);
  });
});
