"use client";

import Link from "next/link";
import { api, clearToken, readToken } from "../lib/api";
import { userTypeLabel, userTypeWork } from "../lib/labels";
import { useSession } from "../lib/session";
import { useRouter } from "next/navigation";

const jobs = [
  "Buy a block load",
  "Cut, grind, and polish a block",
  "Sell, with the invoice and the actual slip",
  "Charge job work by the ton",
  "Receive money and pay a mine",
];

export default function HomePage() {
  const { user, ready, problem } = useSession();
  const router = useRouter();

  async function signOut() {
    const token = readToken();
    if (token) await api("/api/v1/auth/logout", { method: "POST", token }).catch(() => undefined);
    clearToken();
    router.replace("/login");
  }

  if (!ready || !user) {
    return <main className="sheet"><p className="waiting">{problem || "Opening…"}</p></main>;
  }

  return (
    <main className="sheet">
      <div className="top">
        <div>
          <p className="kicker">{user.factoryName}</p>
          <h1>{user.name}</h1>
          <p className="lede">{userTypeLabel(user.userType)}. {userTypeWork(user.userType)}</p>
        </div>
        <button className="quiet" type="button" onClick={() => void signOut()}>Sign out</button>
      </div>

      {user.userType === "OWNER" ? (
        <section className="card">
          <h2>People</h2>
          <p className="lede">Add the office desk and the yard desk. Each person gets their own login.</p>
          <div className="actions">
            <Link className="button" href="/people">Add a person</Link>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Books</h2>
        <p className="lede">These are the jobs the books will keep.</p>
        {user.userType === "YARD" ? null : (
          <div className="actions">
            <Link className="button" href="/opening">Open the books</Link>
          </div>
        )}
        <ul className="jobs">
          {jobs.map((job) => <li key={job}>{job}</li>)}
        </ul>
      </section>
    </main>
  );
}
