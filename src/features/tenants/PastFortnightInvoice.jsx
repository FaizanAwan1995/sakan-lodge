import {useEffect,useRef,useState} from 'react';
import {supabase,isLocalMode} from '../../store.js';
import {fmt,nice} from '../../lib/formatters.js';

export default function PastFortnightInvoice({person,today,onClose,onInvoices}) {
 const dialog=useRef(null),[start,setStart]=useState(''),[amount,setAmount]=useState(String(Number(person.weekly_rate||0)*2)),[reason,setReason]=useState(''),[doc,setDoc]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[saved,setSaved]=useState(null);
 useEffect(()=>{dialog.current?.showModal();},[]);
 const args={p_person:person.id,p_start:start,p_amount:Number(amount),p_reason:reason.trim()};
 const end=start?new Date(Date.parse(start+'T00:00:00Z')+13*86400000).toISOString().slice(0,10):'';
 function change(setter,value){setter(value);setDoc(null);setConfirmed(false);setError('');}
 async function preview(event){event.preventDefault();setBusy(true);setError('');setDoc(null);setConfirmed(false);try{if(isLocalMode)throw Error('Invoices are available in the shared ledger.');const r=await supabase.rpc('staff_past_fortnight_invoice',{...args,p_action:'preview'});if(r.error)throw r.error;setDoc(r.data);}catch(e){setError(e.message||'Unable to preview invoice.');}finally{setBusy(false);}}
 async function issue(){setBusy(true);setError('');try{const r=await supabase.rpc('staff_past_fortnight_invoice',{...args,p_action:'issue',p_expected:doc.snapshot});if(r.error)throw r.error;setSaved(r.data);}catch(e){setError(e.message||'Unable to issue invoice. Review the preview before retrying.');setConfirmed(false);}finally{setBusy(false);}}
 async function pdf(){setBusy(true);setError('');try{const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Sign in again to preview the invoice.');const r=await fetch('/api/rent-invoices/preview',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({person_id:person.id,start,amount:Number(amount),reason:reason.trim()})});if(!r.ok)throw Error('Unable to preview PDF. Check the property address and your session.');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='SAKAN-past-fortnight-preview.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const existing=saved||doc?.existing&&doc;
 return <dialog ref={dialog} className="account-dialog" aria-labelledby="past-invoice-heading" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <div className="between"><h2 id="past-invoice-heading">Invoice for a past fortnight</h2><button disabled={busy} onClick={onClose} aria-label="Close invoice">×</button></div>
  <p>{person.name} · Paid rent confirmed by an administrator. This does not record another payment or change the tenant balance.</p>
  {error&&<p role="alert" className="err">{error}</p>}
  {existing?<div role="status"><p>Invoice <strong>#{existing.number}</strong> · {existing.status.replaceAll('_',' ')}</p><p>{saved&&!saved.existing?'Created and queued for email from sakanlodges@gmail.com. Check invoice history for delivery confirmation.':'This fortnight already has an invoice. Its original number is retained.'}</p><button className="primary" onClick={()=>{onClose();onInvoices();}}>Open invoice history</button></div>:<>
   <form onSubmit={preview}><fieldset disabled={busy}><div className="account-form-grid">
    <label>Fortnight starts<input type="date" required min={person.start_date} max={today} value={start} onChange={e=>change(setStart,e.target.value)}/></label>
    <label>Amount paid (AUD)<input type="number" required min="0.01" max="100000" step="0.01" value={amount} onChange={e=>change(setAmount,e.target.value)}/></label>
   </div>{end&&<p>Rent period: {nice(start)} – {nice(end)}</p>}<label>How was payment confirmed?<textarea required minLength={5} maxLength={500} value={reason} onChange={e=>change(setReason,e.target.value)} placeholder="For example: paid in the imported ledger; confirmed by admin"/></label><button type="submit">Review invoice</button></fieldset></form>
   {doc&&<><h3>{fmt(doc.snapshot.payment.amount)} · Paid — admin confirmed</h3><p>{doc.snapshot.address||'Property invoice address is missing.'}</p><p>From: sakanlodges@gmail.com<br/>To: {doc.snapshot.tenant_email||'Tenant email is missing.'}<br/>CC: {(doc.snapshot.cc||[]).join(', ')}</p><p>The next invoice number is assigned when you issue it. Previewing uses no number.</p><label className="receipt-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this rent was paid and the period, amount and recipients are correct.</label><div className="account-actions"><button disabled={busy||!doc.snapshot.address} onClick={pdf}>Preview PDF</button><button className="primary" disabled={busy||!confirmed||!doc.snapshot.address||!doc.snapshot.tenant_email} onClick={issue}>Issue &amp; email invoice</button></div></>}
  </>}{busy&&<p role="status">Processing…</p>}
 </dialog>;
}
