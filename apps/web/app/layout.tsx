import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorker } from "../components/ServiceWorker";

export const metadata: Metadata = {
  title: "StoneOS",
  description: "Granite factory operations",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}
