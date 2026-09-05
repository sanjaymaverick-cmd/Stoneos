import { z } from "zod";

export const clientOpIdSchema = z.string().uuid();

export const syncEnvelopeSchema = z.object({
  clientOpId: clientOpIdSchema,
  baseVersion: z.number().int().nonnegative().optional(),
});

export const conflictResponseSchema = z.object({
  code: z.literal("VERSION_CONFLICT"),
  serverVersion: z.number().int(),
  server: z.unknown(),
});

export type SyncEnvelope = z.infer<typeof syncEnvelopeSchema>;
