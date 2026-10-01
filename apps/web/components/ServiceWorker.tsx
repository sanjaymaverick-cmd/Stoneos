"use client";

import { useEffect } from "react";
import { routes } from "../lib/routePolicy";

const WARMED_KEY = "stoneos.sw.warmed";

/** Every screen, so a phone that signed in once online can open any of them offline. */
const SCREENS = ["/", "/login", ...routes.map((route) => route.href), "/muster/payroll"];

/**
 * Ask the service worker to save every screen now, once a day per phone.
 * Called after sign-in is confirmed: before that there is nothing worth saving.
 */
export async function warmOfflineScreens() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const today = new Date().toISOString().slice(0, 10);
  if (window.localStorage.getItem(WARMED_KEY) === today) return;
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: "warm", urls: SCREENS });
  window.localStorage.setItem(WARMED_KEY, today);
}

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
