import { z } from "zod";

export const factoryStatusSchema = z.enum([
  "SETUP",
  "OPENING_COUNT_IN_PROGRESS",
  "OPENING_PENDING_APPROVAL",
  "LIVE",
  "LOCKED",
]);

export type FactoryStatus = z.infer<typeof factoryStatusSchema>;
