import { BadRequestException } from "@nestjs/common";

/** A device may sit offline over a long weekend; anything older is a stuck queue. */
export const MAX_OFFLINE_AGE_MS = 14 * 24 * 3600 * 1000;
/** Phone clocks drift; allow a little, not tomorrow. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * When the work actually happened, for a write that may arrive late.
 *
 * A cut logged at 18:00 and synced at 09:00 next morning belongs to yesterday's
 * operational day. Without this the server stamps the sync time and the DPR moves
 * the work to the wrong shift. Omitted means "now", as before.
 */
export function parseOccurredAt(value: unknown, now: Date = new Date()): Date {
  if (value == null || value === "") return now;
  if (typeof value !== "string") throw new BadRequestException("occurredAt must be an ISO timestamp");
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new BadRequestException("occurredAt must be an ISO timestamp");
  if (at.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new BadRequestException("occurredAt is in the future; check the device clock");
  }
  if (at.getTime() < now.getTime() - MAX_OFFLINE_AGE_MS) {
    throw new BadRequestException("occurredAt is more than 14 days old; enter it as a correction instead");
  }
  return at;
}
