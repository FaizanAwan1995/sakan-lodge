import { Link } from 'react-router-dom';
import { tenantReference } from '../../tenant-model.js';
import { useState } from 'react';
import { tenantStatement, csvRows } from './finance-utils.js';

export default function TenantStatements({db,today,fixedPersonId}) {
  const [selectedPersonId,setPersonId]=useState('');
  const personId = fixedPersonId || selectedPersonId;
  const statement=tenantStatement(db,personId,today);
  const exportCsv=()=>{
    if(!statement)return;
    const lines=[['Tenant ID','Tenant','Date','Description','Charge AUD','Rent paid AUD','Balance AUD'],...statement.transactions.map(x=>[tenantReference(statement.person),statement.person.name,x.date,x.description,x.debit.toFixed(2),x.credit.toFixed(2),x.balance.toFixed(2)])];
    const blob=new Blob([csvRows(lines)],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download='sakan-tenant-'+tenantReference(statement.person)+'-'+today+'.csv';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="card">
    <h2>Tenant statement</h2>
    <p className="muted">Review rent charges, payments, balance and bond held. Export a statement when needed.</p>
    {!fixedPersonId && <label>Resident<select value={personId} onChange={e=>setPersonId(e.target.value)}><option value="">Choose resident</option>{[...db.people].sort((a,b)=>a.name.localeCompare(b.name)).map(p=><option key={p.id} value={p.id}>{p.name} — {db.properties.find(x=>x.id===p.property_id)?.name||'Property'} — {tenantReference(p)}</option>)}</select></label>}
    {statement && <><p className="tenant-reference">Tenant ID {fixedPersonId ? <code>{tenantReference(statement.person)}</code> : <Link to={`/rooms/${statement.person.id}`}>{tenantReference(statement.person)}</Link>}</p><p><strong>Rent balance:</strong> ${statement.balance.toFixed(2)} · <strong>Bond balance from transactions:</strong> ${statement.bondHeld.toFixed(2)}</p>
      {statement.person.paid_up_to && <p className="muted">The rent balance starts after the imported paid-through date, {statement.person.paid_up_to}. Earlier cash receipts are not reconstructed.</p>}
      {['paid','held'].includes(statement.person.bond_status) && statement.person.bond_paid === 0 && +statement.person.bond > 0 && <p role="status">The existing resident record marks a ${Number(statement.person.bond).toFixed(2)} bond as paid, without a recorded receipt. Reconcile that opening liability before treating the transaction balance as complete.</p>}
      <div style={{overflowX:'auto',maxHeight:360,overflowY:'auto'}}><table><thead><tr><th>Date</th><th>Transaction</th><th>Charge</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{statement.transactions.map((r,i)=><tr key={i}><td>{r.date}</td><td>{r.description}</td><td>{r.debit?r.debit.toFixed(2):'—'}</td><td>{r.credit?r.credit.toFixed(2):'—'}</td><td>{r.balance.toFixed(2)}</td></tr>)}</tbody></table></div>
      <button type="button" className="primary" onClick={exportCsv}>Download tenant statement (CSV)</button>
      <h3>Bond activity</h3>
      {statement.bondIssue && <p role="alert" className="err">Bond refunds or retained amounts exceed recorded receipts. Reconcile the bond transactions before relying on this balance.</p>}
      {statement.bondTransactions.length ? <div style={{overflowX:'auto'}}><table><thead><tr><th>Date</th><th>Action</th><th>Amount</th><th>Bond balance</th></tr></thead><tbody>{statement.bondTransactions.map((r,i)=><tr key={i}><td>{r.date}</td><td>{{bond:'Received',bond_refund:'Refunded',bond_deducted:'Retained',bond_applied:'Deducted for rent / charges'}[r.kind]}</td><td>{r.amount.toFixed(2)}</td><td>{r.balance.toFixed(2)}</td></tr>)}</tbody></table></div> : <p className="muted">No bond receipts, refunds or retained amounts have been recorded.</p>}
    </>}
  </section>;
}
