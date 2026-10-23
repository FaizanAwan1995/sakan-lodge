import { useEffect, useRef, useState } from 'react';
import { accountTransaction, getLocalActor } from '../../store.js';
import { accountChoices } from '../../app-helpers.js';
import { findPossibleDuplicatePayment } from '../../financial-safety.js';
import { balance, money } from '../../ledger.js';
import { fmt, nice } from '../../lib/formatters.js';

export default function AccountPayment({ person, db, today, reload, onClose, original = null, initialKind = 'rent' }) {
  const dialog = useRef(null);
  const saving = useRef(false);
  const request = useRef(crypto.randomUUID());
  const attempted = useRef(null);
  const [kind, setKind] = useState(original?.kind || initialKind);
  const [amount, setAmount] = useState(original?.amount ?? (initialKind === 'rent' && person.owed ? person.owed : ''));
  const [date, setDate] = useState(original?.date || today);
  const [method, setMethod] = useState(original?.method === 'transfer' ? 'transfer' : 'cash');
  const [by, setBy] = useState(original?.received_by || getLocalActor() || localStorage.getItem('receivedBy') || 'Faizan');
  const [note, setNote] = useState(original?.note || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  useEffect(() => { const el=dialog.current;el.showModal();return ()=>el.close(); }, []);
  function close() {
    if (saving.current) return;
    if (attempted.current && !saved && !confirm('The previous request may have saved. Retry with the same details to confirm, or close and check transaction history before recording again. Close now?')) return;
    onClose();
  }
  const data = {kind,amount:+amount,date,method,received_by:by,note};
  const payments = person.payments.filter(p=>p.id!==original?.id);
  const preview = balance(kind==='charge' ? [...person.charges,{due_date:date,amount:+amount}] : person.charges, kind==='charge' ? payments : [...payments,data],today);
  const bondAfter = money(payments.filter(p=>p.date<=today).reduce((n,p)=>n+(p.kind==='bond'?+p.amount:['bond_refund','bond_deducted'].includes(p.kind)?-p.amount:0),0)+(date<=today?(kind==='bond'?+amount:['bond_refund','bond_deducted'].includes(kind)?-amount:0):0));
  async function submit(event) {
    event.preventDefault();
    if(saving.current || saved) return;
    const payload = attempted.current || {data,reason:reason || null};
    if(!attempted.current && kind!=='charge') {
      const duplicate=findPossibleDuplicatePayment(db.payments,{...data,person_id:person.id},original?.id);
      if(duplicate && !confirm(`A similar payment of ${fmt(duplicate.amount)} exists on ${nice(duplicate.date)}. Record another intentional payment?`)) return;
    }
    saving.current=true;setBusy(true);setError('');attempted.current=payload;
    try {
      const result=await accountTransaction(request.current,person.id,payload.data,original,payload.reason);
      setSaved(result);localStorage.setItem('receivedBy',by);
      await reload();
    } catch(e) {if(e.code && !['PGRST000','PGRST001','PGRST002'].includes(e.code)){attempted.current=null;request.current=crypto.randomUUID();}setError(e.message || 'Unable to confirm this transaction. Retry uses the same request and cannot duplicate it.');}
    finally {saving.current=false;setBusy(false);}
  }
  return <dialog ref={dialog} className="account-dialog" aria-labelledby="payment-heading" onCancel={e=>{e.preventDefault();close();}}>
    <div className="between"><h2 id="payment-heading">{original?'Correct transaction':initialKind==='charge'?'Add charge':'Record payment'}</h2><button type="button" aria-label="Close payment form" disabled={busy} onClick={close}>×</button></div>
    <p><strong>{person.name}</strong> · {db.properties.find(p=>p.id===person.property_id)?.name} · {db.rooms.find(r=>r.id===person.room_id)?.label}</p>
    {saved ? <div role="status"><h3>Saved successfully</h3><p>{fmt(saved.amount)} · {nice(saved.date || saved.due_date)} · {kind.replaceAll('_',' ')}</p><p>The account and Home balances have been refreshed.</p><button className="primary" onClick={onClose}>Done</button></div> : <form onSubmit={submit}>
      <fieldset disabled={busy || Boolean(attempted.current)}>
        <label>Transaction<select value={kind} onChange={e=>setKind(e.target.value)}>{(initialKind==='charge'?['charge']:['rent','bond','bond_refund','bond_deducted']).map(k=><option key={k} value={k}>{{rent:'Rent received',bond:'Bond received',bond_refund:'Bond refunded',bond_deducted:'Bond retained',charge:'Extra charge'}[k]}</option>)}</select></label>
        <div className="account-form-grid"><label>Amount ($)<input type="number" step="0.01" min="0.01" inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)} autoFocus /></label><label>Date<input type="date" required max={today} value={date} onChange={e=>setDate(e.target.value)} /></label></div>
        {kind!=='charge' && <div className="account-form-grid"><label>Method<select value={method} onChange={e=>setMethod(e.target.value)}><option value="cash">Cash</option><option value="transfer">Transfer</option></select></label><label>Received / handled by<select value={by} onChange={e=>setBy(e.target.value)}>{accountChoices().map(x=><option key={x}>{x}</option>)}</select></label></div>}
        {(original || kind==='charge') && <label>Reason (retained in history)<input required minLength={5} value={reason} onChange={e=>setReason(e.target.value)} /></label>}
        <details><summary>Reference or notes</summary><label>Notes<textarea value={note} onChange={e=>setNote(e.target.value)} /></label></details>
      </fieldset>
      <p className="account-preview">After saving: <strong>{fmt(preview.owed || preview.credit)} {preview.owed?'outstanding':preview.credit?'credit':'rent due'}</strong>{(kind.startsWith('bond') || original?.kind?.startsWith('bond')) && <> · Bond held {fmt(bondAfter)}</>}</p>
      {error && <p className="err" role="alert">{error} Retry confirms the original request. For changed details, close and check history first.</p>}
      <button className="primary" disabled={busy}>{busy?'Saving…':attempted.current?'Retry same transaction':original?'Save correction':'Save transaction'}</button>
    </form>}
  </dialog>;
}
