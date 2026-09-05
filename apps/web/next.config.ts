import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@stoneos/contracts", "@stoneos/sync-client"],
};

export default config;
