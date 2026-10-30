import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, isLocalMode } from '../../store.js';

export default function IncomingAlerts({userId}) {
 const location=useLocation(),navigate=useNavigate();
 const [open,setOpen]=useState(()=>new URLSearchParams(location.search).has('enquiries'));
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[warnings,setWarnings]=useState(0);
 const storageKey='sakan-incoming-seen:'+userId;
 const [seen,setSeen]=useState(()=>{try{const value=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(value)?value:[];}catch{return [];}});
 const previous=useRef(null),focusReturn=useRef(null),panel=useRef(null);
 useEffect(()=>{if(new URLSearchParams(location.search).has('enquiries'))setOpen(true);},[location.search]);
 useEffect(()=>{
  if(isLocalMode||!supabase)return;let alive=true,busy=false;
  const refresh=async()=>{
   if(busy||document.hidden)return;busy=true;
   try{
    const [reservations,enquiries,deliveries]=await Promise.all([
     supabase.from('reservations').select('id,reservation_code,full_name,arrival_date,created_at').in('status',['pending','review']).order('created_at',{ascending:false}).limit(100),
     supabase.from('website_enquiries').select('id,reference,details,created_at').order('created_at',{ascending:false}).limit(100),
     supabase.from('incoming_alert_deliveries').select('id',{count:'exact',head:true}).eq('status','uncertain')
    ]);
    if(reservations.error||enquiries.error||deliveries.error)throw Error('Alerts could not refresh. Try again shortly.');
    if(!alive)return;
    const next=[...(reservations.data||[]).map(r=>({...r,kind:'reservation',name:r.full_name,reference:r.reservation_code})),...(enquiries.data||[]).map(r=>({...r,kind:'enquiry',name:r.details.full_name}))].sort((a,b)=>b.created_at.localeCompare(a.created_at));
    // Announce new arrivals without interrupting work or opening a modal.
    const ids=new Set(next.map(r=>r.id));if(previous.current&&next.some(r=>!previous.current.has(r.id)))setAnnouncement('New reservation or enquiry received. Open notifications to review.');previous.current=ids;
    setRows(next);setWarnings(deliveries.count||0);setError('');
   }catch(e){if(alive)setError(e.message);}finally{busy=false;}
  };
  refresh();const timer=setInterval(refresh,15000);
  const channel=supabase.channel('ledger-incoming-alerts:'+userId).on('postgres_changes',{event:'INSERT',schema:'public',table:'reservations'},refresh).subscribe();
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{alive=false;clearInterval(timer);supabase.removeChannel(channel);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[userId]);
 const [announcement,setAnnouncement]=useState('');
 const unread=rows.filter(r=>!seen.includes(r.id));
 const markRead=()=>{const ids=rows.map(r=>r.id);setSeen(ids);try{localStorage.setItem(storageKey,JSON.stringify(ids));}catch{}setAnnouncement('Notifications marked read on this device.');};
 const close=()=>{setOpen(false);focusReturn.current?.focus();};
 useEffect(()=>{if(open)panel.current?.querySelector('button')?.focus();},[open]);
 if(isLocalMode)return null;
 return <aside className="incoming-alerts" aria-label="Reservation notifications">
  <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  {open&&<section ref={panel} className="incoming-panel" aria-label="Reservations and enquiries" onKeyDown={e=>{if(e.key==='Escape')close();}}>
   <div className="incoming-heading"><h2>Reservations & enquiries</h2><button type="button" onClick={close} aria-label="Close notifications">×</button></div>
   {error&&<p role="status">{error}</p>}
   {warnings>0&&<p className="err" role="status">{warnings} email delivery records need checking in Gmail Sent before resending. Submissions are saved.</p>}
   <div className="incoming-toolbar"><span>{unread.length} unread</span><button type="button" onClick={markRead} disabled={!unread.length}>Mark all read</button></div>
   <div className="incoming-list">{rows.length?rows.map(r=><article key={r.id} className={seen.includes(r.id)?'':'incoming-unread'}>
    <small>{r.kind==='reservation'?'Reservation request':'Website enquiry'} · {new Date(r.created_at).toLocaleString('en-AU',{timeZone:'Australia/Adelaide',dateStyle:'medium',timeStyle:'short'})}</small>
    <strong>{r.name}</strong><small>{r.reference}</small>
    {r.kind==='reservation'?<button type="button" onClick={()=>{close();navigate('/reservations?reservation='+r.id);}}>Open reservation</button>:<details><summary>View enquiry</summary><p>{r.details.location} · {r.details.accommodation} · {r.details.occupants} occupant(s)</p>{r.details.move_in&&<p>Move-in: {r.details.move_in}</p>}<p><a href={'mailto:'+r.details.email}>{r.details.email}</a></p><p>{r.details.phone}</p><p className="incoming-message">{r.details.message}</p></details>}
   </article>):<p>No new requests.</p>}</div>
  </section>}
  <button ref={focusReturn} type="button" className="incoming-bubble" aria-expanded={open} aria-label={`Reservations and enquiries, ${unread.length} unread${error?', refresh unavailable':''}`} onClick={()=>setOpen(!open)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg> Requests {unread.length>0&&<b>{unread.length}</b>}{error&&<span aria-hidden="true">!</span>}</button>
 </aside>;
}
