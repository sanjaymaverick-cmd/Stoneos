"use client";
import {useEffect,useState} from "react";
import {INVENTORY_DATA_ROLES,SALES_DATA_ROLES,type Role} from "@stoneos/contracts";
import {AppShell} from "../../components/AppShell";
import {CustomerForm,type EditableCustomer} from "../../components/CustomerForm";
import {apiFetch,isQueued} from "../../lib/api";
export default function PartiesPage(){
 const [kind,setKind]=useState<"customer"|"supplier">("customer");
 const [buyers,setBuyers]=useState<EditableCustomer[]>([]);const [suppliers,setSuppliers]=useState<EditableCustomer[]>([]);
 const [editing,setEditing]=useState<EditableCustomer>();const [search,setSearch]=useState("");const [notice,setNotice]=useState("");const [error,setError]=useState("");const [role,setRole]=useState<Role>();
 async function refresh(){const [b,s]=await Promise.all([apiFetch<EditableCustomer[]>("/api/v1/customers"),apiFetch<EditableCustomer[]>("/api/v1/inventory/suppliers")]);setBuyers(b);setSuppliers(s);}
 useEffect(()=>{apiFetch<{role:Role}>("/api/v1/auth/me").then(u=>{setRole(u.role);return refresh();}).catch(e=>setError(e.message));},[]);
 const canEdit=role && (kind === "customer" ? SALES_DATA_ROLES : INVENTORY_DATA_ROLES).includes(role);
 const rows=(kind === "customer" ? buyers : suppliers).filter(p=>[p.name,p.contactInfo,p.gstin,p.billingAddress,p.shippingAddress].some(v=>v?.toLowerCase().includes(search.toLowerCase())));
 return <AppShell><h1>Buyers & suppliers</h1><p className="muted">Keep names, phone numbers, GSTINs, states, billing and delivery addresses together.</p>
 <label>Party type<select value={kind} onChange={e=>{setKind(e.target.value as "customer"|"supplier");setEditing(undefined);setNotice("");}}><option value="customer">Buyers / customers</option><option value="supplier">Suppliers</option></select></label>
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 {canEdit&&<CustomerForm key={kind+":"+(editing?.id??"new")} kind={kind} heading={kind === "customer" ? "Add a buyer" : "Add a supplier"} editing={editing} onCancel={()=>setEditing(undefined)} onAdded={(result,message)=>{setNotice(message);if(!isQueued(result)){setEditing(undefined);void refresh().catch(e=>setError(e.message));}}}/>}
 <section className="card"><h2>{kind === "customer" ? "Buyers" : "Suppliers"}</h2><label>Search name, phone, GSTIN or address<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
 {rows.map(p=><article className="card" key={p.id}><h3>{p.name}</h3><p>Phone: {p.contactInfo||"—"} · GSTIN: {p.gstin||"Unregistered"} · State: {p.stateCode||"—"}</p><p>Billing address: {p.billingAddress||"—"}</p><p>{kind === "customer" ? "Delivery / site" : "Pickup / dispatch"}: {p.shippingAddress||"—"}</p>{canEdit&&<button className="secondary" onClick={()=>{setEditing(p);setNotice("");window.scrollTo({top:0,behavior:"smooth"});}}>Edit {p.name}</button>}</article>)}
 {!rows.length&&<p>No {kind === "customer" ? "buyers" : "suppliers"} found. Add their details above.</p>}</section></AppShell>;
}
