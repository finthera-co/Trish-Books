export type Asset = {
  id: string;
  cost: number;
  salvage_value: number;
  useful_life_months: number;
  start_date: string; // YYYY-MM-DD
  status: "active" | "disposed";
};

export type DepreciationRecord = {
  asset_id: string;
  period: string; // YYYY-MM
  depreciation_amount: number;
  accumulated_depreciation: number;
  net_book_value: number;
};

export function calculateMonthlyDepreciation(asset: Asset): number {
  if (asset.useful_life_months <= 0) return 0;
  return (asset.cost - asset.salvage_value) / asset.useful_life_months;
}

export function runDepreciationForAsset(
  asset: Asset,
  previousAccumulated: number
): {
  depreciation: number;
  newAccumulated: number;
  newNBV: number;
} {
  const monthly = calculateMonthlyDepreciation(asset);
  const currentNBV = asset.cost - previousAccumulated;

  // Fully depreciated
  if (currentNBV <= asset.salvage_value) {
    return { depreciation: 0, newAccumulated: previousAccumulated, newNBV: currentNBV };
  }

  // Prevent depreciation below salvage value
  let depreciation = monthly;
  if (currentNBV - monthly < asset.salvage_value) {
    depreciation = currentNBV - asset.salvage_value;
  }

  // Clamp to zero minimum
  depreciation = Math.max(0, depreciation);

  const newAccumulated = previousAccumulated + depreciation;
  const newNBV = asset.cost - newAccumulated;

  return { depreciation, newAccumulated, newNBV };
}

/**
 * Check if a given period (YYYY-MM) is on or after asset start_date month
 */
export function isPeriodEligible(startDate: string, period: string): boolean {
  const [sy, sm] = startDate.split("-").map(Number);
  const [py, pm] = period.split("-").map(Number);
  if (py > sy) return true;
  if (py === sy && pm >= sm) return true;
  return false;
}

/**
 * Generate the full depreciation schedule for an asset
 */
export function generateDepreciationSchedule(asset: Asset): DepreciationRecord[] {
  const records: DepreciationRecord[] = [];
  let accumulated = 0;
  const [startYear, startMonth] = asset.start_date.split("-").map(Number);

  for (let i = 0; i < asset.useful_life_months; i++) {
    const month = ((startMonth - 1 + i) % 12) + 1;
    const year = startYear + Math.floor((startMonth - 1 + i) / 12);
    const period = `${year}-${String(month).padStart(2, "0")}`;

    const { depreciation, newAccumulated, newNBV } = runDepreciationForAsset(asset, accumulated);

    if (depreciation <= 0) break;

    accumulated = newAccumulated;
    records.push({
      asset_id: asset.id,
      period,
      depreciation_amount: Math.round(depreciation * 100) / 100,
      accumulated_depreciation: Math.round(newAccumulated * 100) / 100,
      net_book_value: Math.round(newNBV * 100) / 100,
    });
  }

  return records;
}

/**
 * Generate a REMAINING-LIFE depreciation schedule for a migrated asset.
 *
 * Unlike generateDepreciationSchedule (which starts from accumulated = 0 over the
 * full life), this seeds the schedule with the opening accumulated depreciation
 * already taken before go-live and runs forward from the month AFTER `asOfPeriod`.
 * That way the first post-go-live depreciation run continues from the migrated
 * net book value and does not over-depreciate.
 *
 * @param asset           the migrated asset (cost, salvage, useful life, etc.)
 * @param openingAccumDep accumulated depreciation taken before go-live
 * @param asOfPeriod      the opening-balance period (YYYY-MM); the schedule begins
 *                        the following month
 */
export function generateRemainingLifeSchedule(
  asset: Asset,
  openingAccumDep: number,
  asOfPeriod: string
): DepreciationRecord[] {
  const records: DepreciationRecord[] = [];
  let accumulated = openingAccumDep;
  let [year, month] = asOfPeriod.split("-").map(Number);

  // Go-forward schedule begins the month AFTER the opening-balance date.
  // useful_life_months is a safe upper bound — the loop breaks once the asset is
  // fully depreciated (depreciation <= 0), which happens earlier for migrated assets.
  for (let i = 0; i < asset.useful_life_months; i++) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const period = `${year}-${String(month).padStart(2, "0")}`;

    const { depreciation, newAccumulated, newNBV } = runDepreciationForAsset(asset, accumulated);
    if (depreciation <= 0) break;

    accumulated = newAccumulated;
    records.push({
      asset_id: asset.id,
      period,
      depreciation_amount: Math.round(depreciation * 100) / 100,
      accumulated_depreciation: Math.round(newAccumulated * 100) / 100,
      net_book_value: Math.round(newNBV * 100) / 100,
    });
  }

  return records;
}
