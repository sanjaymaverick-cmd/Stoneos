"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, flushQueuedWrites, getToken, outbox, setToken } from "../lib/api";
import { visibleRoutes } from "../lib/routePolicy";
import type { PublicUser } from "@stoneos/contracts";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiFetch<PublicUser>("/api/v1/auth/me").then(setUser).catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    const sync = async () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) await flushQueuedWrites().catch(() => undefined);
      setPending((await outbox.list()).length);
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const timer = setInterval(sync, 4000);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      clearInterval(timer);
    };
  }, []);

  if (!user) return <div className="page">Loading…</div>;
  const links = visibleRoutes(user.role);

  return (
    <div className="shell">
      <div className={`sync ${!online ? "offline" : pending ? "pending" : ""}`}>
        {online ? (pending ? `${pending} queued writes` : "Synced") : "Offline — writes queued"}
        {user.mustChangePassword ? " · Change your temporary password" : ""}
      </div>
      <nav className="nav">
        <span className="brand">StoneOS</span>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={pathname.startsWith(link.href) ? "active" : ""}>
            {link.label}
          </Link>
        ))}
        <button
          className="secondary"
          onClick={async () => {
            await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
            setToken(null);
            router.replace("/login");
          }}
        >
          Sign out {user.username}
        </button>
      </nav>
      <main className="page">{children}</main>
    </div>
  );
}
