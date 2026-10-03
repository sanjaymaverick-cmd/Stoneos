"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { apiFetch, getToken } from "../../../lib/api";
import { formatInr, todayIst } from "../../../lib/format";
import "./reports.css";
type Party={id:string;name:string;side:string;contact:string;gstin:string};
type Summary=Party&{opening:number;charges:number;credits:number;received:number;paid:number;balance:number;due:number;advance:number};
type Entry={id:string;date:string;name:string;side:string;type:string;reference:string;details:string;debit:number;credit:number;paidIn:number;paidOut:number;mode:string;balance:number};
type Report={from:string;to:string;parties:Party[];summary:Summary[];rows:Entry[];totals:{received:number;paid:number};note:string};
const apiUrl=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000";
export default function SellReports(){
  const [side,setSide]=useState("");const [partyId,setParty]=useState("");const [search,setSearch]=useState("");
  const [from,setFrom]=useState("");const [to,setTo]=useState(todayIst());const [type,setType]=useState("all");
  const [report,setReport]=useState<Report|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const [applied,setApplied]=useState("");const [appliedSide,setAppliedSide]=useState("");
  const query=()=>new URLSearchParams({side,partyId,from,to,type}).toString();
  async function load(e?:FormEvent){e?.preventDefault();setBusy(true);setError("");try{const q=query();const r=await apiFetch<Report>("/api/v1/reports/parties?"+q);setReport(r);setApplied(q);setAppliedSide(side);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  useEffect(()=>{void load();},[]);
  function period(value:string){const today=todayIst();setTo(today);if(value==="all")setFrom("");if(value==="month")setFrom(today.slice(0,7)+"-01");if(value==="year")setFrom(today.slice(0,4)+"-01-01");}
  async function download(){setBusy(true);setError("");try{const response=await fetch(apiUrl+"/api/v1/reports/parties.xlsx?"+applied,{headers:{Authorization:"Bearer "+getToken()}});if(!response.ok){const b=await response.json().catch(()=>({message:response.statusText}));throw Error(b.message??"Download failed");}const url=URL.createObjectURL(await response.blob());const a=document.createElement("a");a.href=url;a.download="stoneos-party-report-"+(report?.to??to)+".xlsx";a.click();URL.revokeObjectURL(url);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <AppShell><div className="party-reports"><p className="no-print"><Link href="/sales">← Sell</Link></p><h1>Sales & purchase reports</h1>
    <p className="muted">Customer and supplier statements, payments and dues. All dates supported — no one-year limit.</p>
    <form className="card no-print" onSubmit={load}><div className="report-filters">
      <label>Party type<select value={side} onChange={e=>{setSide(e.target.value);setParty("");}}><option value="">All customers and suppliers</option><option value="customer">Sales customers</option><option value="supplier">Purchase suppliers</option></select></label>
      <label>Search party<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name"/></label>
      <label>Customer / supplier<select value={partyId} onChange={e=>setParty(e.target.value)}><option value="">All parties</option>{report?.parties.filter(p=>(!side||p.side===side)&&p.name.toLowerCase().includes(search.toLowerCase())).map(p=><option key={p.id} value={p.id}>{p.name} · {p.side}</option>)}</select></label>
      <label>Report<select value={type} onChange={e=>setType(e.target.value)}><option value="all">Statement · all transactions</option><option value="sales">Sales and credit notes</option><option value="purchases">Purchases</option><option value="payments">Payments received and made</option><option value="dues">Detailed dues</option></select></label>
      <label>Period<select defaultValue="all" onChange={e=>period(e.target.value)}><option value="all">All dates</option><option value="month">This month</option><option value="year">This calendar year</option><option value="custom">Custom range</option></select></label>
      <label>Start date<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label>End date / dues as of<input type="date" required value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div><button disabled={busy}>Generate report</button></form>
    {error&&<p className="error" role="alert">{error}</p>}
    {report&&<><p>Period: {report.from||"All dates"} to {report.to} · {report.rows.length} entries</p><div className="report-actions no-print"><button disabled={busy} onClick={download}>Download Excel</button><button onClick={()=>window.print()}>Print / Save PDF</button></div>
    <div className="report-totals"><div className="card">Payments received<strong>{formatInr(report.totals.received)}</strong></div><div className="card">Payments made<strong>{formatInr(report.totals.paid)}</strong></div><div className="card">Customer dues<strong>{formatInr(report.summary.filter(p=>p.side==="customer").reduce((n,p)=>n+p.due,0))}</strong></div><div className="card">Supplier dues<strong>{formatInr(report.summary.filter(p=>p.side==="supplier").reduce((n,p)=>n+p.due,0))}</strong></div></div>
    {["customer","supplier"].filter(s=>!appliedSide||s===appliedSide).map(s=><section className="card" key={s}><h2>{s==="customer"?"Sales customers and dues":"Purchase suppliers and dues"}</h2><p className="muted">Balances include entries before the start date; dues are through {report.to}. Advance / credit is shown separately.</p><div className="report-table"><table><thead><tr>{["Name","Contact","GSTIN","Opening","Sales / purchases","Credits","Received","Paid","Due","Advance / credit"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.summary.filter(p=>p.side===s).map(p=><tr key={p.id}><td>{p.name}</td><td>{p.contact||"—"}</td><td>{p.gstin||"—"}</td><td>{formatInr(p.opening)}</td><td>{formatInr(p.charges)}</td><td>{formatInr(p.credits)}</td><td>{formatInr(p.received)}</td><td>{formatInr(p.paid)}</td><td><b>{formatInr(p.due)}</b></td><td>{formatInr(p.advance)}</td></tr>)}</tbody></table></div>{!report.summary.some(p=>p.side===s)&&<p>No parties for these filters.</p>}</section>)}
    <section className="card"><h2>Transaction detail</h2><div className="report-table"><table><thead><tr>{["Date","Party","Type","Reference","Details","Charge","Credit","Received","Paid","Payment mode","Balance"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.rows.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.name}</td><td>{r.type}</td><td>{r.reference}</td><td>{r.details}</td><td>{formatInr(r.debit)}</td><td>{formatInr(r.credit)}</td><td>{formatInr(r.paidIn)}</td><td>{formatInr(r.paidOut)}</td><td>{r.mode||"—"}</td><td>{formatInr(r.balance)}</td></tr>)}</tbody></table></div>{!report.rows.length&&<p>No transactions for these filters.</p>}</section><p className="muted">{report.note}</p></>}
  </div></AppShell>;
}
