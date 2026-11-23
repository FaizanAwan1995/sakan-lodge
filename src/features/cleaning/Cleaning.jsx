import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../store.js';

const dateLabel = date => new Date(date + 'T12:00:00').toLocaleDateString('en-AU', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
const empty = (property, date) => ({property_id:property, duty_date:date, first_person:'', second_person:'', complete:false});
export default function Cleaning({db,today}) {
  const [rows,setRows] = useState([]);
  const [deliveries,setDeliveries] = useState([]);
  const [form,setForm] = useState(null);
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [history,setHistory] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [shifts,mail] = await Promise.all([supabase.from('cleaning_shifts').select('*').order('duty_date'),supabase.rpc('cleaning_reminder_receipts')]);
    if (shifts.error || mail.error) { setNotice((shifts.error || mail.error).message); return; }
    setRows(shifts.data); setDeliveries(mail.data);
  },[]);
  useEffect(()=>{load();},[load]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => clearInterval(timer);
  }, [load]);
  const residents = form ? db.people.filter(p=>p.property_id===form.property_id && p.start_date<=form.duty_date && (!p.end_date || p.end_date>=form.duty_date) && !p.checked_out_at) : [];
  const update = patch => setForm({...form,...patch});
  const name = id => db.people.find(p=>p.id===id)?.name || 'Former resident';
  async function change(row, values, action) {
    setBusy(true); setNotice('');
    try {
      const table = supabase.from('cleaning_shifts');
      const request = !row?.id ? table.insert(values) : (action==='remove'?table.delete():table.update(values)).eq('id',row.id).eq('version',row.version);
      const {data,error} = await request.select('id');
      if(error) throw error;
      if (!data?.length) throw Error('This shift changed. Refresh and try again.');
      setForm(null);
      setNotice(action==='send'?'Reminder requested. Refresh to check delivery.':'Roster updated.');
    } catch(e) { setNotice(e.message); }
    finally { await load(); setBusy(false); }
  }
  if (!supabase) return <p>Sign in to the shared ledger to manage cleaning reminders.</p>;
  return <section>
    <div className="between screen-heading"><h1>Cleaning schedule</h1><button onClick={()=>setForm(empty(db.properties[0]?.id || '',today))}>Add shift</button></div>
    <p>Each assigned resident receives an email at 9 am Adelaide time on cleaning day. Send reminder now brings that email forward.</p>
    <p><strong>Bin nights</strong> · Clapham puts bins out Monday evening for Tuesday collection. Oaklands Park puts bins out Tuesday evening for Wednesday collection.</p>
    {notice && <p role="status">{notice}</p>}
    {form && <form onSubmit={e=>{e.preventDefault();const {property_id,duty_date,first_person,second_person,complete}=form;change(form,{property_id,duty_date,first_person,second_person,complete});}}>
      <h2>{form.id?'Edit shift':'Add cleaning shift'}</h2>
      <label>Property<select required value={form.property_id} onChange={e=>update({property_id:e.target.value,first_person:'',second_person:''})}>{db.properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Cleaning date<input type="date" required value={form.duty_date} onChange={e=>update({duty_date:e.target.value,first_person:'',second_person:''})}/></label>
      {['first_person','second_person'].map((field,i)=><label key={field}>Resident {i+1}<select required value={form[field]} onChange={e=>update({[field]:e.target.value})}><option value="">Select resident</option>{residents.map(p=><option key={p.id} value={p.id} disabled={p.id===form[i?'first_person':'second_person']}>{p.name}{p.email?'':' (email missing)'}</option>)}</select></label>)}
      <button className="primary" disabled={busy}>Save shift</button> <button type="button" onClick={()=>setForm(null)}>Cancel</button>
    </form>}
    <div className="seg"><button onClick={()=>setHistory(!history)}>{history?'Show upcoming':'Include past and completed'}</button><button onClick={load}>Refresh</button></div>
    {rows.filter(r=>history || (!r.complete && r.duty_date>=today)).map(row=><article className="card" key={row.id}>
      <h2>{dateLabel(row.duty_date)} · {db.properties.find(p=>p.id===row.property_id)?.name}</h2>
      <p>{name(row.first_person)} &amp; {name(row.second_person)}{row.complete?' · Completed':''}</p>
      {[row.first_person,row.second_person].map(id=>{
        const person=db.people.find(p=>p.id===id);
        const sent=deliveries.find(d=>d.shift_id===row.id && d.recipient===person?.email?.trim().toLowerCase());
        const status=sent?.status || (!person?.email?'Email missing':row.complete || row.duty_date<today?'No email scheduled':row.remind_now?'Requested':'Scheduled');
        let label = status;
        if (sent?.confirmed_at) {
          const when = new Date(sent.confirmed_at).toLocaleString('en-AU', {timeZone:'Australia/Adelaide',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
          label = 'Receipt confirmed · ' + when + ' Adelaide time';
        } else if (status === 'sent') {
          label = sent.confirmation_available ? 'Sent · Awaiting tenant confirmation' : 'Sent · Confirmation unavailable for this email';
        }
        return <small key={id} style={{display:'block'}}>{name(id)} · {label}</small>;
      })}
      <div className="maintenance-actions"><button disabled={busy} onClick={()=>setForm(row)}>Edit</button>
      {!row.complete && <button disabled={busy} onClick={()=>change(row,{complete:true})}>Mark complete</button>}
      {!row.complete && row.duty_date>=today && <button disabled={busy || row.remind_now || deliveries.filter(d=>d.shift_id===row.id && d.status==='sent').length>=2} onClick={()=>change(row,{remind_now:true},'send')}>Send reminder now</button>}
      <button disabled={busy} onClick={()=>{if(window.confirm('Remove this cleaning shift and cancel its pending reminders?'))change(row,null,'remove');}}>Remove</button></div>
    </article>)}
  </section>;
}
