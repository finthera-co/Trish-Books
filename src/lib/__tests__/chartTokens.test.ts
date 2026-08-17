import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChartTheme, foldToPalette, CATEGORICAL, AGING_RAMP } from "@/lib/chartTokens";
import { formatCurrencyShort, formatCompactAmount, formatCurrency } from "@/lib/currency";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
});

describe("money formatting", () => {
  it("keeps the sign on negative amounts", () => {
    // The bug this guards: `LKR ${Math.abs(n)}` rendered a loss and a profit of
    // the same magnitude with identical glyphs.
    expect(formatCurrencyShort(-500_000)).toBe("(LKR 500,000)");
    expect(formatCurrencyShort(500_000)).toBe("LKR 500,000");
    expect(formatCurrencyShort(-500_000)).not.toBe(formatCurrencyShort(500_000));
  });

  it("drops decimals in the short form but keeps them in the long form", () => {
    expect(formatCurrencyShort(1234.56)).toBe("LKR 1,235");
    expect(formatCurrency(1234.56)).toBe("LKR 1,234.56");
  });

  it("scales axis ticks past thousands", () => {
    expect(formatCompactAmount(450)).toBe("450");
    expect(formatCompactAmount(45_000)).toBe("45k");
    expect(formatCompactAmount(1_200_000)).toBe("1.2M");
    expect(formatCompactAmount(45_000_000)).toBe("45M");
    expect(formatCompactAmount(2_400_000_000)).toBe("2.4B");
    expect(formatCompactAmount(-45_000)).toBe("-45k");
  });
});

describe("foldToPalette", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `cat-${i}`, value: n - i }));

  it("assigns fixed slots in descending value order", () => {
    const folded = foldToPalette(make(4), (d) => d.value, (d) => d.name);
    expect(folded.map((f) => f.slot)).toEqual([0, 1, 2, 3]);
    expect(folded.map((f) => f.label)).toEqual(["cat-0", "cat-1", "cat-2", "cat-3"]);
  });

  it("never cycles the palette — the 9th category folds into one Other bucket", () => {
    const folded = foldToPalette(make(12), (d) => d.value, (d) => d.name);
    expect(folded).toHaveLength(CATEGORICAL.length + 1);

    const slots = folded.filter((f) => !f.isOther).map((f) => f.slot);
    expect(new Set(slots).size).toBe(slots.length); // no colour reuse

    const other = folded.at(-1)!;
    expect(other.isOther).toBe(true);
    expect(other.label).toBe("Other (4)");
    // 12 categories with values 12..1; slots take the top 8 (12..5), Other = 4+3+2+1.
    expect(other.value).toBe(10);
  });

  it("omits the Other bucket when everything fits", () => {
    expect(foldToPalette(make(8), (d) => d.value, (d) => d.name).some((f) => f.isOther)).toBe(false);
  });
});

describe("useChartTheme", () => {
  it("selects the light steps by default and the dark steps under .dark", async () => {
    const { result } = renderHook(() => useChartTheme());

    expect(result.current.isDark).toBe(false);
    expect(result.current.series.inflow).toBe("#1baf7a");
    expect(result.current.aging.receivable).toEqual(AGING_RAMP.receivable.light);

    // MutationObserver delivers on a microtask, so flush before asserting.
    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });

    expect(result.current.isDark).toBe(true);
    expect(result.current.series.inflow).toBe("#199e70");
    expect(result.current.aging.receivable).toEqual(AGING_RAMP.receivable.dark);
  });

  it("resolves chrome from CSS custom properties rather than emitting var()", () => {
    // var() does not resolve inside SVG presentation attributes, so the theme
    // must hand recharts a concrete colour.
    document.documentElement.style.setProperty("--border", "220 15% 20%");
    const { result } = renderHook(() => useChartTheme());

    expect(result.current.grid).toBe("hsl(220 15% 20%)");
    expect(result.current.grid).not.toContain("var(");
    expect(result.current.tooltip.contentStyle.backgroundColor).not.toContain("var(");
  });

  it("falls back to a literal colour when the token is missing", () => {
    const { result } = renderHook(() => useChartTheme());
    expect(result.current.grid).toMatch(/^#/);
  });
});
