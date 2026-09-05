"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch } from "../../../lib/api";
import { STAFF_PROVISIONABLE_ROLES } from "@stoneos/contracts";

export default function UsersPage() {
  const [users, setUsers] = useState<Array<{ id: string; username: string; role: string; active: boolean }>>([]);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("operator");
  const [password, setPassword] = useState<string | null>(null);

  async function refresh() {
    setUsers(await apiFetch("/api/v1/admin/users"));
  }
  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await apiFetch<{ password: string | null }>("/api/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, role }),
    });
    setPassword(result.password);
    setUsername("");
    await refresh();
  }

  return (
    <AppShell>
      <h1>Team access</h1>
      <p>Owners and managers issue credentials. The generated password is shown once.</p>
      <div className="card">
        <form onSubmit={onSubmit}>
          <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label>Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {STAFF_PROVISIONABLE_ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <button type="submit">Issue login</button>
        </form>
        {password ? <p>One-time password: <code>{password}</code></p> : null}
      </div>
      <table>
        <thead><tr><th>Username</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>
          {users.map((u) => <tr key={u.id}><td>{u.username}</td><td>{u.role}</td><td>{String(u.active)}</td></tr>)}
        </tbody>
      </table>
    </AppShell>
  );
}
