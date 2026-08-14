import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PettyCashVoucherDocument, {
  type VoucherModel,
} from "@/components/petty-cash/PettyCashVoucherDocument";

const base: VoucherModel = {
  voucherNumber: "PCV-2026-0007",
  date: "2026-02-05",
  paidTo: "Nimal",
  fundName: "Office Petty Cash",
  status: "approved",
  totalAmount: 1950,
  preparedBy: "Asha Perera",
  authorizedBy: "Ruwan Silva",
  approvedAt: "2026-02-06",
  lines: [
    { id: "1", date: "2026-02-05", description: "diesel", amount: 1200, accountCode: "6150", accountName: "Fuel" },
    { id: "2", date: "2026-02-05", description: "paper", amount: 450, accountCode: "6230", accountName: "Printing & Stationery" },
    { id: "3", date: "2026-02-05", description: "tea", amount: 300, accountCode: "6280", accountName: "Staff Welfare" },
  ],
};

const company = { company_name: "Ceylon Green Life Plantation", address: "Colombo", tax_id: "123456789" };

describe("PettyCashVoucherDocument", () => {
  it("presents the document identity a voucher is recognised by", () => {
    render(<PettyCashVoucherDocument model={base} company={company} />);
    expect(screen.getByText("PETTY CASH VOUCHER")).toBeInTheDocument();
    expect(screen.getByText("PCV-2026-0007")).toBeInTheDocument();
    expect(screen.getByText("Ceylon Green Life Plantation")).toBeInTheDocument();
    expect(screen.getByText("Nimal")).toBeInTheDocument();
    expect(screen.getByText("Office Petty Cash")).toBeInTheDocument();
  });

  it("shows every particular and a total that ties to the lines", () => {
    render(<PettyCashVoucherDocument model={base} company={company} />);
    expect(screen.getByText("diesel")).toBeInTheDocument();
    expect(screen.getByText("paper")).toBeInTheDocument();
    expect(screen.getByText("tea")).toBeInTheDocument();
    expect(screen.getByText(/6150 — Fuel/)).toBeInTheDocument();
    // 1200 + 450 + 300 = 1950, shown as the hero amount and again as the total
    expect(screen.getAllByText(/1,950/).length).toBeGreaterThanOrEqual(2);
  });

  it("writes the amount in words, which is what makes a signed voucher hard to alter", () => {
    render(<PettyCashVoucherDocument model={base} company={company} />);
    expect(screen.getByText(/One Thousand Nine Hundred Fifty/i)).toBeInTheDocument();
  });

  it("shows all three signature lines ON SCREEN, not only when printed", () => {
    // The old page had these as `hidden print:grid`, so what you reviewed on
    // screen was not the document you were signing.
    render(<PettyCashVoucherDocument model={base} company={company} />);
    for (const label of ["Prepared By", "Authorised By", "Received By"]) {
      const el = screen.getByText(label);
      expect(el).toBeInTheDocument();
      expect(el.closest(".hidden")).toBeNull();
    }
    expect(screen.getByText("Asha Perera")).toBeInTheDocument();
    expect(screen.getByText("Ruwan Silva")).toBeInTheDocument();
  });

  it("stamps a reversed voucher and says the ledger is unaffected", () => {
    render(
      <PettyCashVoucherDocument
        model={{ ...base, status: "reversed", reversedAt: "2026-03-01" }}
        company={company}
      />,
    );
    expect(screen.getByText("REVERSED")).toBeInTheDocument();
    expect(screen.getByText(/no longer affects the ledger/i)).toBeInTheDocument();
  });

  it("renders a voucher with no lines without inventing a total", () => {
    render(<PettyCashVoucherDocument model={{ ...base, lines: [], totalAmount: 0 }} company={company} />);
    expect(screen.getByText(/No expense lines/i)).toBeInTheDocument();
  });
});
