"use client";

import { FormEvent, useState } from "react";
import { apiFetch, setActor, setToken } from "../../lib/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiFetch<{
        token: string;
        user: { id: string; factoryId: string; mustChangePassword: boolean };
      }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      setToken(result.token);
      setActor({ userId: result.user.id, factoryId: result.user.factoryId });
      window.location.href = result.user.mustChangePassword ? "/account/password" : "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 420, margin: "10vh auto" }}>
        <h1>StoneOS</h1>
        <p>Factory staff sign in with credentials issued by an owner or manager. There is no public signup.</p>
        <form onSubmit={onSubmit}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Sign in</button>
        </form>
      </div>
    </main>
  );
}
