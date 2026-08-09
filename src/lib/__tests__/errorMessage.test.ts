import { describe, it, expect } from "vitest";
import { describeError, describeStepError } from "../errorMessage";

describe("describeError", () => {
  it("reads a PostgrestError, which is a plain object and not an Error instance", () => {
    // The exact shape supabase-js rejects with. `e instanceof Error` is false
    // here, which is why every database failure used to render as "failed".
    const pgErr = { message: "permission denied for table journal_lines", details: null, hint: null, code: "42501" };
    expect(pgErr instanceof Error).toBe(false);
    expect(describeError(pgErr, "Export failed")).toBe(
      "You don't have permission to read part of this report. (permission denied for table journal_lines)"
    );
  });

  it("translates a statement timeout into something the user can act on", () => {
    const timeout = { message: "canceling statement due to statement timeout", code: "57014" };
    expect(describeError(timeout)).toContain("Try a shorter date range");
  });

  it("flags a missing RPC as an un-migrated environment", () => {
    const missing = { message: "Could not find the function public.rpc_gl_account_tree", code: "PGRST202" };
    expect(describeError(missing)).toContain("behind on migrations");
  });

  it("joins message, details and hint for an unrecognised code", () => {
    const err = { message: "bad range", details: "date_to precedes date_from", hint: "swap them", code: "22007" };
    expect(describeError(err)).toBe("bad range — date_to precedes date_from — swap them [22007]");
  });

  it("still reads a real Error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("passes a thrown string straight through", () => {
    expect(describeError("plain failure")).toBe("plain failure");
  });

  it("keeps the code when there is no message at all", () => {
    expect(describeError({ code: "57014" })).toContain("shorter date range");
    expect(describeError({ code: "XX999" }, "Export failed")).toBe("Export failed [XX999]");
  });

  it("falls back for values that carry nothing useful", () => {
    expect(describeError(null, "Export failed")).toBe("Export failed");
    expect(describeError(undefined, "Export failed")).toBe("Export failed");
    expect(describeError({}, "Export failed")).toBe("Export failed");
    expect(describeError(new Error(""), "Export failed")).toBe("Export failed");
  });
});

describe("describeStepError", () => {
  it("names the round trip that failed", () => {
    const e = { message: "canceling statement due to statement timeout", code: "57014" };
    expect(describeStepError("Loading ledger transactions", e, "Excel export failed")).toBe(
      "Loading ledger transactions: The database timed out building this report. Try a shorter date range. (canceling statement due to statement timeout)"
    );
  });
});
