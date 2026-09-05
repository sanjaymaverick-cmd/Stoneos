"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";

export default function MaintenancePage() {
  const [jobs, setJobs] = useState<Array<{ id: string; title: string; dueOn: string; completedAt: string | null; machine: { name: string } }>>([]);
  const [machines, setMachines] = useState<Array<{ id: string; name: string }>>([]);
  const [machineId, setMachineId] = useState("");
  const [title, setTitle] = useState("Blade change");
  const [dueOn, setDueOn] = useState(new Date().toISOString().slice(0, 10));

  async function refresh() {
    const [j, m] = await Promise.all([
      apiFetch<typeof jobs>("/api/v1/maintenance"),
      apiFetch<typeof machines>("/api/v1/machines"),
    ]);
    setJobs(j);
    setMachines(m);
    if (!machineId && m[0]) setMachineId(m[0].id);
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await apiFetch("/api/v1/maintenance", {
      method: "POST",
      body: JSON.stringify({ machineId, title, dueOn }),
    });
    await refresh();
  }

  return (
    <AppShell>
      <h1>Maintenance</h1>
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>Machine
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <label>Due<input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} required /></label>
          <button type="submit">Schedule</button>
        </form>
      </div>
      <table>
        <thead><tr><th>Machine</th><th>Title</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.machine.name}</td>
              <td>{j.title}</td>
              <td>{j.dueOn.slice(0, 10)}</td>
              <td>
                {j.completedAt ? "done" : (
                  <button type="button" onClick={() => apiFetch(`/api/v1/maintenance/${j.id}/complete`, { method: "POST" }).then(refresh)}>Complete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}
