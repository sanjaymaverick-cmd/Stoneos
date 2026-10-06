"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { apiFetch } from "../../lib/api";
export default function RecoveryPage() {
 const [data,setData]=useState<{recoveryRatio:number|null;recoveryBenchmark:number}|null>(null);
 const [owner,setOwner]=useState(false),[error,setError]=useState("");
 useEffect(()=>{
  apiFetch<{recoveryRatio:number|null;recoveryBenchmark:number}>("/api/v1/reports/today").then(setData).catch(e=>setError(e.message));
  apiFetch<{role:string}>("/api/v1/auth/me").then(u=>setOwner(u.role==="owner")).catch(()=>undefined);
 },[]);
 return <AppShell><h1>Recovery & quality</h1>
 {error&&<p className="error" role="alert">{error}</p>}
 <div className="grid"><div className="metric"><span>Sale-time recovery</span><b>{data?.recoveryRatio==null?"Awaiting sold-out blocks":`${data.recoveryRatio.toFixed(1)} sq ft/ton`}</b><p className="hint">Sold area divided by full raw-block weight, using sold-out blocks.</p></div><div className="metric"><span>Sale-time benchmark</span><b>{data?`${data.recoveryBenchmark} sq ft/ton`:"Loading..."}</b><p className="hint">This sale-time benchmark is separate from the production yield target.</p></div></div>
 <section className="card"><h2>Record and review quality</h2><p>Enter total cut, good slabs and dimensions when completing a cutting session. Review damaged pieces and good output before saving. Record grinding, resin and polishing as separate processing stages.</p><div className="workspace-actions"><Link className="chip" href="/production">Open cutting & processing</Link>{owner&&<Link className="chip" href="/analytics#costs">Review block yield and costs</Link>}</div></section>
 {owner&&<p className="muted">Set the production yield target under Business insights → Targets & OpenAI settings. Sale-time recovery can differ because of dimensions, sales and damaged stock.</p>}
 </AppShell>;
}
