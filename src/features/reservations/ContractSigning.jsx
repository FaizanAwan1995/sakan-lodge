import {useEffect,useState} from 'react';
import {supabase} from '../../store.js';
const time=value=>value?new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Adelaide'}):'—';
export default function ContractSigning({reservation,contract,requests=[],ready,busy,run,onReservation,reload}) {
  const request=requests.find(s=>s.contract_id===contract.id);
  const [days,setDays]=useState(7),[invitation,setInvitation]=useState(null),[link,setLink]=useState(''),[signedPdf,setSignedPdf]=useState(''),[opened,setOpened]=useState(null),[verified,setVerified]=useState(false),[reason,setReason]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{
    setVerified(false);setOpened(null);setInvitation(null);setLink('');setReason('');setMessage('');
    if(!request)return;
    let active=true;
    supabase.from('notification_outbox').select('id,recipient,payload,status').eq('kind','contract_signing').eq('payload->>signing_request_id',request.id).order('created_at',{ascending:false}).limit(1).maybeSingle().then(({data,error})=>{if(!active)return;if(error){setMessage('Could not load the invitation. Refresh this reservation.');return;}setInvitation(data);setLink(data?.payload?.body?.match(/https:\/\/sakanlodge\.com\/sign#[a-f0-9]{64}/)?.[0]||'');});
    return()=>{active=false;};
  },[request?.id]);
  useEffect(()=>()=>{if(signedPdf)URL.revokeObjectURL(signedPdf);},[signedPdf]);
  async function call(path,body) {
    const {data,error}=await supabase.auth.getSession();
    if(error||!data.session)throw Error('Sign in again before sending.');
    const r=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const out=await r.json();if(!r.ok)throw Error(out.error||'Unable to complete this action.');return out;
  }
  async function review(action) {
    const {data,error}=await supabase.rpc('review_contract_signing',{p_id:request.id,p_revision:reservation.revision,p_action:action,p_reason:action==='reject'?reason:null});
    if(error)throw error;onReservation(data);reload?.();
  }
  const active=['pending','review','held'].includes(reservation.status);
  return <section className="card contract-signing-admin" aria-label="Online agreement signing">
    <h4>2. Send for online signing</h4>
    <p>Email a private signing link. Each named resident signs online; the signed PDF returns here for review. Signing does not allocate the room or record any payment.</p>
    {request&&<p role="status"><strong>{request.status.replaceAll('_',' ')}</strong> · Link expires {time(request.expires_at)} (Adelaide){request.submitted_at&&<> · Signed {time(request.submitted_at)}</>}</p>}
    {message&&<p role="status">{message}</p>}
    {active&&!['signed','approved'].includes(request?.status)&&<>
      <label>Signing link valid for<select value={days} onChange={e=>setDays(Number(e.target.value))}>{[1,3,7,14].map(n=><option key={n} value={n}>{n} day{n>1?'s':''}</option>)}</select></label>
      {!ready&&<p>Open and review this version’s original PDF above before creating a signing link.</p>}
      <button disabled={busy||!ready} onClick={()=>run(async()=>{
        if(request&&['awaiting_signature','processing'].includes(request.status)&&!confirm('Replace the current signing link? The old link will stop working.'))return;
        const out=await call('/api/reservations/signing-link',{contract_id:contract.id,revision:reservation.revision,days});
        setInvitation(out.notification);setLink(out.url);setMessage('Signing link prepared. Review the email below, then send.');
      })}>{request?'Create a replacement signing link':'Create signing link and email draft'}</button>
    </>}
    {link&&request?.status==='awaiting_signature'&&<div className="card">
      <label>Private tenant signing link<input readOnly value={link} onFocus={e=>e.target.select()} /></label>
      <button disabled={busy} onClick={()=>run(async()=>{await navigator.clipboard.writeText(link);setMessage('Signing link copied.');})}>Copy signing link</button>
      {invitation&&<details open={invitation.status==='pending'}><summary>Review signing email · {invitation.status}</summary><p>To: <strong>{invitation.recipient}</strong> · From: sakanlodges@gmail.com</p><p><strong>{invitation.payload.subject}</strong></p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',font:'inherit'}}>{invitation.payload.body}</pre>
        <button disabled={busy||invitation.status!=='pending'||new Date(request.expires_at)<=new Date()} onClick={()=>run(async()=>{
          if(!confirm('Send the signing invitation to '+invitation.recipient+'?'))return;
          await call('/api/reservations/email',{id:invitation.id,confirmation:'SEND_REVIEWED_EMAIL'});setInvitation(old=>({...old,status:'sent'}));setMessage('Signing invitation sent. Waiting for the tenant to sign.');
        })}>Send signing invitation</button>
        {['sending','uncertain'].includes(invitation.status)&&<p role="alert">Delivery is uncertain. Reconcile this email in Activity before retrying; do not send duplicates.</p>}
      </details>}
      <button disabled={busy} onClick={()=>run(async()=>{if(confirm('Revoke this signing link? The tenant will need a new link.'))await review('revoke');})}>Revoke signing link</button>
    </div>}
    {request?.status==='processing'&&<p>The tenant’s signature is being saved. Ask them to retry on the same link if their connection was interrupted.</p>}
    {request?.signed_document_path&&<div>
      <h4>3. Review signed agreement</h4>
      <p>{request.signatures?.map(s=>s.name+' ('+s.mode+')').join('; ')}</p>
      <button disabled={busy} onClick={()=>run(async()=>{const {data,error}=await supabase.storage.from('reservation-contracts').download(request.signed_document_path);if(error)throw error;setSignedPdf(URL.createObjectURL(data));setOpened(request.id);setVerified(false);})}>Open signed PDF for review</button>
      {signedPdf&&opened===request.id&&<><p><a href={signedPdf} download="SAKAN-signed-agreement.pdf">Download signed agreement</a></p><iframe title="Signed agreement review" src={signedPdf} style={{width:'100%',height:560,border:'1px solid #ccc'}}/></>}
      {request.status==='signed'&&active&&<>
        <label><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/> I reviewed every resident signature, the applicant identity, room, dates, rent and bond. Approve the agreed room if it is still available.</label>
        <button className="primary" disabled={busy||opened!==request.id||!verified} onClick={()=>run(async()=>{if(confirm('Approve this signed agreement and allocate the tenant(s) to the agreed room? No bond or rent payment will be recorded.'))await review('approve');})}>Approve signed agreement and allocate room</button>
        <label>Reason for declining (shown to the applicant on their signing page)<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <button disabled={busy||reason.trim().length<3} onClick={()=>run(async()=>{if(confirm('Reject this request and release any hold? The signed copy and history will be retained.'))await review('reject');})}>Reject request</button>
        <p>Changing the room, dates, rent or terms requires a replacement agreement and fresh signatures. Availability is checked again when you approve.</p>
      </>}
      {request.status==='approved'&&<p>Approved {time(request.reviewed_at)}. The signed agreement is linked to the allocated tenant profile.</p>}
      {request.status==='rejected'&&<p>Rejected {time(request.reviewed_at)}: {request.review_reason}</p>}
    </div>}
  </section>;
}
