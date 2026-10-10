import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    const api = process.env.API_PROXY_URL ?? "http://127.0.0.1:4000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default config;
