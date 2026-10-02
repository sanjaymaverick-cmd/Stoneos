/** ₹1,23,456 — Indian digit grouping, whole rupees unless paise matter. */
export function formatInr(value: number): string {
  if (!Number.isFinite(value)) return "₹0";
  const paise = Math.round(value * 100) % 100 !== 0;
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Today on the factory clock (IST) as YYYY-MM-DD, for date inputs and their `max`. */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

type SlabLike = {
  slabSerial: string;
  varietyName?: string | null;
  lengthFt?: string | number | null;
  widthFt?: string | number | null;
  thicknessMm?: number | null;
};

/** Face area in sqft, or null when the slab was cut without dimensions. */
export function slabSqft(slab: SlabLike): number | null {
  const length = Number(slab.lengthFt);
  const width = Number(slab.widthFt);
  if (!length || !width) return null;
  return Math.round(length * width * 100) / 100;
}

/** "V101/50/01 · Black Galaxy · 9×5.5 ft · 49.5 sqft" — what a salesman picks by. */
export function slabLabel(slab: SlabLike): string {
  const sqft = slabSqft(slab);
  const parts = [slab.slabSerial];
  if (slab.varietyName) parts.push(slab.varietyName);
  if (sqft) parts.push(`${Number(slab.lengthFt)}×${Number(slab.widthFt)} ft`, `${sqft} sqft`);
  if (slab.thicknessMm) parts.push(`${slab.thicknessMm} mm`);
  return parts.join(" · ");
}
