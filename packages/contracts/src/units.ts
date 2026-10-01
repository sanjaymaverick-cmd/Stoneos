/**
 * The units a yard buys consumables in. A closed list, because stock in "bucket"
 * and stock in "litre" cannot be added up, issued against, or costed. Weight in
 * tons belongs to raw blocks only, never to a consumable.
 */
export const CONSUMABLE_UNITS = ["piece", "litre"] as const;
export type ConsumableUnit = (typeof CONSUMABLE_UNITS)[number];

export function isConsumableUnit(value: unknown): value is ConsumableUnit {
  return typeof value === "string" && (CONSUMABLE_UNITS as readonly string[]).includes(value);
}

/**
 * The heaviest single block a yard can plausibly receive. Real granite blocks run
 * roughly 10–40 tons; anything past this is a typo (kg entered as tons), not stone.
 */
export const MAX_BLOCK_TONS = 60;
