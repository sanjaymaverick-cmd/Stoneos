"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, saveToken } from "../../lib/api";
import { useSession } from "../../lib/session";

export default function LoginPage() {
  const { ready, problem, setupNeeded } = useSession();
  const router = useRouter();
  const [factoryName, setFactoryName] = useState("Vedam Granites");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function createOwner(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await api("/api/v1/setup", { body: { factoryName, name, username, password } });
      const result = await api<{ token: string }>("/api/v1/auth/login", {
        body: { username, password },
      });
      saveToken(result.token);
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the login");
      setPending(false);
    }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await api<{ token: string }>("/api/v1/auth/login", {
        body: { username, password },
      });
      saveToken(result.token);
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not sign in");
      setPending(false);
    }
  }

  if (!ready || problem) {
    return <main className="sheet"><p className="waiting">{problem || "Opening…"}</p></main>;
  }

  if (setupNeeded) {
    return (
      <main className="sheet">
        <p className="kicker">New books</p>
        <h1>Create the owner login</h1>
        <p className="lede">Choose the username and password you will use. This login can add the office and the yard.</p>
        <form className="card" onSubmit={(event) => void createOwner(event)}>
          <label>
            Factory name
            <input value={factoryName} onChange={(event) => setFactoryName(event.target.value)} />
          </label>
          <label>
            Your name
            <input value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Username
            <input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
          </label>
          <p className="lede">Use at least 12 characters.</p>
          {error ? <p className="error">{error}</p> : null}
          <div className="actions">
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Create login"}</button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="sheet">
      <p className="kicker">Vedam Granites</p>
      <h1>Sign in</h1>
      <p className="lede">Use the username and password you created.</p>
      <form className="card" onSubmit={(event) => void signIn(event)}>
        <label>
          Username
          <input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        </div>
      </form>
    </main>
  );
}
