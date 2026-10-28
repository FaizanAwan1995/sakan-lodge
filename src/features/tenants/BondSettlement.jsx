import { useEffect, useRef, useState } from 'react';
import { settleTenantBond, getLocalActor } from '../../store.js';
import { guidedSettlementPlan } from '../../bond-settlement.js';
import { accountChoices } from '../../app-helpers.js';
import { fmt } from '../../lib/formatters.js';

export default function BondSettlement({person,reload,onClose}) {
 const dialog=useRef(null), saving=useRef(false), request=useRef(crypto.randomUUID()), attempted=useRef(null);
 const initial=Math.min(person.owed,person.bond_held);
 const [deductRent,setDeductRent]=useState(person.owed>0);
 const [applied,setApplied]=useState(initial);
 const [other,setOther]=useState(false), [retained,setRetained]=useState(''), [otherReason,setOtherReason]=useState('');
 const [refundPaid,setRefundPaid]=useState(false), [note,setNote]=useState('');
 const [by,setBy]=useState(accountChoices().includes(getLocalActor())?getLocalActor():'Faizan'), [method,setMethod]=useState('transfer');
 const [busy,setBusy]=useState(false), [error,setError]=useState(''), [result,setResult]=useState(null);
 useEffect(()=>{const el=dialog.current;el.showModal();return()=>el.close();},[]);
 const rentAmount=deductRent ? Number(applied) : 0, otherAmount=other ? Number(retained) : 0;
 let plan,validation='';
 try {
  plan=guidedSettlementPlan(person,rentAmount,otherAmount,refundPaid);
  if(deductRent && person.owed>0 && !(rentAmount>0)) validation='Enter the rent deduction amount, or choose No to leave rent outstanding.';
  if(other && (!(otherAmount>0) || otherReason.trim().length<5)) validation='Enter the other deduction amount and a reason of at least five characters.';
 } catch(e){validation=e.message;}
 const noAction=!refundPaid && rentAmount===0 && otherAmount===0;
 if(noAction) validation='Choose a deduction to save, or select “Refund already paid” to record the refund.';
 function close(){if(saving.current)return;if(attempted.current&&!result&&!confirm('Settlement may already have saved. Retry the same request to confirm, or check transaction history before trying a new settlement. Close now?'))return;onClose();}
 async function submit(e){
  e.preventDefault();if(saving.current||result||(!attempted.current&&validation))return;
  const data=attempted.current||{apply_amount:rentAmount,retain_amount:otherAmount,retain_reason:other ? otherReason.trim() : '',refund_amount:plan.refunded,expected_held:person.bond_held,expected_owed:person.owed,reason:`Bond settlement: ${fmt(rentAmount)} to outstanding rent / charges; ${fmt(otherAmount)} other deductions; ${fmt(plan.refunded)} refund paid.${note.trim() ? ' '+note.trim() : ''}`,handled_by:by,method};
  saving.current=true;setBusy(true);setError('');attempted.current=data;
  try{const saved=await settleTenantBond(request.current,person.id,data);setResult(saved);await reload();}
  catch(e){if(e.code&&!['PGRST000','PGRST001','PGRST002'].includes(e.code)){attempted.current=null;request.current=crypto.randomUUID();}setError(e.message||'Unable to confirm settlement. Retry uses the same request.');}
  finally{saving.current=false;setBusy(false);}
 }
 return <dialog ref={dialog} className="account-dialog" aria-labelledby="settle-bond-title" onCancel={e=>{e.preventDefault();close();}}>
  <div className="between"><h2 id="settle-bond-title">Settle &amp; refund bond</h2><button type="button" aria-label="Close bond settlement" onClick={close} disabled={busy}>×</button></div>
  <p><strong>{person.name}</strong></p>
  {result ? <div role="status"><h3>Bond settlement saved</h3><p>Deducted for rent / charges: <strong>{fmt(result.applied)}</strong><br/>Other deductions: {fmt(result.retained || 0)}<br/>Refund recorded as paid: <strong>{fmt(result.refunded)}</strong></p><p>Remaining rent due: {fmt(result.owed)} · Bond remaining to return: <strong>{fmt(result.bond_held)}</strong></p><p>Balances, statements and reports have been updated.</p><button type="button" className="primary" onClick={onClose}>Done</button></div> : <form onSubmit={submit}>
   <p className="account-preview">Bond currently held: <strong>{fmt(person.bond_held)}</strong><br/>Pending rent / charges: <strong>{fmt(person.owed)}</strong></p>
   <fieldset disabled={busy||Boolean(attempted.current)}>
    <h3>1. Check pending rent</h3>
    {person.owed>0 ? <>
     <label>Deduct pending rent / charges from the bond?<select value={deductRent?'yes':'no'} onChange={e=>setDeductRent(e.target.value==='yes')}><option value="yes">Yes — deduct from bond</option><option value="no">No — leave the balance outstanding</option></select></label>
     {deductRent && <label>Rent / charges to deduct ($)<input type="number" min="0.01" step="0.01" max={Math.min(person.owed,person.bond_held)} required value={applied} onChange={e=>setApplied(e.target.value)}/></label>}
     <p className="muted">This settles charges already on the account, including final-week rent. Check the recorded stay dates first; do not add the same rent again.</p>
    </> : <p>No pending rent or charges. No rent deduction is needed.</p>}
    <h3>2. Other deductions, if needed</h3>
    <label><input type="checkbox" style={{width:'auto'}} checked={other} onChange={e=>setOther(e.target.checked)}/> Add an agreed deduction for damage, cleaning or another reason</label>
    {other && <><p className="muted">Only enter items not already included in pending charges above. This deduction reduces the bond, not the rent balance.</p><label>Other deduction ($)<input type="number" min="0.01" step="0.01" required value={retained} onChange={e=>setRetained(e.target.value)}/></label><label>Other deduction reason<input required minLength={5} value={otherReason} onChange={e=>setOtherReason(e.target.value)}/></label></>}
    <h3>3. Return the remainder</h3>
    <label>Refund status<select value={refundPaid?'paid':'later'} onChange={e=>setRefundPaid(e.target.value==='paid')}><option value="later">Refund later — keep the remainder held</option><option value="paid">Refund already paid — record it now</option></select></label>
    {refundPaid && <label>Refund method<select value={method} onChange={e=>setMethod(e.target.value)}><option value="transfer">Transfer</option><option value="cash">Cash</option></select></label>}
    <label>Handled by<select value={by} onChange={e=>setBy(e.target.value)}>{accountChoices().map(x=><option key={x}>{x}</option>)}</select></label>
    <details><summary>Settlement note (optional)</summary><label>Note<textarea value={note} onChange={e=>setNote(e.target.value)}/></label></details>
    <label><input type="checkbox" required style={{width:'auto'}}/> {refundPaid ? 'I confirm the deductions are agreed or authorised and the refund shown below has been paid.' : 'I confirm these deductions are agreed or authorised. The remaining bond has not been refunded.'}</label>
   </fieldset>
   {plan && <div className="account-preview"><p>Bond {fmt(person.bond_held)} − rent / charges {fmt(plan.applied)} − other deductions {fmt(plan.retained)} = <strong>{fmt(plan.refundable)} refundable</strong></p><p>After saving: <strong>{fmt(plan.owed)} rent / charges outstanding</strong> · {fmt(plan.bond_held)} bond still held{refundPaid && <> · {fmt(plan.refunded)} refund recorded</>}</p></div>}
   {validation && <p className={noAction?'muted':'err'} role="status">{validation}</p>}
   {error && <p role="alert" className="err">{error}</p>}
   <button className="primary" disabled={busy||(!attempted.current&&Boolean(validation))}>{busy?'Saving…':attempted.current?'Retry same settlement':refundPaid?`Confirm ${fmt(plan?.refunded || 0)} refund paid`:'Save deductions — refund later'}</button>
  </form>}
 </dialog>;
}
