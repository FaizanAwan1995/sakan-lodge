import { useState } from 'react';
import { COLLECTION_ADMINS,createAdminCollections,collectionSummaryRows,collectionTransactionRows } from './admin-collections.js';
import { transactionLabel } from '../../stay-history.js';
import { fmt,nice } from '../../lib/formatters.js';

export default function AdminCollections({db,today,download}){
 const [start,setStart]=useState(today.slice(0,7)+'-01'),[end,setEnd]=useState(today),[admin,setAdmin]=useState('all'),[method,setMethod]=useState('all'),[page,setPage]=useState(0);
 let report,error;try{report=createAdminCollections(db,{start,end,asOf:today,admin,method});}catch(e){error=e.message;}
 const change=(setter)=>e=>{setter(e.target.value);setPage(0);};
 const pages=Math.max(1,Math.ceil((report?.entries.length || 0)/20)),current=Math.min(page,pages-1);
 return <section className="card" aria-labelledby="admin-collections-title">
  <h2 id="admin-collections-title">Admin collections</h2>
  <p>Money received by the recorded administrator or handler, split by payment mode. These dates apply to this view independently of the property reports above.</p>
  <div className="account-form-grid"><label>Collections from<input type="date" min="2026-07-01" max={today} value={start} onChange={change(setStart)}/></label><label>Collections to<input type="date" min={start} max={today} value={end} onChange={change(setEnd)}/></label><label>Admin / handler<select value={admin} onChange={change(setAdmin)}><option value="all">All admins / handlers</option>{COLLECTION_ADMINS.map(a=><option key={a}>{a}</option>)}</select></label><label>Payment mode<select value={method} onChange={change(setMethod)}><option value="all">Cash and transfer</option><option value="cash">Cash</option><option value="transfer">Transfer</option></select></label></div>
  {error&&<p role="alert" className="err">{error}</p>}
  {report&&<>
   <p>{nice(report.start)} – {nice(report.closingDate)} · <strong>{fmt(report.totals.received)} collected</strong> · {fmt(report.totals.refunded)} bond refunds · <strong>{fmt(report.totals.net)} net receipts</strong></p>
   <p className="muted">Collections include rent and bond actually recorded as cash or transfer. Historical adjustments, bond applied to rent and other bond deductions are excluded. Bond refunds are shown separately. Net receipts exclude expenses and do not represent a bank balance or profit. The handler records who received or processed the payment; it does not identify ownership of the destination bank account.</p>
   <div style={{overflowX:'auto'}}><table><thead><tr><th>Admin / handler</th><th>Cash collected</th><th>Transfer collected</th><th>Rent</th><th>Bond</th><th>Total collected</th><th>Bond refunded</th><th>Net receipts</th></tr></thead><tbody>
    {report.rows.map(r=><tr key={r.admin}><th scope="row">{r.admin}</th><td>{fmt(r.cashReceived)}</td><td>{fmt(r.transferReceived)}</td><td>{fmt(r.rentReceived)}</td><td>{fmt(r.bondReceived)}</td><td>{fmt(r.received)}</td><td>{fmt(r.refunded)}</td><td>{fmt(r.net)}</td></tr>)}
    <tr><th>Total</th><td>{fmt(report.totals.cashReceived)}</td><td>{fmt(report.totals.transferReceived)}</td><td>{fmt(report.totals.rentReceived)}</td><td>{fmt(report.totals.bondReceived)}</td><td>{fmt(report.totals.received)}</td><td>{fmt(report.totals.refunded)}</td><td>{fmt(report.totals.net)}</td></tr>
   </tbody></table></div>
   <p className={report.reconciled?'muted':'err'}>{report.reconciled?'Admin subtotals match the selected transaction totals.':'Admin subtotals do not reconcile; review before using these figures.'}</p>
   {report.unknownHandlers>0&&<p role="status">{report.unknownHandlers} transaction(s) have an unrecognised or missing handler. They remain in Other / unassigned.</p>}
   {report.unverifiedModes>0&&<p role="status">{report.unverifiedModes} transaction(s) have an unverified payment mode and are excluded from collections.</p>}
   {report.undated>0&&<p role="status">{report.undated} payment record(s) have no valid date and cannot be allocated to a period.</p>}
   <details><summary>View collected payments and refunds ({report.entries.length})</summary><div style={{overflowX:'auto'}}><table><thead><tr><th>Date</th><th>Handler</th><th>Tenant / property</th><th>Type</th><th>Mode</th><th>Collected</th><th>Refunded</th></tr></thead><tbody>{report.entries.slice(current*20,current*20+20).map((r,i)=><tr key={r.id || i}><td>{nice(r.date)}</td><td>{r.handledBy}</td><td>{r.person} · {r.property}</td><td>{transactionLabel(r.kind)}</td><td>{r.method==='transfer'?'Transfer':'Cash'}</td><td>{fmt(r.received)}</td><td>{fmt(r.refunded)}</td></tr>)}</tbody></table></div>{!report.entries.length&&<p>No collected payments or refunds in this selection.</p>}{pages>1&&<div className="between"><button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><span>{current+1} / {pages}</span><button type="button" disabled={current===pages-1} onClick={()=>setPage(current+1)}>Next</button></div>}</details>
   {!!report.excluded.length&&<details><summary>Excluded adjustments and allocations ({report.excluded.length})</summary><ul>{report.excluded.map((r,i)=><li key={r.id || i}>{nice(r.date)} · {r.person} · {fmt(r.amount)} · {r.reason}</li>)}</ul></details>}
   <div className="screen-actions"><button type="button" onClick={()=>download(collectionSummaryRows(report),`sakan-admin-collections-${start}-${end}.csv`)}>Export admin summary (CSV)</button><button type="button" onClick={()=>download(collectionTransactionRows(report),`sakan-collection-transactions-${start}-${end}.csv`)}>Export collection transactions (CSV)</button></div>
  </>}
 </section>;
}
