"use client";

import { FormEvent, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch, setToken } from "../../../lib/api";

export default function PasswordPage() {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await apiFetch<{ token: string }>("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setToken(result.token);
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    }
  }

  return (
    <AppShell>
      <div className="card">
        <h1>Change password</h1>
        <p>Temporary passwords must be changed before any other write.</p>
        <form onSubmit={onSubmit}>
          <label>Current password<input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required /></label>
          <label>New password (12+ characters)<input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} minLength={12} required /></label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Save</button>
        </form>
      </div>
    </AppShell>
  );
}
