import { useState } from 'react';
import { tenantStatement, csvRows } from './finance-utils.js';

export default function TenantStatements({db,today}) {
  const [personId,setPersonId]=useState('');
  const statement=tenantStatement(db,personId,today);
  const exportCsv=()=>{
    if(!statement)return;
    const lines=[['Date','Description','Charge AUD','Rent paid AUD','Balance AUD'],...statement.transactions.map(x=>[x.date,x.description,x.debit.toFixed(2),x.credit.toFixed(2),x.balance.toFixed(2)])];
    const blob=new Blob([csvRows(lines)],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download='sakan-tenant-statement-'+today+'.csv';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="card">
    <h2>Tenant statement</h2>
    <p className="muted">Choose a resident to review their rent charges, payments, balance and bond held. Export manually when needed.</p>
    <label>Resident<select value={personId} onChange={e=>setPersonId(e.target.value)}><option value="">Choose resident</option>{[...db.people].sort((a,b)=>a.name.localeCompare(b.name)).map(p=><option key={p.id} value={p.id}>{p.name} — {db.properties.find(x=>x.id===p.property_id)?.name||'Property'}</option>)}</select></label>
    {statement && <><p><strong>Rent balance:</strong> ${statement.balance.toFixed(2)} · <strong>Bond held:</strong> ${statement.bondHeld.toFixed(2)}</p>
      <div style={{overflowX:'auto',maxHeight:360,overflowY:'auto'}}><table><thead><tr><th>Date</th><th>Transaction</th><th>Charge</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{statement.transactions.map((r,i)=><tr key={i}><td>{r.date}</td><td>{r.description}</td><td>{r.debit?r.debit.toFixed(2):'—'}</td><td>{r.credit?r.credit.toFixed(2):'—'}</td><td>{r.balance.toFixed(2)}</td></tr>)}</tbody></table></div>
      <button type="button" className="primary" onClick={exportCsv}>Download tenant statement (CSV)</button>
    </>}
  </section>;
}
