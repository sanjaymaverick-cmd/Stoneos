"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, clearToken, readToken } from "./api";

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  userType: "OWNER" | "OFFICE" | "YARD";
  factoryId: string;
  factoryName: string;
}

export function useSession() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState("");
  const [setupNeeded, setSetupNeeded] = useState(false);

  const refresh = useCallback(async () => {
    setProblem("");
    const setup = await api<{ needed: boolean }>("/api/v1/setup");
    if (setup.needed) {
      setUser(null);
      setSetupNeeded(true);
      setReady(true);
      if (pathname !== "/login") router.replace("/login");
      return;
    }
    setSetupNeeded(false);
    const token = readToken();
    if (!token) {
      setUser(null);
      setReady(true);
      if (pathname !== "/login") router.replace("/login");
      return;
    }
    try {
      const me = await api<PublicUser>("/api/v1/auth/me", { token });
      setUser(me);
      setReady(true);
      if (pathname === "/login") router.replace("/");
    } catch {
      clearToken();
      setUser(null);
      setReady(true);
      if (pathname !== "/login") router.replace("/login");
    }
  }, [pathname, router]);

  useEffect(() => {
    void refresh().catch(() => {
      setProblem("The books could not be opened.");
      setReady(true);
    });
  }, [refresh]);

  return { user, ready, problem, setupNeeded };
}
