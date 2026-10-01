"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, clearCachedReads, flushQueuedWrites, getToken, outbox, setActor, setToken } from "../lib/api";
import { summariseOutbox } from "@stoneos/sync-client";
import { visibleRoutes } from "../lib/routePolicy";
import { warmOfflineScreens } from "./ServiceWorker";
import type { PublicUser } from "@stoneos/contracts";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [queue, setQueue] = useState({ pending: 0, blocked: 0, conflicts: 0, dead: 0, needsAttention: 0 });
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiFetch<PublicUser>("/api/v1/auth/me")
      .then((u) => {
        setUser(u);
        setActor({ userId: u.id, factoryId: u.factoryId });
        warmOfflineScreens().catch(() => undefined);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    const sync = async () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) await flushQueuedWrites().catch(() => undefined);
      setQueue(summariseOutbox(await outbox.list()));
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

  // Work that needs a person is never reported as "Synced", and never hides behind a
  // plain queue count. A stuck entry the operator cannot see is the same as lost.
  const { pending, blocked, conflicts, dead, needsAttention } = queue;
  const syncTone = needsAttention ? "stuck" : !online ? "offline" : pending || blocked ? "pending" : "";
  const syncLabel = needsAttention
    ? [
        conflicts ? `${conflicts} conflicted` : null,
        dead ? `${dead} failed` : null,
      ]
        .filter(Boolean)
        .join(" · ") + " — needs attention, nothing was lost"
    : blocked
      ? `${blocked + pending} queued — waiting for you to sign in again`
      : !online
        ? "Offline — writes queued"
        : pending
          ? `${pending} queued writes`
          : "Synced";

  return (
    <div className="shell">
      <Link href="/sync" className={`sync ${syncTone}`}>
        {syncLabel}
        {user.mustChangePassword ? " · Change your temporary password" : ""}
      </Link>
      <nav className="nav">
        <span className="brand">StoneOS</span>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={pathname.startsWith(link.href) ? "active" : ""}>
            {link.label}
          </Link>
        ))}
        <span className="muted" title="Signed in as">{user.username}</span>
        <button
          className="secondary"
          onClick={async () => {
            await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
            setToken(null);
            setActor(null);
            await clearCachedReads();
            router.replace("/login");
          }}
        >
          Sign out
        </button>
      </nav>
      <main className="page">{children}</main>
    </div>
  );
}
