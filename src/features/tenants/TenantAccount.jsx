import PaymentReceipt from './PaymentReceipt.jsx';
import RentInvoices from './RentInvoices.jsx';
import StayHistory, { StaySummary } from './StayHistory.jsx';
import BondSettlement from './BondSettlement.jsx';
import AccountPayment from './AccountPayment.jsx';
import AccountTransactions from './AccountTransactions.jsx';
import BillingSchedule from './BillingSchedule.jsx';
import { accountSummary, billingTermsAt } from '../../ledger.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminTenantActions from '../reservations/AdminTenantActions.jsx';
import TenantStatements from '../reports/TenantStatements.jsx';
import { tenantReference, tenantStatus, occupancyEnd } from '../../tenant-model.js';
import { supabase, isLocalMode, removeTestTenant } from '../../store.js';
import { fmt, nice } from '../../lib/formatters.js';

export default function TenantAccount({ person, db, today, reload, onEdit, onSchedule, onPayment, onRemoved, backLabel = 'Rooms & residents' }) {
  const [receipt,setReceipt]=useState(null);
  const [tab,setTab]=useState('account');
  const [charge,setCharge]=useState(false);
  const [settlement,setSettlement]=useState(false);
  const [bondReceipt,setBondReceipt]=useState(false);
  const [copied,setCopied]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [bookings, setBookings] = useState([]);
  const [bookingError, setBookingError] = useState('');
  useEffect(() => {
    if (isLocalMode) return;
    let active = true;
    supabase.from('reservations').select('id,reservation_code,status,contracts(id,version,status,document_path,signed_document_path)')
      .or(`checked_in_person_id.eq.${person.id},assigned_people.cs.["${person.id}"]`)
      .then(({data,error}) => { if (active) { setBookings(data || []); setBookingError(error ? 'Unable to load linked bookings. Use Reservations or refresh this account.' : ''); } }).catch(() => { if (active) setBookingError('Unable to load linked bookings. Refresh this account.'); });
    return () => { active = false; };
  }, [person.id, db]);

  async function download(path) {
    setError('');
    try {
      const {data,error} = await supabase.storage.from('reservation-contracts').download(path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const link = document.createElement('a'); link.href = url; link.download = 'SAKAN-agreement.pdf'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Unable to download this contract. Refresh and try again.'); }
  }
  const hasFinance = db.payments.some(p => p.person_id === person.id) || db.charges.some(c => c.person_id === person.id) || Boolean(Number(person.opening_balance)) || (Number(person.bond) > 0 && ['paid','held'].includes(person.bond_status));
  const status = tenantStatus(person, today);
  const property = db.properties.find(p => p.id === person.property_id);
  const room = db.rooms.find(r => r.id === person.room_id);

  const summary=accountSummary(person,property,today);
  const raw=db.people.find(p=>p.id===person.id);
  const terms=billingTermsAt(person,today);
  const rentPayments=db.payments.filter(p=>p.person_id===person.id&&(p.kind||'rent')==='rent'&&p.date<=today).sort((a,b)=>b.date.localeCompare(a.date)||String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const latest=rentPayments[0];

  async function remove(event) {
    event.preventDefault();
    if (busy || reason.trim().length < 5) return;
    if (!window.confirm(`Remove the empty test record for ${person.name}? Activity history will remain. Real accounts with payments, charges or a linked booking cannot be deleted.`)) return;
    setBusy(true); setError('');
    try {
      await removeTestTenant(person.id, reason.trim());
      await reload();
      onRemoved();
    } catch (error) { setError(error.message || 'Unable to remove test record.'); }
    finally { setBusy(false); }
  }

  return <section className="tenant-account">
    <button type="button" className="small" onClick={onRemoved}>← {backLabel}</button>
    <div className="between screen-heading"><div><h1>{person.name}</h1><p>{status} · {property?.name || 'Unassigned property'} · {room?.label || 'No room'}</p></div><button type="button" onClick={onEdit}>Edit details</button></div>
    <section className="card tenant-essential"><div className="between"><h2>Tenant overview</h2><span className="tenant-reference">{tenantReference(person)}</span></div><dl className="tenant-facts"><div><dt>Email</dt><dd>{person.email?<a href={`mailto:${person.email}`}>{person.email}</a>:<button className="link" onClick={onEdit}>Add email</button>}</dd></div><div><dt>Phone</dt><dd>{person.phone?<a href={`tel:${person.phone}`}>{person.phone}</a>:<button className="link" onClick={onEdit}>Add phone</button>}</dd></div><div><dt>Room & property</dt><dd>{property?.name||'Unassigned'} · {room?.label||'No room'}</dd></div><div><dt>Agreed rent</dt><dd>{person.stay_type==='long'?`${fmt(terms.weekly_rate)} / week · ${fmt(terms.weekly_rate*2)} / fortnight`:`${fmt(person.nightly_rate)} / night`}</dd></div><div><dt>Check-in</dt><dd>{nice(person.start_date)}</dd></div><div><dt>Departure</dt><dd>{occupancyEnd(person)?nice(occupancyEnd(person)):'Ongoing stay'}</dd></div><div><dt>Bond</dt><dd>{fmt(person.bond_held)} held · {fmt(person.bond)} expected</dd></div><div><dt>Last recorded rent payment</dt><dd>{latest?`${fmt(latest.amount)} · ${nice(latest.date)} · ${latest.method}`:'No recorded rent payment'}</dd></div></dl>{person.paid_up_to&&<p className="muted">Imported paid-through baseline: {nice(person.paid_up_to)}. Later recorded payments are listed separately below.</p>}{person.legacy_bond_declared>0&&<p className="muted">Bond marked paid in the old profile; original receipt needs reconciliation.</p>}<div className="account-actions">{latest&&<button className="primary" onClick={()=>setReceipt(latest)}>Email receipt for last payment</button>}<button onClick={()=>setTab('invoices')}>View invoices & delivery logs</button></div></section>
    <div className="seg" aria-label="Tenant account sections">{['account','details','history','invoices','documents'].map(x=><button key={x} className={tab===x?'on':''} onClick={()=>setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
    {tab==='account' && <>
      <div className="account-metrics">
        <section className="card"><small>Outstanding</small><strong className={person.owed?'err':'ok'}>{fmt(person.owed)}</strong><small>{fmt(summary.overdue)} overdue · {fmt(summary.dueToday)} due today</small></section>
        <section className="card"><small>Credit</small><strong>{fmt(person.credit)}</strong><small>Available toward rent and charges</small></section>
        <section className="card"><small>Next rent charge</small><strong>{summary.next?fmt(summary.next.amount):'—'}</strong><small>{summary.next?nice(summary.next.due_date):'No further scheduled rent'}</small></section>
      </div>
      <div className="account-actions"><button className="primary" onClick={onPayment}>Record payment</button><button onClick={()=>setCharge(true)}>Add charge</button></div>
      <section className="card"><h2>Bond — separate from rent</h2><p>{fmt(person.bond_paid)} received · {fmt(person.bond_applied)} deducted for rent / charges · {fmt(person.bond_deducted)} other deductions · {fmt(person.bond_refunded)} refunded · {fmt(person.bond_held)} held</p>{person.legacy_bond_declared>0 && <p className="muted">Marked paid in the legacy profile, but receipt history is missing. Reconcile the original receipt before recording it; no receipt has been created automatically.</p>}{person.legacy_bond_declared>0 && <button onClick={()=>setBondReceipt(true)}>Record original bond receipt</button>}<button type="button" disabled={!(person.bond_held>0)} onClick={()=>setSettlement(true)}>Settle &amp; refund bond</button><p className="muted">Review pending rent, deduct agreed amounts and calculate the remaining refund in one place.</p></section>
      <StaySummary person={person} today={today}/>
      <AccountTransactions db={db} d={{people:[person]}} personId={person.id} today={today} reload={reload} onInvoices={()=>setTab('invoices')}/>
      <details className="card"><summary>Statement — charges, payments and running balance</summary><TenantStatements db={db} today={today} fixedPersonId={person.id}/></details>
      <BillingSchedule key={JSON.stringify(raw.billing_schedule)} person={raw} property={property} today={today} reload={reload}/>
      {charge && <AccountPayment person={person} db={db} today={today} reload={reload} initialKind="charge" onClose={()=>setCharge(false)}/>}
    </>}
    {tab==='invoices' && <><RentInvoices person={person}/><AccountTransactions db={db} d={{people:[person]}} personId={person.id} today={today} reload={reload} onInvoices={()=>setTab('invoices')}/></>}
    {tab==='history' && <StayHistory person={person} db={db} today={today}/>}
    {receipt&&<PaymentReceipt key={receipt.id} payment={receipt} onClose={()=>setReceipt(null)} onInvoices={()=>setTab('invoices')}/>}
    {settlement && <BondSettlement person={person} reload={reload} onClose={()=>setSettlement(false)}/>}
    {bondReceipt && <AccountPayment person={person} db={db} today={today} reload={reload} initialKind="bond" onClose={()=>setBondReceipt(false)}/>}
    {tab==='details' && <>
      <section className="card"><h2>Stay & contact</h2><p>Arrives {nice(person.start_date)}{person.checked_out_at ? ` · Departed ${nice(occupancyEnd(person))}` : person.end_date ? ` · Departure ${nice(person.end_date)}` : ''}</p><p>{person.email || 'No email'}<br />{person.phone || 'No phone'}</p><p>{person.stay_type==='long'?`${fmt(terms.weekly_rate)}/week`:`${fmt(person.nightly_rate)}/night`}</p><p className="tenant-reference">Tenant ID <code>{tenantReference(person)}</code></p><button className="small" onClick={async()=>{try{await navigator.clipboard.writeText(person.id);setCopied(true);}catch{setError('Unable to copy. Select the tenant ID above.');}}}>{copied?'Copied':'Copy tenant ID'}</button></section>
    <section className="card"><h2>Manage tenancy</h2><p>Checkout frees the bed. Clearing dues records an admin credit. Neither action deletes the financial history.</p>
      {status !== 'Checked out' && <button type="button" className="small" onClick={onSchedule}>Schedule departure</button>}
      <AdminTenantActions key={person.id} person={person} today={today} reload={reload} allowCheckout={status !== 'Checked out'} />
      <p className="muted">Approved, ready website listings use the same occupancy records. <Link to="/reservations">Bookings & listing readiness</Link></p>
    </section>
    </>}
    {error && <p role="alert" className="err">{error}</p>}
    {tab==='documents' && <><section className="card"><h2>Resident documents</h2>{person.document_url ? <a href={person.document_url} target="_blank" rel="noreferrer">Open resident document</a> : <p>No resident document link.</p>}<p>{person.document_notes}</p></section>
    <details className="card" open><summary>Bookings & contracts</summary><p>Contracts keep the details agreed at the time. Current contact details are edited in this account.</p>{bookingError && <p role="alert">{bookingError}</p>}{!bookingError && !bookings.length && <p>No linked online bookings.</p>}{bookings.map(booking => <section key={booking.id}><h3>{booking.reservation_code} · {booking.status}</h3>{[...(booking.contracts || [])].sort((a,b) => b.version-a.version).map(contract => <p key={contract.id}>Version {contract.version} · {contract.status}{contract.document_path && <button type="button" className="small" onClick={() => download(contract.document_path)}>Open PDF</button>}{contract.signed_document_path && <button type="button" className="small" onClick={() => download(contract.signed_document_path)}>Signed copy</button>}</p>)}</section>)}</details>
    </>}
    {tab==='details' && <details className="card"><summary>Remove an empty test record</summary><p>Only unused test records can be removed. Accounts with recorded transactions, a declared paid bond or linked bookings are retained; check those tenants out instead. Activity logs remain unchanged.</p>
      {hasFinance || bookings.length ? <p>Recorded financial history or a linked booking prevents deletion.</p> : <form onSubmit={remove}><label>Reason<input required minLength={5} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label><button type="submit" disabled={busy}>{busy ? 'Removing…' : 'Remove test tenant'}</button></form>}

    </details>}
  </section>;
}
