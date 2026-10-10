"use client";

import { useSession } from "../../lib/session";

export default function SetupPage() {
  const { problem } = useSession();
  return <main className="sheet"><p className="waiting">{problem || "Opening…"}</p></main>;
}
