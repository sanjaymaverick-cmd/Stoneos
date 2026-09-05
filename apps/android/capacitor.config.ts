import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.stoneos.android",
  appName: "StoneOS",
  webDir: "../web/out",
  server: {
    url: process.env.STONEOS_WEB_URL || "http://localhost:3000",
    cleartext: true,
  },
};

export default config;
