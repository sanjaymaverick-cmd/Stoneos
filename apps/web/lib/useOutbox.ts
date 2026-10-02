"use client";

import { useCallback, useEffect, useState } from "react";
import type { OutboxItem, SyncResult } from "@stoneos/sync-client";
import { outbox } from "./api";

/**
 * The writes still on this device, and what recently synced.
 *
 * Screens use this to show work the server has not seen yet — a block received at
 * the gate with no signal still belongs in the "cut a block" dropdown.
 */
export function useOutbox(intervalMs = 3000) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [results, setResults] = useState<SyncResult[]>([]);

  const refresh = useCallback(async () => {
    const [queued, synced] = await Promise.all([outbox.list(), outbox.listResults()]);
    setItems(queued);
    setResults(synced);
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
    const timer = setInterval(() => refresh().catch(() => undefined), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { items, results, refresh };
}

/** Queued writes to an exact path, or to paths matching a pattern. */
export function queuedAt(items: OutboxItem[], path: string | RegExp): OutboxItem[] {
  return items.filter((item) =>
    typeof path === "string" ? item.path === path : path.test(item.path),
  );
}

export function bodyOf<T = Record<string, unknown>>(item: OutboxItem): T {
  return (item.body ?? {}) as T;
}

/** Plain words for why a queued write is stuck, from whatever the server sent back. */
export function describeProblem(item: OutboxItem): string | null {
  const conflict = item.conflict as
    | {
        code?: string;
        message?: string | string[];
        droppedSlabs?: Array<{ slabSerial: string; reason: string }>;
        skippedSlabs?: string[];
        parentLabel?: string;
        reason?: string;
      }
    | undefined;
  if (!conflict && !item.dead) return item.heldForAuth ? "Waiting for you to sign in again" : null;
  if (conflict?.code === "SLABS_UNAVAILABLE" && conflict.droppedSlabs?.length) {
    return `Sold first by someone else: ${conflict.droppedSlabs.map((d) => d.slabSerial).join(", ")}. Pick other slabs and enter the order again.`;
  }
  if (conflict?.code === "SLABS_UNAVAILABLE") return "None of these slabs were left. Discard this and enter it again.";
  if (conflict?.code === "PARENT_FAILED") {
    return `Waits on "${conflict.parentLabel ?? "an earlier step"}", which failed. Fix or discard that one first.`;
  }
  if (conflict?.code === "VERSION_CONFLICT") return "Someone changed this record first. Discard and enter it again.";
  const message = Array.isArray(conflict?.message) ? conflict?.message.join(", ") : conflict?.message;
  return message ?? item.lastError ?? "The server refused this.";
}
