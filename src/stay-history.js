import { d2n, money } from './ledger.js';
import { occupancyEnd, tenantStatus } from './tenant-model.js';
export const transactionLabel = kind => ({rent:'Rent received',bond:'Bond received',bond_refund:'Bond refunded',bond_deducted:'Bond retained',bond_applied:'Deducted from bond (rent / charges)'}[kind || 'rent'] || kind);
export function staySummary(person, today) {
  const end = occupancyEnd(person);
  const past = end <= today;
  const until = past ? end : today;
  const payments = (person.payments || []).filter(p => p.date && p.date <= today);
  const total = kind => money(payments.filter(p => (p.kind || 'rent') === kind).reduce((n,p) => n + +p.amount,0));
  return { start:person.start_date, end:end === '9999-12-31' ? null : end, past, status:tenantStatus(person,today),
    nights:Math.max(0,d2n(until)-d2n(person.start_date)), confirmed:Boolean(person.checked_out_at),
    rentReceived:total('rent'), bondReceived:total('bond'), bondApplied:total('bond_applied'), bondRefunded:total('bond_refund'), bondRetained:total('bond_deducted'),
    rentCharged:money((person.charges || []).filter(c => c.kind==='rent' && c.due_date<=today).reduce((n,c)=>n + +c.amount,0)) };
}
export function historyMatches(person, query, audit = []) {
  const text=query.trim().toLowerCase();
  return [person.name,person.id,person.phone,person.email,...audit.filter(a=>a.tenant_id===person.id).flatMap(a=>[a.tenant_name,a.before_values?.name,a.after_values?.name])].some(x=>String(x||'').toLowerCase().includes(text));
}
export function roomResidents(people, roomId, audit = []) {
  const ids = new Set(audit.filter(a => a.entity_table === 'people' && [a.before_values?.room_id,a.after_values?.room_id].includes(roomId)).map(a=>a.tenant_id));
  return people.filter(p=>p.room_id===roomId || ids.has(p.id));
}
export function stayEvents(person, audit = []) {
  return audit.filter(a => a.tenant_id===person.id && a.entity_table==='people').flatMap(a => {
    const before=a.before_values, after=a.after_values;
    const base={id:a.id,at:a.at,by:a.by,reason:a.reason,before,after};
    if (a.action==='scheduled_checkout_elapsed') return [{...base,title:'Automatic scheduled checkout',date:after?.end_date,description:after?.end_date===person.end_date && !person.checked_out_at ? 'Scheduled occupancy ended; physical departure has not been confirmed.' : 'Previous scheduled departure; see later corrections or confirmation.'}];
    if (!before && after) return [{...base,title:'Check-in record created',date:after.start_date,description:'Stay dates recorded by an administrator.'}];
    if (before && after) {
      const events=[];
      if (before.room_id!==after.room_id || before.property_id!==after.property_id) events.push({...base,id:a.id+'-move',title:'Room assignment changed',date:String(a.at).slice(0,10),description:'Previous and new room assignments are retained below.'});
      if (before.start_date!==after.start_date) events.push({...base,id:a.id+'-arrival',title:'Check-in date corrected',date:after.start_date,description:`Previously ${before.start_date || 'not set'}.`});
      if (before.end_date!==after.end_date) events.push({...base,id:a.id+'-end',title:'Departure date changed',date:after.end_date,description:`Previously ${before.end_date || 'not scheduled'}.`});
      if (before.checked_out_at!==after.checked_out_at) events.push({...base,id:a.id+'-confirmed',title:after.checked_out_at?'Checkout confirmed':'Checkout confirmation reversed',date:after.checked_out_at ? new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Adelaide'}).format(new Date(after.checked_out_at)) : null});
      return events;
    }
    return [{...base,title:a.action,date:null,description:'Older activity has no saved before-and-after details.'}];
  }).sort((a,b)=>String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)));
}
