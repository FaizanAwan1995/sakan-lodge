import { useState } from 'react';
import { fmt, nice } from '../../lib/formatters.js';
import AccountPayment from './AccountPayment.jsx';

export default function AccountTransactions({db,d,today,reload,openTenant,personId=null}) {
  const [query,setQuery]=useState('');const [kind,setKind]=useState('all');const [page,setPage]=useState(0);const [edit,setEdit]=useState(null);
  const people=d.people;
  const records=db.payments.filter(p=>(!personId || p.person_id===personId) && (kind==='all'||(p.kind||'rent')===kind) && [people.find(x=>x.id===p.person_id)?.name,p.note,p.date].some(x=>String(x||'').toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>(b.date+b.created_at).localeCompare(a.date+a.created_at));
  const pages=Math.max(1,Math.ceil(records.length/20));const current=Math.min(page,pages-1);
  return <section className="card"><h2>Transactions</h2><div className="account-form-grid"><label>Find transaction<input type="search" placeholder="Name, date or reference" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} /></label><label>Type<select value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}}><option value="all">All transactions</option>{['rent','bond','bond_refund','bond_deducted','bond_applied'].map(k=><option key={k} value={k}>{k.replaceAll('_',' ')}</option>)}</select></label></div>
    {records.slice(current*20,current*20+20).map(p=><div className="account-transaction row" key={p.id}><div>{!personId && <button className="link" onClick={()=>openTenant(p.person_id)}>{people.find(x=>x.id===p.person_id)?.name || 'Tenant account'}</button>}<strong>{fmt(p.amount)} · {(p.kind||'rent').replaceAll('_',' ')}</strong><small>{nice(p.date)} · {p.method} · {p.received_by}</small>{p.note && <small>{p.note}</small>}</div>{p.settlement_id ? <small>Bond settlement · audited</small> : <button className="small" onClick={()=>setEdit(p)}>Correct</button>}</div>)}
    {!records.length && <p>No matching transactions.</p>}
    {pages>1 && <div className="between"><button disabled={!current} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current+1} of {pages}</span><button disabled={current===pages-1} onClick={()=>setPage(current+1)}>Next</button></div>}
    <p className="muted">Corrections retain the previous values and a reason in Activity. Bond transactions are separate from rent.</p>
    {edit && <AccountPayment key={edit.id} person={people.find(p=>p.id===edit.person_id)} original={edit} db={db} today={today} reload={reload} onClose={()=>setEdit(null)} />}
  </section>;
}
