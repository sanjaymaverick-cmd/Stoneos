"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { formatInr, todayIst } from "../../../lib/format";
import { apiFetch } from "../../../lib/api";

type Einvoice = { id: string; irn: string; status: string; source: string };
type Eway = { id: string; ewbNo: string; status: string; source: string };
type Gstr = {
  month: string;
  csv: string;
  b2b: unknown[];
  creditNotes: unknown[];
};

export default function GstPage() {
  const [gstin, setGstin] = useState("");
  const [legalName, setLegalName] = useState("Vedam Granites");
  const [stateCode, setStateCode] = useState("08");
  const [irn, setIrn] = useState<Einvoice[]>([]);
  const [eway, setEway] = useState<Eway[]>([]);
  const [gstr, setGstr] = useState<Gstr | null>(null);
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [position, setPosition] = useState<{
    month: string;
    input: { cgst: number; sgst: number; igst: number };
    output: { cgst: number; sgst: number; igst: number };
    net: { cgst: number; sgst: number; igst: number };
    note: string;
  } | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    const profile = await apiFetch<{
      gstin: string;
      legalName: string;
      stateCode: string;
    } | null>("/api/v1/gst/profile");
    if (profile) {
      setGstin(profile.gstin);
      setLegalName(profile.legalName);
      setStateCode(profile.stateCode);
    }
    setIrn(await apiFetch("/api/v1/gst/einvoice").catch(() => []));
    setEway(await apiFetch("/api/v1/gst/eway").catch(() => []));
  }
  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/gst/profile", {
        method: "POST",
        body: JSON.stringify({ gstin, legalName, stateCode }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile failed");
    }
  }

  return (
    <AppShell>
      <p>
        <Link href="/books">← Books</Link>
      </p>
      <h1>GST input credit & documents</h1>
      <section className="card">
        <h2>Regular GST — purchases and sales</h2>
        <p>
          Purchase GST is recorded as input credit, separately from stock cost.
          GST charged on sales is output tax.
        </p>
        <label>
          GST month
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            apiFetch<typeof position>(`/api/v1/gst/position?month=${month}`)
              .then(setPosition)
              .catch((e) => setError(e.message))
          }
        >
          Show GST balance
        </button>
        {position && (
          <>
            <p>
              Recorded in {position.month}. Credit eligibility, earlier carried
              credit and the permitted set-off across tax heads must be
              reconciled before filing.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tax head</th>
                    <th>Purchase input GST</th>
                    <th>Sales output GST</th>
                    <th>Output less input</th>
                  </tr>
                </thead>
                <tbody>
                  {(["cgst", "sgst", "igst"] as const).map((head) => (
                    <tr key={head}>
                      <td>{head.toUpperCase()}</td>
                      <td>{formatInr(position.input[head])}</td>
                      <td>{formatInr(position.output[head])}</td>
                      <td>{formatInr(position.net[head])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{position.note}</p>
          </>
        )}
      </section>
      <p>
        Statutory integrations are in test mode. Mock IRNs and e-way numbers are
        demonstrations, not filings. GSTR-1 is a download for review; live
        filing will require configured provider access.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <form onSubmit={saveProfile}>
          <label>
            GSTIN
            <input
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
              required
            />
          </label>
          <label>
            Legal name
            <input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </label>
          <label>
            State code
            <input
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
            />
          </label>
          <button type="submit">Save GST profile</button>
        </form>
      </div>
      <div className="card">
        <h2>IRN</h2>
        {irn.length === 0 ? (
          <EmptyState>
            No IRNs yet. Issue from an invoice after the GSTIN is saved.
          </EmptyState>
        ) : (
          <ul>
            {irn.map((r) => (
              <li key={r.id}>
                {r.irn} · {r.status} · {r.source}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <h2>E-way</h2>
        {eway.length === 0 ? (
          <EmptyState>
            No e-way bills. Create a draft at dispatch time.
          </EmptyState>
        ) : (
          <ul>
            {eway.map((r) => (
              <li key={r.id}>
                {r.ewbNo} · {r.status}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <h2>GSTR-1</h2>
        <label>
          Month
          <input value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() =>
            apiFetch<Gstr>(`/api/v1/gst/gstr1?month=${month}`)
              .then(setGstr)
              .catch((e) =>
                setError(e instanceof Error ? e.message : "GSTR-1 failed"),
              )
          }
        >
          Export
        </button>
        {gstr ? <pre>{gstr.csv}</pre> : null}
      </div>
    </AppShell>
  );
}
