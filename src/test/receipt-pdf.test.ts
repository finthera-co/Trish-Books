import { describe, it, expect, vi } from "vitest";
import { balanceAfterReceipt, receiptStatusLabel } from "@/components/receipts/ReceiptDocument";

// The font files are fetched over HTTP from /public at runtime; jsdom has no
// server, so register them as a no-op and let jsPDF fall back to its base-14
// fonts. These tests are about the layout code running end to end, not glyphs.
vi.mock("@/lib/pdfFonts", () => ({
  NOTO_SANS: "helvetica",
  NOTO_SANS_SINHALA: "helvetica",
  NOTO_SANS_TAMIL: "helvetica",
  JETBRAINS_MONO: "courier",
  registerPdfFonts: vi.fn(async () => {}),
  fontFamilyFor: () => "helvetica",
  needsSinhala: () => false,
  needsTamil: () => false,
}));

const { buildReceiptPdf } = await import("@/lib/receiptPdf");

const company = {
  company_name: "Finthera Ltd.", address: "45 Union Place, Colombo 02",
  phone: "+94 11 555 0000", tax_id: "134567890",
};
const base = {
  receiptNumber: "RCP-20260805-4821", receiptDate: "2026-08-05", receivedFrom: "Acme (Pvt) Ltd",
  customerAddress: "12 Galle Road\nColombo 03", invoiceNumber: "26008_BR03_00042",
  amount: 50000, paymentMethod: "bank_transfer", reference: "TRF-99812",
  invoiceTotal: 106200, balanceDue: 36200, currency: "LKR",
};

describe("receipt balance", () => {
  it("never counts the receipted payment twice", () => {
    // The regression: an unpaid invoice prefills amount FROM the outstanding
    // balance, so deriving total = amount + balance doubled it. The balance
    // must come off the invoice total, leaving nothing owed.
    expect(balanceAfterReceipt(106200, 0, 106200)).toBe(0);
    expect(receiptStatusLabel(balanceAfterReceipt(106200, 0, 106200))).toBe("PAID IN FULL");
  });

  it("accounts for money settled before this receipt", () => {
    expect(balanceAfterReceipt(106200, 20000, 50000)).toBe(36200);
    expect(receiptStatusLabel(balanceAfterReceipt(106200, 20000, 50000))).toBe("PART PAYMENT");
  });

  it("floors at zero on an overpayment and rounds to cents", () => {
    expect(balanceAfterReceipt(100, 0, 250)).toBe(0);
    expect(balanceAfterReceipt(100.1, 0, 33.33)).toBe(66.77);
  });

  it("has no balance, and no status, when not raised against an invoice", () => {
    expect(balanceAfterReceipt(null, 0, 7500)).toBeNull();
    expect(receiptStatusLabel(null)).toBeNull();
  });
});

describe("receipt PDF", () => {
  it("renders a part payment with the full settlement ladder", async () => {
    const doc = await buildReceiptPdf(base, company, null);
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.output("dataurlstring").length).toBeGreaterThan(2000);
  });

  it("renders a receipt that settles the invoice in full", async () => {
    const doc = await buildReceiptPdf({ ...base, amount: 106200, balanceDue: 0 }, company, null);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("renders a standalone receipt with no invoice, notes or company details", async () => {
    const doc = await buildReceiptPdf(
      {
        receiptNumber: "RCP-1", receiptDate: "2026-08-05", receivedFrom: "Walk-in customer",
        amount: 7500, invoiceTotal: null, balanceDue: null,
      },
      {},
      null,
    );
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
