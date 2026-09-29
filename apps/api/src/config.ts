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

/**
 * Login lockout. Two rounds, both counted per user account and held in the database
 * so a restart does not hand an attacker a fresh counter.
 *
 * 10 wrong passwords lock the account for 5 minutes. After that lock expires, 5 more
 * wrong passwords suspend it outright: the owner has to issue new credentials.
 *
 * The per-IP limiter in http-security.ts is a separate, coarser net and stays.
 */
export const LOGIN_ATTEMPTS_BEFORE_LOCK = Number(process.env.LOGIN_ATTEMPTS_BEFORE_LOCK ?? 10);
export const LOGIN_LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES ?? 5);
export const LOGIN_ATTEMPTS_BEFORE_SUSPEND = Number(process.env.LOGIN_ATTEMPTS_BEFORE_SUSPEND ?? 5);
