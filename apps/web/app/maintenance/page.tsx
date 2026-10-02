"use client";

import { FormEvent, useEffect, useState } from "react";
import { todayIst } from "../../lib/format";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { apiFetch, isQueued, pendingRef, ref } from "../../lib/api";
import { bodyOf, queuedAt, useOutbox } from "../../lib/useOutbox";

export default function MaintenancePage() {
  const [canWrite, setCanWrite] = useState(false);
  const [jobs, setJobs] = useState<
    Array<{
      id: string;
      title: string;
      dueOn: string;
      completedAt: string | null;
      machine: { name: string };
    }>
  >([]);
  const [machines, setMachines] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [machineId, setMachineId] = useState("");
  const [title, setTitle] = useState("Blade change");
  const [dueOn, setDueOn] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const { items, refresh: refreshQueue } = useOutbox();
  const queuedJobs = queuedAt(items, "/api/v1/maintenance");
  const queuedDone = new Set(
    queuedAt(items, /^\/api\/v1\/maintenance\/[^/]+\/complete$/).map(
      (q) => q.path.split("/")[4],
    ),
  );
  const machineName = (id: string) =>
    machines.find((m) => m.id === id)?.name ?? "Machine";

  async function run(action: () => Promise<string>) {
    setError("");
    try {
      setNotice(await action());
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not save");
    }
    await Promise.all([refresh().catch(() => undefined), refreshQueue()]);
  }

  const complete = (target: string, title: string) =>
    run(async () => {
      const result = await apiFetch(`/api/v1/maintenance/${target}/complete`, {
        method: "POST",
        label: `Maintenance done: ${title}`,
        body: JSON.stringify({}),
      });
      return isQueued(result)
        ? `${title} marked done — saved on this phone.`
        : `${title} marked done.`;
    });

  async function refresh() {
    const [j, m] = await Promise.all([
      apiFetch<typeof jobs>("/api/v1/maintenance"),
      apiFetch<typeof machines>("/api/v1/machines"),
    ]);
    setJobs(
      j.sort(
        (a, b) =>
          Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) ||
          a.dueOn.localeCompare(b.dueOn),
      ),
    );
    setMachines(m);
    apiFetch<{ role: string }>("/api/v1/auth/me")
      .then((u) => setCanWrite(u.role !== "operator"))
      .catch(() => undefined);
    if (!machineId && m[0]) setMachineId(m[0].id);
  }
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await apiFetch("/api/v1/maintenance", {
        method: "POST",
        label: `Maintenance: ${title} on ${machineName(machineId)}`,
        body: JSON.stringify({ machineId, title, dueOn }),
      });
      return isQueued(result)
        ? `${title} scheduled — saved on this phone, syncs when online.`
        : `${title} scheduled.`;
    });
  }

  return (
    <AppShell>
      <h1>Machines</h1>
      {canWrite && (
        <div className="card">
          <form onSubmit={onSubmit}>
            <label>
              Machine
              <select
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>
            <label>
              Due
              <input
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                required
              />
            </label>
            <button type="submit">Schedule</button>
          </form>
        </div>
      )}
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {jobs.length === 0 && queuedJobs.length === 0 ? (
        <EmptyState>
          No maintenance jobs scheduled. Use the form above to add the first due
          date.
        </EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Machine</th>
              <th>Title</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {queuedJobs.map((q) => {
              const body = bodyOf<{
                machineId: string;
                title: string;
                dueOn: string;
              }>(q);
              const target = ref(q.clientOpId);
              return (
                <tr key={q.clientOpId}>
                  <td>{machineName(body.machineId)}</td>
                  <td>
                    {body.title}{" "}
                    <span className="pending-tag">
                      not synced
                    </span>
                  </td>
                  <td>{body.dueOn}</td>
                  <td>
                    {queuedDone.has(target) ? (
                      "done (not synced)"
                    ) : body.dueOn > todayIst() ? (
                      "due"
                    ) : !canWrite ? (
                      "overdue"
                    ) : (
                      <button
                        type="button"
                        onClick={() => complete(target, body.title)}
                      >
                        Complete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.machine.name}</td>
                <td>{j.title}</td>
                <td>{j.dueOn.slice(0, 10)}</td>
                <td>
                  {j.completedAt ? (
                    "done"
                  ) : queuedDone.has(j.id) ? (
                    "done (not synced)"
                  ) : j.dueOn.slice(0, 10) > todayIst() ? (
                    "due"
                  ) : !canWrite ? (
                    "overdue"
                  ) : (
                    <>
                      <span>
                        {j.dueOn.slice(0, 10) < todayIst()
                          ? "overdue"
                          : "due"}{" "}
                      </span>
                      <button
                        type="button"
                        onClick={() => complete(j.id, j.title)}
                      >
                        Complete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
