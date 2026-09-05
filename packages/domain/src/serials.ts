export function padSeq(sequence: number, width = 2): string {
  return String(sequence).padStart(width, "0");
}

export function slabSerial(blockSerial: string, totalSlabsCut: number, sequence: number): string {
  if (sequence < 1 || sequence > totalSlabsCut) {
    throw new Error("slab sequence must be between 1 and totalSlabsCut");
  }
  const width = Math.max(2, String(totalSlabsCut).length);
  return `${blockSerial}/${totalSlabsCut}/${padSeq(sequence, width)}`;
}

export function damagedSlabCount(totalSlabsCut: number, finalGoodSlabCount: number): number {
  if (finalGoodSlabCount < 0 || totalSlabsCut < 0) {
    throw new Error("slab counts cannot be negative");
  }
  if (finalGoodSlabCount > totalSlabsCut) {
    throw new Error("good slabs cannot exceed total cut");
  }
  return totalSlabsCut - finalGoodSlabCount;
}
