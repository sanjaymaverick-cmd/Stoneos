"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, api, readToken } from "../../lib/api";
import { userTypeLabel } from "../../lib/labels";
import { useSession, type PublicUser } from "../../lib/session";

export default function PeoplePage() {
  const { user, ready, problem } = useSession();
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userType, setUserType] = useState<"OFFICE" | "YARD">("OFFICE");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function load() {
    const token = readToken();
    if (!token) return;
    setPeople(await api<PublicUser[]>("/api/v1/users", { token }));
  }

  useEffect(() => {
    if (user?.userType === "OWNER") void load().catch((caught) => {
      setError(caught instanceof ApiError ? caught.message : "Could not load people");
    });
  }, [user]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const token = readToken();
    if (!token) return;
    setError("");
    setPending(true);
    try {
      await api("/api/v1/users", { token, body: { name, username, password, userType } });
      setName("");
      setUsername("");
      setPassword("");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add this person");
    } finally {
      setPending(false);
    }
  }

  if (!ready || !user) {
    return <main className="sheet"><p className="waiting">{problem || "Opening…"}</p></main>;
  }
  if (user.userType !== "OWNER") {
    return (
      <main className="sheet">
        <h1>People</h1>
        <p className="lede">Only the owner can add a login.</p>
        <div className="actions"><Link className="button quiet" href="/">Back</Link></div>
      </main>
    );
  }

  return (
    <main className="sheet">
      <p className="kicker">{user.factoryName}</p>
      <h1>People</h1>
      <p className="lede">Office records money and papers. Yard records blocks and machines.</p>
      <section className="card">
        <ul className="people">
          {people.map((person) => (
            <li key={person.id}>
              <span>{person.name}<br /><span className="tag">{person.username}</span></span>
              <span className="tag">{userTypeLabel(person.userType)}</span>
            </li>
          ))}
        </ul>
      </section>
      <form className="card" onSubmit={(event) => void submit(event)}>
        <h2>New login</h2>
        <div className="choices">
          <button type="button" className="choice" aria-pressed={userType === "OFFICE"} onClick={() => setUserType("OFFICE")}>Office</button>
          <button type="button" className="choice" aria-pressed={userType === "YARD"} onClick={() => setUserType("YARD")}>Yard</button>
        </div>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Username
          <input value={username} autoComplete="off" onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Add login"}</button>
          <Link className="button quiet" href="/">Back</Link>
        </div>
      </form>
    </main>
  );
}
