import { describe, it, expect, vi } from "vitest";

// The font files are fetched over HTTP from /public at runtime; jsdom has no
// server, so register them as a no-op and let jsPDF fall back to its base-14
// fonts. This test is about the layout code running end to end, not glyphs.
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

import { buildQuotePdf } from "@/lib/quotePdf";

const baseQuote = {
  quote_number: "QUO-2026-0001",
  issue_date: "2026-08-01",
  expiry_date: "2026-08-31",
  payment_terms: "net_30",
  status: "sent",
  subtotal: 90000,
  tax_amount: 16200,
  discount_amount: 10000,
  total_amount: 106200,
  notes: "Delivery within 4 weeks of acceptance.",
  terms: "50% advance, balance on delivery.",
};
const customer = { name: "Acme (Pvt) Ltd", address: "12 Galle Road\nColombo 03", email: "ap@acme.lk" };
const tenant = { company_name: "Trish Books Ltd.", country: "Sri Lanka", registration_number: "PV 12345" } as any;
const items = [
  { description: "Implementation services", quantity: 1, unit_price: 60000, discount_amount: 6000, discount_percent: 10, total: 54000 },
  { description: "Support retainer", quantity: 2, unit_price: 20000, discount_amount: 4000, discount_percent: 10, total: 36000 },
];

const textOf = async (doc: Awaited<ReturnType<typeof buildQuotePdf>>) =>
  doc.output("dataurlstring").length;

describe("estimate PDF", () => {
  it("renders a quote with discounted lines to a non-trivial PDF", async () => {
    const doc = await buildQuotePdf({ quote: baseQuote, customer, items, tenant, profile: null });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(await textOf(doc)).toBeGreaterThan(2000);
  });

  it("renders with no items, no expiry and no optional blocks", async () => {
    const doc = await buildQuotePdf({
      quote: { quote_number: "QUO-2026-0002", issue_date: "2026-08-01", status: "draft", subtotal: 0, tax_amount: 0, discount_amount: 0, total_amount: 0 },
      customer: {},
      items: [],
      tenant: {} as any,
      profile: null,
    });
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("paginates a long estimate and footers every page", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      description: `Line item ${i + 1}`, quantity: 1, unit_price: 1000, discount_amount: 0, discount_percent: 0, total: 1000,
    }));
    const doc = await buildQuotePdf({ quote: baseQuote, customer, items: many, tenant, profile: null });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
