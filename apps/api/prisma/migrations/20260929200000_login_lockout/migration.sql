-- Login lockout state. Kept on the user row rather than in memory so a restart
-- does not hand an attacker a fresh counter.
ALTER TABLE "app_user"
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3),
  ADD COLUMN "lockout_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "suspended_at" TIMESTAMP(3);
