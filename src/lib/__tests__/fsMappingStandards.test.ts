import { describe, it, expect } from "vitest";
import { checkFsLine, fsAccountSide } from "../fsMappingStandards";

const acct = (account_code: string, account_type: string) => ({ account_code, account_type });

describe("fsAccountSide", () => {
  it("classifies both sides and leaves unknown types alone", () => {
    expect(fsAccountSide("Expense")).toBe("debit");
    expect(fsAccountSide("Asset")).toBe("debit");
    expect(fsAccountSide("Income")).toBe("credit");
    expect(fsAccountSide("Equity")).toBe("credit");
    expect(fsAccountSide("Something Else")).toBeNull();
    expect(fsAccountSide(null)).toBeNull();
  });
});

describe("checkFsLine", () => {
  it("passes a clean expense line", () => {
    expect(checkFsLine({ label: "Administrative Expenses", isMemo: false, accounts: [acct("6010", "Expense"), acct("6020", "Expense")] })).toEqual([]);
  });

  it("passes an empty line rather than inventing issues", () => {
    expect(checkFsLine({ label: "Income Tax Expenses", isMemo: false, accounts: [] })).toEqual([]);
  });

  it("flags offsetting and names the minority side", () => {
    const issues = checkFsLine({
      label: "Revenue",
      isMemo: false,
      accounts: [acct("4020", "Income"), acct("4060", "Income"), acct("6010", "Expense")],
    });
    const off = issues.find((i) => i.code === "OFFSETTING");
    expect(off?.reference).toBe("LKAS 1.32");
    expect(off?.accounts).toEqual(["6010"]);
  });

  it("does not call a contra account within one type offsetting", () => {
    // Sales returns typed Income sits on the revenue line legitimately.
    const issues = checkFsLine({ label: "Revenue", isMemo: false, accounts: [acct("4000", "Income"), acct("4090", "Income")] });
    expect(issues).toEqual([]);
  });

  it("flags a balance-sheet account on the face of profit or loss", () => {
    const issues = checkFsLine({ label: "Cost of Sales", isMemo: false, accounts: [acct("5030", "Cost of Goods Sold"), acct("1450", "Asset")] });
    expect(issues.map((i) => i.code)).toContain("BS_ON_FACE");
    expect(issues.find((i) => i.code === "BS_ON_FACE")?.accounts).toEqual(["1450"]);
  });

  it("does not flag balance-sheet accounts in the memorandum block", () => {
    const issues = checkFsLine({ label: "Assets", isMemo: true, accounts: [acct("1450", "Asset"), acct("1460", "Asset")] });
    expect(issues).toEqual([]);
  });

  it("flags income/expense parked outside profit or loss", () => {
    const issues = checkFsLine({ label: "Assets", isMemo: true, accounts: [acct("1450", "Asset"), acct("69000004", "Expense")] });
    const off = issues.find((i) => i.code === "PNL_OFF_FACE");
    expect(off?.reference).toBe("LKAS 1.88");
    expect(off?.accounts).toEqual(["69000004"]);
    // Asset and Expense are both debit-natured, so nothing is being netted
    // here — parking the expense is the only issue with this line.
    expect(issues.map((i) => i.code)).toEqual(["PNL_OFF_FACE"]);
  });
});
