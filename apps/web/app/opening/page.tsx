"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api, readToken } from "../../lib/api";
import { useSession } from "../../lib/session";
import { OpeningScreen, type OpeningBook } from "./screen";

export default function OpeningPage() {
  const { user, ready, problem } = useSession();
  const [book, setBook] = useState<OpeningBook | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || user.userType === "YARD") return;
    const token = readToken();
    if (!token) return;
    api<OpeningBook>("/api/v1/opening", { token })
      .then(setBook)
      .catch((caught) => {
        setError(caught instanceof ApiError ? caught.message : "Could not open the books");
      });
  }, [user]);

  if (!ready || !user) {
    return <main className="sheet"><p className="waiting">{problem || "Opening…"}</p></main>;
  }
  if (user.userType === "YARD") {
    return (
      <main className="sheet">
        <h1>Open the books</h1>
        <p className="lede">The yard does not open the books.</p>
        <div className="actions"><Link className="button quiet" href="/">Back</Link></div>
      </main>
    );
  }
  if (!book) {
    return (
      <main className="sheet">
        <p className="waiting">{error || "Opening…"}</p>
        {error ? <div className="actions"><Link className="button quiet" href="/">Back</Link></div> : null}
      </main>
    );
  }

  return <OpeningScreen user={user} book={book} onBook={setBook} />;
}
