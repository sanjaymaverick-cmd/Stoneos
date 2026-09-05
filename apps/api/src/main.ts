import "reflect-metadata";
import { assertStartupConfig } from "./config";
import { createApp } from "./create-app";

async function boot() {
  if (process.env.NODE_ENV === "production") {
    assertStartupConfig();
  } else if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = "local-dev-session-secret-not-for-production-use";
  }
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
