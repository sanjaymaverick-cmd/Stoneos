"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { apiFetch } from "../../../lib/api";

export default function AuditPage() {
  const [rows, setRows] = useState<
    Array<{ id: string; action: string; entityType: string; createdAt: string }>
  >([]);
  useEffect(() => {
    apiFetch("/api/v1/audit")
      .then(setRows)
      .catch(() => undefined);
  }, []);
  return (
    <AppShell>
      <h1>Audit log</h1>
      {rows.length === 0 ? (
        <EmptyState>
          No audit events yet. Writes to inventory, production, sales, and team
          appear here.
        </EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {new Date(r.createdAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </td>
                <td title={r.action}>
                  {r.action.replaceAll("_", " ").replaceAll(".", " · ")}
                </td>
                <td>{r.entityType.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
