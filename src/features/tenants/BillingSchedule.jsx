import { useState } from 'react';
import { billingTermsAt, d2n, n2d, nextCycleOnOrAfter } from '../../ledger.js';
import { scheduleTenantBilling } from '../../store.js';
import { fmt, nice } from '../../lib/formatters.js';

export default function BillingSchedule({person,property,today,reload}) {
  const last=[...(person.billing_schedule||[])].sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
  const terms=last || billingTermsAt(person,today);
  const first=nextCycleOnOrAfter(terms.rent_cycle_anchor || property.lease_anchor,Math.max(d2n(today),d2n(last?.effective_from || person.start_date),d2n(person.paid_up_to || person.start_date))+1);
  const [effective,setEffective]=useState(n2d(first));const [weekly,setWeekly]=useState(terms.weekly_rate || '');const [cycle,setCycle]=useState('keep');const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const choices=Array.from({length:26},(_,i)=>n2d(first+14*i)).filter(x=>!person.end_date||x<person.end_date);
  return <details className="card"><summary>Schedule a future rent or billing-cycle change</summary><p>Changes begin on an existing future rent boundary. Earlier charges keep their original rate.</p>
    {(person.billing_schedule||[]).map(x=><p key={x.effective_from}>{nice(x.effective_from)}: {fmt(x.weekly_rate)}/week · {x.rent_cycle_anchor?'Tenant cycle':'Property cycle'} · {x.reason}</p>)}
    {person.stay_type!=='long' || person.checked_out_at || !choices.length ? <p>Future changes are available for ongoing weekly rent accounts.</p> : <form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setMessage('');try{await scheduleTenantBilling(person,effective,weekly,cycle==='keep'?(terms.rent_cycle_anchor||null):cycle==='house'?null:effective,reason);await reload();setReason('');setMessage('Future billing change saved. Earlier charges are unchanged.');}catch(e){setMessage(e.message);}finally{setBusy(false);}}}>
      <label>Effective from<select value={effective} onChange={e=>setEffective(e.target.value)}>{choices.map(x=><option key={x} value={x}>{nice(x)}</option>)}</select></label>
      <label>Weekly rent ($)<input type="number" required min="0.01" step="0.01" value={weekly} onChange={e=>setWeekly(e.target.value)} /></label>
      <label>Billing cycle<select value={cycle} onChange={e=>setCycle(e.target.value)}><option value="keep">Keep current cycle</option><option value="house">Align to property cycle</option><option value="tenant">Fortnight from effective date</option></select></label>
      <label>Reason<input required minLength={5} value={reason} onChange={e=>setReason(e.target.value)} /></label><button disabled={busy} className="primary">{busy?'Saving…':'Schedule change'}</button>
    </form>}{message && <p role="status">{message}</p>}
  </details>;
}
