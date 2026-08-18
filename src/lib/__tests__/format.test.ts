import { describe, it, expect } from "vitest";
import {
  formatDate, formatDateTime, formatDateTimeSeconds, formatDateTick,
  formatTime, formatDateWithWeekday, formatMonth, formatInvoiceDate,
} from "@/lib/format";

describe("the DD/MM/YYYY date standard", () => {
  it("renders a date-only ISO string in day/month/year order", () => {
    expect(formatDate("2026-08-18")).toBe("18/08/2026");
  });

  it("zero-pads single-digit days and months so columns stay aligned", () => {
    expect(formatDate("2026-01-05")).toBe("05/01/2026");
  });

  it("accepts a Date as readily as a string", () => {
    expect(formatDate(new Date(2026, 7, 18))).toBe("18/08/2026");
  });

  /**
   * `new Date("2026-08-01")` is UTC midnight by spec, so a naive implementation
   * renders 31/07 for any viewer west of Greenwich — an opening entry would
   * fall into the wrong period. Date-only strings must stay on their own day.
   */
  it("does not shift a date-only string across the timezone boundary", () => {
    expect(formatDate("2026-08-01")).toBe("01/08/2026");
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
  });

  it("reads a full timestamp down to the minute", () => {
    expect(formatDateTime(new Date(2026, 7, 18, 15, 45))).toBe("18/08/2026 15:45");
    expect(formatDateTimeSeconds(new Date(2026, 7, 18, 15, 45, 9))).toBe("18/08/2026 15:45:09");
    expect(formatTime(new Date(2026, 7, 18, 9, 5))).toBe("09:05");
  });

  it("keeps day/month order in the abbreviated chart tick", () => {
    expect(formatDateTick("2026-08-18")).toBe("18/08");
  });

  it("keeps the weekday as context but the date in standard form", () => {
    expect(formatDateWithWeekday("2026-08-18")).toBe("Tuesday, 18/08/2026");
  });

  it("names a month bucket rather than a day", () => {
    expect(formatMonth("2026-08-18")).toBe("Aug 2026");
  });

  it("renders nothing rather than an Invalid Date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });

  it("routes the document alias to the same standard", () => {
    expect(formatInvoiceDate("2026-08-18")).toBe(formatDate("2026-08-18"));
  });
});
