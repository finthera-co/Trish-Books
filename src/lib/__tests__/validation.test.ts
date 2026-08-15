import { describe, it, expect } from "vitest";
import {
  fieldErrors,
  remainingMessageRoom,
  signupRequestSchema,
  MESSAGE_MAX,
} from "@/lib/validation";
// The edge-function validator imports nothing from Deno, so it can be exercised
// here rather than only in a deployed function.
import {
  arrayOf,
  assertCallerTenant,
  enumOf,
  httpUrl,
  isoDate,
  money,
  optional,
  str,
  uuid,
  validate,
} from "../../../supabase/functions/_shared/validate";

const goodForm = {
  firstName: "Nimal",
  lastName: "Perera",
  companyName: "Ceylon Robotics (Pvt) Ltd",
  email: "Nimal@Company.LK",
  phone: "+94 77 000 0000",
  teamSize: "2-5",
  message: "Migrating two years of books.",
};

describe("signupRequestSchema", () => {
  it("accepts a well-formed application and normalises the email", () => {
    const r = fieldErrors(signupRequestSchema, goodForm);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.email).toBe("nimal@company.lk");
  });

  it("rejects the lengths the INSERT policy would reject", () => {
    const r = fieldErrors(signupRequestSchema, {
      ...goodForm,
      companyName: "x".repeat(201),
      message: "y".repeat(MESSAGE_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.companyName).toBeTruthy();
      expect(r.errors.message).toBeTruthy();
    }
  });

  it("rejects an address the RLS email LIKE test would also reject", () => {
    for (const email of ["nimal", "nimal@", "@company.lk", "nimal@company"]) {
      expect(fieldErrors(signupRequestSchema, { ...goodForm, email }).ok).toBe(false);
    }
  });

  it("leaves room for the generated plan spec on /get-started", () => {
    const spec = "Plan: Lite\nModule packs: none";
    expect(remainingMessageRoom(spec)).toBe(MESSAGE_MAX - spec.length - 4);
    // A note that passes the plain 2000 cap but overflows once the spec is
    // prepended is what this guards — that combination must not fit.
    expect(remainingMessageRoom(spec) < MESSAGE_MAX).toBe(true);
  });
});

describe("edge-function validate()", () => {
  it("reports every bad field at once, not one per round trip", () => {
    const r = validate({ a: "nope", b: -1 }, { a: uuid(), b: money(), c: str(10) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field).sort()).toEqual(["a", "b", "c"]);
  });

  it("rejects the values the old `!amount || amount <= 0` guard let through", () => {
    for (const bad of [Infinity, -Infinity, Number.NaN, 1e15, "abc", {}, [], true]) {
      expect(validate({ amount: bad }, { amount: money() }).ok).toBe(false);
    }
    // A numeric string is coerced rather than passed to Postgres as text.
    const r = validate({ amount: "1250.50" }, { amount: money() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.amount).toBe(1250.5);
  });

  it("only accepts real UUIDs", () => {
    expect(validate({ id: "550e8400-e29b-41d4-a716-446655440000" }, { id: uuid() }).ok).toBe(true);
    for (const bad of ["", "1", "../../etc", "550e8400e29b41d4a716446655440000", null]) {
      expect(validate({ id: bad }, { id: uuid() }).ok).toBe(false);
    }
  });

  it("checks dates are real days, not merely the right shape", () => {
    expect(validate({ d: "2026-02-28" }, { d: isoDate() }).ok).toBe(true);
    for (const bad of ["2026-02-31", "2026-13-01", "26-01-01", "2026/01/01"]) {
      expect(validate({ d: bad }, { d: isoDate() }).ok).toBe(false);
    }
  });

  it("treats absent, null and empty as unset for optional fields", () => {
    const schema = { note: optional(str(10)) };
    for (const raw of [{}, { note: null }, { note: "" }]) {
      const r = validate(raw, schema);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.note).toBeUndefined();
    }
  });

  it("bounds arrays so one request cannot become a bulk job", () => {
    expect(validate({ ids: Array(3).fill("550e8400-e29b-41d4-a716-446655440000") },
      { ids: arrayOf(uuid(), 5) }).ok).toBe(true);
    expect(validate({ ids: Array(6).fill("550e8400-e29b-41d4-a716-446655440000") },
      { ids: arrayOf(uuid(), 5) }).ok).toBe(false);
  });

  it("rejects non-http schemes in a URL destined for an emailed link", () => {
    expect(validate({ u: "https://books.example.lk" }, { u: httpUrl() }).ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "not a url"]) {
      expect(validate({ u: bad }, { u: httpUrl() }).ok).toBe(false);
    }
  });

  it("constrains an enum to its listed values", () => {
    const schema = { action: enumOf(["approve", "reject"] as const) };
    expect(validate({ action: "approve" }, schema).ok).toBe(true);
    expect(validate({ action: "APPROVE" }, schema).ok).toBe(false);
    expect(validate({ action: "delete" }, schema).ok).toBe(false);
  });

  it("rejects a body that is not a JSON object", () => {
    for (const bad of [null, "string", 42, ["a"]]) {
      expect(validate(bad, { a: str(5) }).ok).toBe(false);
    }
  });
});

describe("assertCallerTenant", () => {
  const own = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";

  it("allows a caller to act on their own tenant", () => {
    expect(assertCallerTenant({ tenant_id: own, role_name: "Company Admin" }, own)).toBeNull();
  });

  it("refuses a caller naming another company", () => {
    expect(assertCallerTenant({ tenant_id: own, role_name: "Company Admin" }, other)).toBeTruthy();
  });

  it("refuses an unresolved caller and one with no tenant", () => {
    expect(assertCallerTenant(null, own)).toBe("Unauthorized");
    expect(assertCallerTenant({ tenant_id: null, role_name: "Company Admin" }, own)).toBeTruthy();
  });

  it("lets a Super Admin across, as they are everywhere else", () => {
    expect(assertCallerTenant({ tenant_id: own, role_name: "Super Admin" }, other)).toBeNull();
  });
});
