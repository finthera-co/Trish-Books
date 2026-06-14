/**
 * Pure aggregation helpers for the Excel-style PPE (fixed asset) schedule.
 *
 * Every figure here originates from posted ledger data (the `asset_depreciation`
 * rows written by the depreciation engine). Nothing is recomputed from
 * `cost * rate`; FY charges are sums of posted monthly `depreciation_amount`.
 * No I/O — keep these functions referentially transparent so they stay
 * unit-testable and can later feed an Excel export.
 */

/** Fiscal year starts in April (April→March, labelled "YYYY/YYYY+1"). */
export const FISCAL_START_MONTH = 4;

export interface PostedDepRow {
  asset_id: string;
  period: string; // YYYY-MM
  depreciation_amount: number;
  accumulated_depreciation: number;
}

export interface AssetMeta {
  id: string;
  asset_name: string;
  category_id: string | null;
  supplier?: string | null;
  cost: number;
  salvage_value: number;
  acquisition_date: string | null;
  start_date: string | null;
  status: string;
  accumulated_depreciation: number;
}

export interface ScheduleAssetRow {
  id: string;
  asset_name: string;
  supplier: string | null;
  cost: number;
  fyCharges: number[];
  accumulated: number;
  wdv: number;
  isOpening: boolean;
  openingEstimated: boolean;
  disposed: boolean;
  disposalDate?: string | null;
}

export interface CategoryBlock {
  categoryId: string | null;
  category: string;
  fyStartYears: number[];
  fyLabels: string[];
  openingRow: ScheduleAssetRow | null;
  rows: ScheduleAssetRow[];
  totals: { cost: number; fyCharges: number[]; accumulated: number; wdv: number };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const currentPeriod = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** "2024/2025" for a fiscal year that opens in April 2024. */
export function fyLabel(startYear: number): string {
  return `${startYear}/${startYear + 1}`;
}

/** Map a YYYY-MM period to its fiscal year. "2025-03" → FY 2024/2025. */
export function fiscalYearOf(periodYYYYMM: string): { startYear: number; label: string } {
  const [y, m] = periodYYYYMM.split("-").map(Number);
  const startYear = m >= FISCAL_START_MONTH ? y : y - 1;
  return { startYear, label: fyLabel(startYear) };
}

/**
 * Ascending FY start years from the earliest posted period through the FY
 * containing `asOf` (defaults to the current month). With no posted periods,
 * returns a single-element window for the `asOf` fiscal year so the schedule
 * still renders cost/opening columns.
 */
export function deriveFYWindow(periods: string[], asOfYYYYMM?: string): number[] {
  const asOfStart = fiscalYearOf(asOfYYYYMM ?? currentPeriod()).startYear;
  let earliest = asOfStart;
  for (const p of periods) {
    const s = fiscalYearOf(p).startYear;
    if (s < earliest) earliest = s;
  }
  const out: number[] = [];
  for (let y = earliest; y <= asOfStart; y++) out.push(y);
  return out;
}

/**
 * Turn posted depreciation rows + asset metadata into per-category schedule
 * blocks (opening row → addition rows → totals), with one column per fiscal
 * year in `fyStartYears`. The single source feeding both the report and a
 * future export.
 */
export function buildScheduleBlocks(args: {
  assets: AssetMeta[];
  postedRows: PostedDepRow[];
  categories: { id: string; name: string }[];
  disposals?: { asset_id: string; disposal_date: string }[];
  fyStartYears: number[];
}): CategoryBlock[] {
  const { assets, postedRows, categories, disposals = [], fyStartYears } = args;
  const fyLabels = fyStartYears.map(fyLabel);
  const windowStartYear = fyStartYears[0] ?? fiscalYearOf(currentPeriod()).startYear;
  const mm = String(FISCAL_START_MONTH).padStart(2, "0");
  const windowStartPeriod = `${windowStartYear}-${mm}`; // e.g. "2024-04"
  const windowStartDate = `${windowStartYear}-${mm}-01`; // e.g. "2024-04-01"

  const fyIndex = new Map<number, number>();
  fyStartYears.forEach((y, i) => fyIndex.set(y, i));

  // Posted aggregates per asset.
  const chargesByAsset = new Map<string, number[]>();
  const latestAccum = new Map<string, { period: string; accum: number }>();
  const startAccum = new Map<string, { period: string; accum: number }>();
  for (const r of postedRows) {
    const idx = fyIndex.get(fiscalYearOf(r.period).startYear);
    if (idx !== undefined) {
      let arr = chargesByAsset.get(r.asset_id);
      if (!arr) {
        arr = new Array(fyStartYears.length).fill(0);
        chargesByAsset.set(r.asset_id, arr);
      }
      arr[idx] += r.depreciation_amount ?? 0;
    }
    const cur = latestAccum.get(r.asset_id);
    if (!cur || r.period > cur.period) {
      latestAccum.set(r.asset_id, { period: r.period, accum: r.accumulated_depreciation ?? 0 });
    }
    if (r.period < windowStartPeriod) {
      const s = startAccum.get(r.asset_id);
      if (!s || r.period > s.period) {
        startAccum.set(r.asset_id, { period: r.period, accum: r.accumulated_depreciation ?? 0 });
      }
    }
  }

  const disposalByAsset = new Map<string, string>();
  for (const d of disposals) disposalByAsset.set(d.asset_id, d.disposal_date);

  // Cap accumulated depreciation so it never exceeds the depreciable base.
  const cap = (a: AssetMeta, accum: number) => Math.min(accum, Math.max(0, (a.cost ?? 0) - (a.salvage_value ?? 0)));

  // Group assets by resolved category name.
  const catName = new Map<string, string>();
  categories.forEach((c) => catName.set(c.id, c.name));
  const blockOrder: string[] = [];
  const blockAssets = new Map<string, AssetMeta[]>();
  const blockCatId = new Map<string, string | null>();
  for (const a of assets) {
    const name = a.category_id ? (catName.get(a.category_id) ?? "Uncategorised") : "Uncategorised";
    if (!blockAssets.has(name)) {
      blockAssets.set(name, []);
      blockOrder.push(name);
      blockCatId.set(name, a.category_id ?? null);
    }
    blockAssets.get(name)!.push(a);
  }
  blockOrder.sort((a, b) =>
    a === "Uncategorised" ? 1 : b === "Uncategorised" ? -1 : a.localeCompare(b)
  );

  const blocks: CategoryBlock[] = [];
  for (const name of blockOrder) {
    const list = blockAssets.get(name)!;
    const openingAssets: AssetMeta[] = [];
    const additionAssets: AssetMeta[] = [];
    for (const a of list) {
      const acq = a.acquisition_date ?? a.start_date;
      if (acq && acq < windowStartDate) openingAssets.push(a);
      else additionAssets.push(a);
    }

    // Opening row: pre-window assets collapsed into one synthetic row.
    let openingRow: ScheduleAssetRow | null = null;
    if (openingAssets.length > 0) {
      const fyCharges = new Array(fyStartYears.length).fill(0);
      let cost = 0;
      let accumulated = 0;
      let estimated = false;
      for (const a of openingAssets) {
        cost += a.cost ?? 0;
        const ch = chargesByAsset.get(a.id);
        if (ch) for (let i = 0; i < fyCharges.length; i++) fyCharges[i] += ch[i];
        const s = startAccum.get(a.id);
        let ac: number;
        if (s) ac = s.accum;
        else {
          ac = a.accumulated_depreciation ?? 0;
          estimated = true;
        }
        accumulated += cap(a, ac);
      }
      const costR = round2(cost);
      const accR = round2(accumulated);
      openingRow = {
        id: `opening-${blockCatId.get(name) ?? "uncat"}`,
        asset_name: "Opening value",
        supplier: null,
        cost: costR,
        fyCharges: fyCharges.map(round2),
        accumulated: accR,
        wdv: round2(costR - accR),
        isOpening: true,
        openingEstimated: estimated,
        disposed: false,
      };
    }

    // Addition rows: one per in-window asset.
    const rows: ScheduleAssetRow[] = additionAssets.map((a) => {
      const ch = chargesByAsset.get(a.id) ?? new Array(fyStartYears.length).fill(0);
      const la = latestAccum.get(a.id);
      const accumulated = cap(a, la ? la.accum : a.accumulated_depreciation ?? 0);
      const disposed = disposalByAsset.has(a.id) || a.status === "disposed";
      const disposalDate = disposalByAsset.get(a.id) ?? (disposed ? null : undefined);
      const costR = round2(a.cost ?? 0);
      const accR = round2(accumulated);
      return {
        id: a.id,
        asset_name: a.asset_name,
        supplier: a.supplier ?? null,
        cost: costR,
        fyCharges: ch.map(round2),
        accumulated: accR,
        wdv: disposed ? 0 : round2(costR - accR),
        isOpening: false,
        openingEstimated: false,
        disposed,
        disposalDate,
      };
    });

    // Totals: opening + additions; disposed assets drop out of closing
    // accumulated / WDV but keep their cost and in-year charges.
    const totFY = new Array(fyStartYears.length).fill(0);
    let totCost = 0;
    let totAccum = 0;
    let totWdv = 0;
    const allRows = [...(openingRow ? [openingRow] : []), ...rows];
    for (const r of allRows) {
      totCost += r.cost;
      for (let i = 0; i < totFY.length; i++) totFY[i] += r.fyCharges[i];
      if (!r.disposed) {
        totAccum += r.accumulated;
        totWdv += r.wdv;
      }
    }

    blocks.push({
      categoryId: blockCatId.get(name) ?? null,
      category: name,
      fyStartYears,
      fyLabels,
      openingRow,
      rows,
      totals: {
        cost: round2(totCost),
        fyCharges: totFY.map(round2),
        accumulated: round2(totAccum),
        wdv: round2(totWdv),
      },
    });
  }

  return blocks;
}
