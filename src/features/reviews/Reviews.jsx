import { useEffect, useRef, useState } from 'react';
import { supabase, isLocalMode } from '../../store.js';
export default function Reviews() {
 const loadVersion=useRef(0);
 const [rows,setRows]=useState([]),[filter,setFilter]=useState('pending'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[verified,setVerified]=useState({});
 async function load() {
  const version=++loadVersion.current; setLoading(true);setError('');
  try {const {data,error}=await supabase.rpc('staff_testimonials',{p_status:filter});if(error)throw error;if(version!==loadVersion.current)return;setRows(data||[]);setVerified({});}
  catch(e){if(version===loadVersion.current)setError(e.message||'Unable to load reviews');}finally{if(version===loadVersion.current)setLoading(false);}
 }
 useEffect(()=>{if(!isLocalMode&&supabase)load();else setLoading(false);},[filter]);
 async function moderate(row,status) {
  setBusy(true);setError('');
  try {const {error}=await supabase.rpc('moderate_testimonial',{p_id:row.id,p_revision:row.revision,p_status:status,p_verify_stay:!!verified[row.id]});if(error)throw error;await load();}
  catch(e){setError(e.message||'Unable to update review. Refresh and retry.');}finally{setBusy(false);}
 }
 return <section aria-labelledby="reviews-admin-title"><div className="row"><h2 id="reviews-admin-title">Resident reviews</h2><button type="button" onClick={load} disabled={busy||loading||isLocalMode}>Refresh</button></div><p>Check the private email against your tenant records before publishing. Review wording stays as submitted. Publishing, hiding and rejection are recorded in Activity.</p>{isLocalMode?<p>Review moderation is available when connected to the shared ledger.</p>:<><label>Show reviews <select value={filter} disabled={busy} onChange={e=>setFilter(e.target.value)}>{['pending','published','hidden','rejected','all'].map(s=><option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}</select></label><p role="alert">{error}</p>{loading?<p role="status">Loading reviews…</p>:!rows.length?<p>No {filter==='all'?'':filter+' '}reviews to show.</p>:<div className="review-admin-list">{rows.map(r=><article className="card review-admin-card" key={r.id}><div className="row"><h3>{r.display_name}</h3><span>{r.rating}/5 · {r.status}</span></div><p>{r.suburb||'Suburb not shared'} · Submitted {new Date(r.created_at).toLocaleDateString('en-AU')}</p><p><strong>Private verification email:</strong> {r.email}</p><blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{r.review}</blockquote>{r.status!=='published'&&<label className="row"><input type="checkbox" checked={!!verified[r.id]} disabled={busy} onChange={e=>setVerified(v=>({...v,[r.id]:e.target.checked}))}/>I checked the tenant records and confirmed this review is from a resident.</label>}<div className="actions">{r.status!=='published'&&<button type="button" disabled={busy||!verified[r.id]} onClick={()=>moderate(r,'published')}>Approve &amp; publish</button>}{r.status==='published'&&<button type="button" disabled={busy} onClick={()=>moderate(r,'hidden')}>Hide from website</button>}{r.status!=='rejected'&&r.status!=='published'&&<button type="button" disabled={busy} onClick={()=>moderate(r,'rejected')}>Reject</button>}</div></article>)}</div>}</>}</section>;
}
