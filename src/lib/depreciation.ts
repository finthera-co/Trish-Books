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
