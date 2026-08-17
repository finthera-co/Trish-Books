import { useEffect, useMemo, useState } from "react";

/**
 * Chart colour tokens — the single source of truth for every dashboard chart.
 *
 * Every palette below was validated with the data-viz validator against this
 * app's real surfaces (light card `#ffffff`, dark card `#1c1f26` = `--card`),
 * not against a generic default, so the results hold for what actually renders:
 *
 *   categorical 8   light PASS · dark PASS      (adjacent pairlist)
 *   cash-flow trio  light PASS · dark PASS      (all-pairs; CVD in the 6–8
 *                                                warn band — legal here because
 *                                                inflows/outflows are also
 *                                                separated by the zero baseline
 *                                                and carry direct labels)
 *   profit trio     light PASS · dark PASS      (all-pairs)
 *   aging ramps     light PASS · dark PASS      (ordinal: one hue, monotone L)
 *
 * Rules this module exists to enforce:
 *  - Categorical hues are assigned in fixed order and NEVER cycled. Past slot 8
 *    a series folds into `CATEGORICAL_OTHER`, it does not get a generated hue.
 *  - Dark mode is a *selected* set of steps, not an automatic flip of the light
 *    values, so each step clears 3:1 against the dark card.
 *  - Chart chrome (grid, axis, tooltip) is read from the app's CSS custom
 *    properties, so it follows the theme and any tenant re-brand for free.
 */

type Pair = { light: string; dark: string };

const pick = (pair: Pair, isDark: boolean) => (isDark ? pair.dark : pair.light);

/**
 * Categorical slots, in fixed assignment order. Used for identity-only series
 * (expense categories). Light-mode slots 3/4/5 sit below 3:1 on white — the
 * relief rule applies, so any chart using them must ship visible direct labels
 * (the expense legend does).
 */
export const CATEGORICAL: Pair[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

/** Everything past slot 8 collapses here — deliberately neutral, never a hue. */
export const CATEGORICAL_OTHER: Pair = { light: "#8a8f98", dark: "#767c87" };

/**
 * Semantic series roles. `inflow`/`outflow` reuse the aqua and red steps: in
 * finance the in/out convention is load-bearing, and the CVD risk of the pair
 * is covered by the zero-baseline split plus the legend and stat tiles.
 */
export const SERIES = {
  inflow: { light: "#1baf7a", dark: "#199e70" },
  outflow: { light: "#e34948", dark: "#e66767" },
  net: { light: "#2a78d6", dark: "#3987e5" },
  margin: { light: "#4a3aa7", dark: "#9085e9" },
  revenue: { light: "#2a78d6", dark: "#3987e5" },
  expense: { light: "#e34948", dark: "#e66767" },
  positive: { light: "#1baf7a", dark: "#199e70" },
  negative: { light: "#e34948", dark: "#e66767" },
} satisfies Record<string, Pair>;

/**
 * Aging buckets are an *ordinal* encoding (Current → 120+), so each chart gets
 * one hue stepped by lightness rather than a green→red rainbow. Contrast
 * against the surface rises with age in both modes, so the oldest bucket always
 * carries the most visual weight. Receivables and payables take different hues
 * because the two cards sit side by side.
 */
export const AGING_RAMP = {
  receivable: {
    light: ["#79b4ff", "#5b9def", "#4586d7", "#2f70bf", "#165aa7", "#00468c"],
    dark: ["#07519d", "#2466b4", "#3b7ccc", "#5193e4", "#67a9fd", "#91c1ff"],
  },
  payable: {
    light: ["#ff9a64", "#ec8246", "#d46c2f", "#bd5711", "#a24700", "#853900"],
    dark: ["#8d3d00", "#ad4b00", "#c7601f", "#df763a", "#f88d52", "#ffae85"],
  },
} satisfies Record<string, { light: string[]; dark: string[] }>;

/** Tracks the `dark` class on <html>, whoever set it (next-themes, tenant sync). */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const el = document.documentElement;
    const read = () => setIsDark(el.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

/** Resolve a design-system CSS custom property to a usable colour string. */
function readToken(name: string, fallback: string, alpha?: number): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  return alpha === undefined ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
}

export interface ChartTheme {
  isDark: boolean;
  /** Recessive hairline grid. */
  grid: string;
  /** Axis line + tick label ink. */
  axis: string;
  /** Zero / reference line — one step stronger than the grid. */
  baseline: string;
  /** Card surface, for the 2px spacer ring between adjacent fills. */
  surface: string;
  /** Brand primary, resolved — `var()` does not work in SVG attributes. */
  primary: string;
  cursorFill: string;
  tooltip: {
    contentStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
    itemStyle: React.CSSProperties;
  };
  legendStyle: React.CSSProperties;
  /** Semantic series colours already resolved for the active mode. */
  series: Record<keyof typeof SERIES, string>;
  /** Categorical slots resolved for the active mode, in fixed order. */
  categorical: string[];
  categoricalOther: string;
  aging: { receivable: string[]; payable: string[] };
}

/**
 * Resolved colours for the active theme. Recharts renders colours as SVG
 * presentation attributes, where `var()` does not resolve — so tokens must be
 * read in JS rather than passed through as `hsl(var(--border))` strings.
 */
export function useChartTheme(): ChartTheme {
  const isDark = useIsDark();

  return useMemo(() => {
    const grid = readToken("--border", isDark ? "#2c313a" : "#e5e7eb");
    const axis = readToken("--muted-foreground", isDark ? "#8b93a1" : "#7d838f");
    const baseline = readToken("--muted-foreground", isDark ? "#8b93a1" : "#7d838f", 0.45);
    const surface = readToken("--card", isDark ? "#1c1f26" : "#ffffff");

    return {
      isDark,
      grid,
      axis,
      baseline,
      surface,
      primary: readToken("--primary", isDark ? "#22c55e" : "#1eaa4d"),
      cursorFill: readToken("--foreground", isDark ? "#f4f6f5" : "#16181d", 0.06),
      tooltip: {
        contentStyle: {
          borderRadius: 10,
          border: `1px solid ${grid}`,
          backgroundColor: readToken("--popover", isDark ? "#21242c" : "#ffffff"),
          color: readToken("--popover-foreground", isDark ? "#f4f6f5" : "#16181d"),
          fontSize: 12,
          boxShadow: isDark
            ? "0 8px 24px -8px rgb(0 0 0 / 0.6)"
            : "0 8px 24px -8px rgb(15 23 42 / 0.18)",
        },
        labelStyle: {
          color: readToken("--foreground", isDark ? "#f4f6f5" : "#16181d"),
          fontWeight: 600,
          marginBottom: 4,
        },
        itemStyle: { color: readToken("--popover-foreground", isDark ? "#f4f6f5" : "#16181d") },
      },
      legendStyle: { fontSize: 11, color: axis },
      series: Object.fromEntries(
        Object.entries(SERIES).map(([key, pair]) => [key, pick(pair, isDark)])
      ) as ChartTheme["series"],
      categorical: CATEGORICAL.map((pair) => pick(pair, isDark)),
      categoricalOther: pick(CATEGORICAL_OTHER, isDark),
      aging: {
        receivable: isDark ? AGING_RAMP.receivable.dark : AGING_RAMP.receivable.light,
        payable: isDark ? AGING_RAMP.payable.dark : AGING_RAMP.payable.light,
      },
    };
  }, [isDark]);
}

/**
 * Assign categorical colours by fixed slot, folding everything past slot 8 into
 * a single neutral "Other" bucket rather than cycling hues.
 */
export function foldToPalette<T>(
  items: T[],
  valueOf: (item: T) => number,
  labelOf: (item: T) => string,
  otherLabel = "Other"
): { label: string; value: number; slot: number; isOther: boolean }[] {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const head = sorted.slice(0, CATEGORICAL.length);
  const tail = sorted.slice(CATEGORICAL.length);

  const folded = head.map((item, i) => ({
    label: labelOf(item),
    value: valueOf(item),
    slot: i,
    isOther: false,
  }));

  if (tail.length > 0) {
    folded.push({
      label: `${otherLabel} (${tail.length})`,
      value: tail.reduce((sum, item) => sum + valueOf(item), 0),
      slot: -1,
      isOther: true,
    });
  }

  return folded;
}
