export const RECOVERY_BENCHMARK_SQFT_PER_TON = 105;

export function recoveryRatio(soldSqft: number, weightTons: number): number | null {
  if (weightTons <= 0) return null;
  return soldSqft / weightTons;
}

export function recoveryVariance(soldSqft: number, weightTons: number): number | null {
  const ratio = recoveryRatio(soldSqft, weightTons);
  if (ratio === null) return null;
  return ratio - RECOVERY_BENCHMARK_SQFT_PER_TON;
}

export function damagedCostAtRawBlock(
  totalSlabsCut: number,
  damagedCount: number,
  rawBlockCost: number,
): number {
  if (totalSlabsCut <= 0 || damagedCount <= 0) return 0;
  return (rawBlockCost * damagedCount) / totalSlabsCut;
}
