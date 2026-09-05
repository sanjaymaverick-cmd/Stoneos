export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function assertStartupConfig(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Fatal: DATABASE_URL is required");
  }
  const secret = process.env.SESSION_SECRET ?? "";
  const placeholders = ["REPLACE_ME", "change-me", "changeme"];
  if (secret.length < 32 || placeholders.some((p) => secret.toLowerCase().includes(p))) {
    throw new Error(
      "Fatal: SESSION_SECRET must be set, at least 32 characters, and not a placeholder",
    );
  }
}

export const SESSION_DAYS = 7;
export const AUTH_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000);
export const AUTH_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
export const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
export const RATE_MAX = Number(process.env.RATE_LIMIT_MAX ?? 120);
export const AUTHENTICATED_RATE_MAX = Number(process.env.AUTHENTICATED_RATE_LIMIT_MAX ?? 600);
