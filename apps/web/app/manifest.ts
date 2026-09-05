import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StoneOS",
    short_name: "StoneOS",
    description: "Granite factory operations",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#EDEAE4",
    theme_color: "#1C1B1A",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
