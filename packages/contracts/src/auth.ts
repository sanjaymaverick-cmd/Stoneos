import { z } from "zod";
import { ROLES } from "./roles.ts";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, "username must be 3-32 lowercase letters, digits, . _ -");

export const passwordSchema = z.string().min(12, "password must be at least 12 characters");

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const provisionUserRequestSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().optional().nullable(),
  role: z.enum(ROLES),
});

export const resetPasswordRequestSchema = z.object({
  userId: z.string().uuid(),
});

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  name: z.string(),
  email: z.string().email().nullable(),
  role: z.enum(ROLES),
  factoryId: z.string().uuid(),
  mustChangePassword: z.boolean(),
  active: z.boolean(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type ProvisionUserRequest = z.infer<typeof provisionUserRequestSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
