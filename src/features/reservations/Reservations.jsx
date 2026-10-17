import {useEffect,useState} from 'react';
import {supabase,isLocalMode} from '../../store.js';

const STATES = ['pending','review','confirmed','cancelled','archived'];
const format = value => value ? new Date(value+'T00:00:00').toLocaleDateString('en-AU') : 'Not specified';
export default function Reservations({db}) {
 const [rows,setRows]=useState([]),[filter,setFilter]=useState('pending'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function refresh(){
  if(isLocalMode || !supabase){setError('Reservations require the connected database.');return;}
  setBusy(true);setError('');
  try {
   const {data,error:e}=await supabase.from('reservations').select('id,reservation_code,property_id,room_id,full_name,email,phone,arrival_date,departure_date,status,occupation_type,introduction,offer_type,spaces_requested,weekly_rate,created_at').order('created_at',{ascending:false}).limit(200);
   if(e)throw e;
   setRows(data||[]);
  }catch(e){setError(e.message||'Unable to load reservations.');}
  finally{setBusy(false);}
 }
 useEffect(()=>{refresh();},[]);
 const visible=filter==='all'?rows:rows.filter(r=>r.status===filter);
 return <section className="card" aria-label="Reservation management">
  <h2>Reservation inbox</h2>
  <p className="muted">Requests are private and do not reserve inventory. Confirmation is disabled until atomic availability checks and customer notifications are fully tested.</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
   {['all',...STATES].map(s=><button type="button" key={s} className={filter===s?'primary':''} onClick={()=>setFilter(s)}>{s} ({s==='all'?rows.length:rows.filter(r=>r.status===s).length})</button>)}
   <button type="button" onClick={refresh} disabled={busy}>{busy?'Refreshing…':'Refresh'}</button>
  </div>
  {error&&<p role="alert" className="err">{error}</p>}
  {!busy&&visible.length===0&&<p className="muted">No reservations in this view.</p>}
  {visible.map(r=><article className="card" key={r.id} style={{marginBottom:12}}>
   <h3>{r.full_name} · {r.reservation_code}</h3>
   <p><strong>Status:</strong> {r.status} · <strong>Dates:</strong> {format(r.arrival_date)} – {format(r.departure_date)}</p>
   <p><strong>Property:</strong> {db.properties.find(p=>p.id===r.property_id)?.name||'Unknown'} · <strong>Room:</strong> {db.rooms.find(room=>room.id===r.room_id)?.label||'Unknown'}</p>
   <p><strong>Offer:</strong> {r.offer_type||'Not specified'} · <strong>Spaces:</strong> {r.spaces_requested||1} · <strong>Weekly quote:</strong> {r.weekly_rate==null?'Not quoted':'$'+r.weekly_rate}</p>
   <p><strong>Contact:</strong> <a href={'mailto:'+r.email}>{r.email}</a> · <a href={'tel:'+r.phone}>{r.phone}</a></p>
   {r.introduction&&<p><strong>Introduction:</strong> {r.introduction}</p>}
  </article>)}
 </section>;
}
