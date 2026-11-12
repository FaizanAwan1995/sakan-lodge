import {inboxSection,noticeKey,requestDestination,inboxCounts,markSectionRead,combineRequests,requestBadgeCount} from '../../request-inbox.js';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, isLocalMode } from '../../store.js';

export default function IncomingAlerts({userId}) {
 const location=useLocation(),navigate=useNavigate();
 const [open,setOpen]=useState(()=>new URLSearchParams(location.search).has('enquiries'));
 const [section,setSection]=useState(()=>new URLSearchParams(location.search).has('enquiries')?'enquiries':'reservations');
 const [includeEmails,setIncludeEmails]=useState(false);
 const chosenSection=useRef(false);
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[warnings,setWarnings]=useState(0);
 const storageKey='sakan-incoming-seen:'+userId;
 const [seen,setSeen]=useState(()=>{try{const value=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(value)?value:[];}catch{return [];}});
 const previous=useRef(null),focusReturn=useRef(null),panel=useRef(null);
 useEffect(()=>{if(new URLSearchParams(location.search).has('enquiries')){setSection('enquiries');setOpen(true);}},[location.search]);
 useEffect(()=>{
  if(isLocalMode||!supabase)return;let alive=true,busy=false;
  const refresh=async()=>{
   if(busy||document.hidden)return;busy=true;
   try{
    const [reservations,enquiries,deliveries,emailThreads]=await Promise.all([
     supabase.from('reservations').select('id,reservation_code,full_name,arrival_date,departure_date,spaces_requested,status,created_at').in('status',['pending','review']).order('created_at',{ascending:false}).limit(100),
     supabase.from('website_enquiries').select('id,reference,details,created_at').order('created_at',{ascending:false}).limit(100),
     supabase.from('incoming_alert_deliveries').select('id',{count:'exact',head:true}).eq('status','uncertain'),
     supabase.from('enquiry_threads').select('id,source,website_enquiry_id,subject,status,contact_name,contact_email,last_message_at').order('last_message_at',{ascending:false}).limit(100)
    ]);
    if(reservations.error||enquiries.error||deliveries.error||emailThreads.error)throw Error('Alerts could not refresh. Try again shortly.');
    if(!alive)return;
    const next=combineRequests(reservations.data||[],enquiries.data||[],emailThreads.data||[]);
    if(!chosenSection.current&&!next.some(r=>r.kind==='reservation')&&next.some(r=>r.kind==='enquiry'))setSection('enquiries');
    // Announce new arrivals without interrupting work or opening a modal.
    const ids=new Set(next.map(noticeKey));if(previous.current&&next.some(r=>(includeEmails||r.kind!=='email')&&!previous.current.has(noticeKey(r))))setAnnouncement('New reservation or enquiry received. Open notifications to review.');previous.current=ids;
    setRows(next);setWarnings(deliveries.count||0);setError('');
   }catch(e){if(alive)setError(e.message);}finally{busy=false;}
  };
  refresh();const timer=setInterval(refresh,15000);
  const channel=supabase.channel('ledger-incoming-alerts:'+userId).on('postgres_changes',{event:'INSERT',schema:'public',table:'reservations'},refresh).subscribe();
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{alive=false;clearInterval(timer);supabase.removeChannel(channel);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[userId,includeEmails]);
 const [announcement,setAnnouncement]=useState('');
 const counts=inboxCounts(rows,seen);
 const visible=rows.filter(r=>inboxSection(r)===section&&(includeEmails||r.kind!=='email'));
 const unread=requestBadgeCount(counts);
 const markRead=()=>{const ids=markSectionRead(rows,seen,section);setSeen(ids);try{localStorage.setItem(storageKey,JSON.stringify(ids));}catch{}setAnnouncement('This section marked read on this device.');};
 const openRequest=r=>{close();navigate(requestDestination(r));window.scrollTo(0,0);};
 const chooseSection=value=>{chosenSection.current=true;setSection(value);panel.current?.querySelector('.incoming-list')?.scrollTo(0,0);};
 const when=value=>new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Adelaide',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 const day=value=>value?new Date(value+'T00:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'}):'';
 const close=()=>{setOpen(false);focusReturn.current?.focus();};
 useEffect(()=>{if(open)panel.current?.querySelector('button')?.focus();},[open]);
 if(isLocalMode)return null;
 return <aside className="incoming-alerts" aria-label="Shared request inbox">
  <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  {open&&<section ref={panel} className="incoming-panel" aria-label="Request inbox" onKeyDown={e=>{if(e.key==='Escape')close();}}>
   <div className="incoming-heading"><div><h2>Request inbox</h2><p>Reservations and website enquiries.</p></div><button type="button" onClick={close} aria-label="Close inbox">×</button></div>
   <div className="incoming-sections" role="tablist" aria-label="Request type">{[['reservations','Reservations'],['enquiries','Website'],...(includeEmails?[['emails','Emails']]:[])].map(([key,label])=><button key={key} id={'incoming-tab-'+key} role="tab" aria-selected={section===key} aria-controls="incoming-items" className={key} onClick={()=>chooseSection(key)}>{label}{key!=='emails'&&<b>{counts[key].total}</b>}{key!=='emails'&&counts[key].unread>0&&<span className="incoming-tab-unread" aria-label={counts[key].unread+' unread'}>New {counts[key].unread}</span>}</button>)}</div>
   <div className="incoming-email-option"><label><input type="checkbox" checked={includeEmails} onChange={e=>{setIncludeEmails(e.target.checked);if(!e.target.checked&&section==='emails')setSection('enquiries');}} />Show emails <span>Optional · excluded from inbox count</span></label></div>
   {error&&<p className="incoming-error" role="status">{error}</p>}
   {warnings>0&&<p className="incoming-error" role="status">{warnings} email deliveries need confirmation before resending.</p>}
   <div className="incoming-toolbar"><span>{section==='emails'?'Optional email conversations':counts[section].unread+' unread '+(section==='enquiries'?'website enquiries':'reservations')}</span><button type="button" onClick={markRead} disabled={!counts[section].unread}>Mark section read</button></div>
   <div className="incoming-list" id="incoming-items" role="tabpanel" aria-labelledby={'incoming-tab-'+section} tabIndex="0">{visible.length?visible.map(r=>{const isNew=!seen.includes(noticeKey(r));return <article key={r.id} className={'incoming-request-card '+(r.kind==='reservation'?'incoming-reservation':'incoming-enquiry')+(isNew?' incoming-unread':'')}>
    <div className="incoming-card-top"><span className={'incoming-type incoming-type-'+r.kind}>{r.kind==='reservation'?'Reservation':r.kind==='email'?'Email enquiry':'Website enquiry'}</span>{isNew&&<span className="incoming-new">Unread</span>}<time dateTime={r.created_at}>{when(r.activity_at||r.created_at)}</time></div>
    <strong className="incoming-guest">{r.name}</strong>
    <small className="incoming-reference" title={r.reference}>{r.kind==='reservation'?'Booking '+String(r.reference||'').slice(0,11)+'…':r.reference}</small>
    {r.kind==='reservation'?<><p className="incoming-stay">{day(r.arrival_date)} → {day(r.departure_date)}{r.spaces_requested?' · '+r.spaces_requested+' person'+(r.spaces_requested>1?'s':''):''}</p><p className="incoming-summary">{r.status==='review'?'Under review':'Awaiting review'} · Booking request</p><button type="button" className="incoming-open-reservation" onClick={()=>openRequest(r)}>Open reservation →</button></>:<>
    {r.kind==='enquiry'?<><p className="incoming-summary">{r.details.location} · {r.details.accommodation}{r.details.occupants?' · '+r.details.occupants+' people':''}</p>{r.details.move_in&&<p className="incoming-move-in">Move-in: {day(r.details.move_in)}</p>}<p className="incoming-excerpt">{r.details.message}</p><details className="incoming-full-details"><summary>Full enquiry & contact details</summary><p>{r.details.email}</p><p>{r.details.phone}</p><p className="incoming-message">{r.details.message}</p></details></>:<p className="incoming-summary">{r.contact_email}</p>}
    <button type="button" className="incoming-open-enquiry" onClick={()=>openRequest(r)}>View history & reply →</button></>}
   </article>;}):<div className="incoming-empty"><strong>No {section} to review</strong><p>{section==='reservations'?'New booking requests will appear here.':section==='emails'?'Email conversations appear here when Gmail is connected.':'New website enquiries will appear here.'}</p></div>}</div>
   <div className="incoming-panel-footer"><button type="button" onClick={()=>{close();navigate(section==='emails'?'/enquiries?source=email':section==='enquiries'?'/enquiries':'/reservations');window.scrollTo(0,0);}}>Open all {section} →</button></div>
  </section>}
  <button ref={focusReturn} type="button" className="incoming-bubble" aria-expanded={open} aria-label={`Request inbox, ${unread} unread${error?', refresh unavailable':''}`} onClick={()=>setOpen(!open)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg> Inbox {unread>0&&<b>{unread}</b>}{error&&<span aria-hidden="true">!</span>}</button>
 </aside>;
}
