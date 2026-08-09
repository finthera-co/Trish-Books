import { describe, it, expect } from "vitest";
import { normalizePhone } from "@/lib/invoiceShare";

describe("WhatsApp phone normalisation", () => {
  it("turns a locally-written Sri Lankan number into an international one", () => {
    // The regression: "0771234567" reached wa.me unchanged and opened the wrong
    // chat, because wa.me has no concept of a local trunk prefix.
    expect(normalizePhone("077 123 4567")).toBe("94771234567");
    expect(normalizePhone("0771234567")).toBe("94771234567");
    expect(normalizePhone("011-2345678")).toBe("94112345678");
  });

  it("leaves an already-international number alone", () => {
    expect(normalizePhone("+94 77 123 4567")).toBe("94771234567");
    expect(normalizePhone("0094771234567")).toBe("94771234567");
    expect(normalizePhone("94771234567")).toBe("94771234567");
  });

  it("assumes the home country for a bare local number", () => {
    expect(normalizePhone("771234567")).toBe("94771234567");
  });

  it("respects a different dial code", () => {
    expect(normalizePhone("07700 900123", "44")).toBe("447700900123");
    expect(normalizePhone("+1 415 555 0132", "44")).toBe("14155550132");
  });

  it("gives nothing back for nothing usable", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("   ")).toBe("");
    expect(normalizePhone("n/a")).toBe("");
  });
});
