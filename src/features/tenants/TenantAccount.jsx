import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminTenantActions from '../reservations/AdminTenantActions.jsx';
import TenantStatements from '../reports/TenantStatements.jsx';
import { tenantReference, tenantStatus } from '../../tenant-model.js';
import { supabase, isLocalMode, removeTestTenant } from '../../store.js';
import { fmt, nice } from '../../lib/formatters.js';

export default function TenantAccount({ person, db, today, reload, onEdit, onSchedule, onPayment, onRemoved }) {
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
    <button type="button" className="small" onClick={onRemoved}>← Rooms & residents</button>
    <div className="between screen-heading"><div><h1>{person.name}</h1><p>{status} · {property?.name || 'Unassigned property'} · {room?.label || 'No room'}</p></div><button type="button" onClick={onEdit}>Edit details</button></div>
    <p className="tenant-reference">Tenant ID <code>{tenantReference(person)}</code></p>
    <div className="tenant-account-summary">
      <section className="card"><h2>Rent account</h2><strong className={person.owed > 0 ? 'err' : 'ok'}>{fmt(person.owed > 0 ? person.owed : person.credit)} {person.owed > 0 ? 'outstanding' : person.credit > 0 ? 'credit' : 'due'}</strong><p>Rent and extra charges, less payments and admin credits. Bond is tracked separately.</p><button type="button" onClick={onPayment}>Record payment or bond transaction</button></section>
      <section className="card"><h2>Bond</h2><p>{fmt(person.bond_paid)} received · {fmt(person.bond_held)} held</p><p>Expected {fmt(person.bond)}. Refunds and retained amounts are recorded as bond transactions.</p></section>
      <section className="card"><h2>Stay & contact</h2><p>Arrives {nice(person.start_date)}{person.end_date ? ` · Departure ${nice(person.end_date)}` : ''}</p><p>{person.email || 'No email'}<br />{person.phone || 'No phone'}</p>{person.document_url && <a href={person.document_url} target="_blank" rel="noreferrer">Open resident document</a>}</section>
    </div>
    <section className="card"><h2>Manage tenancy</h2><p>Checkout frees the bed. Clearing dues records an admin credit. Neither action deletes the financial history.</p>
      {status !== 'Checked out' && <button type="button" className="small" onClick={onSchedule}>Schedule departure</button>}
      <AdminTenantActions key={person.id} person={person} today={today} reload={reload} allowCheckout={status !== 'Checked out'} />
      <p className="muted">Approved, ready website listings use the same occupancy records. <Link to="/reservations">Bookings & listing readiness</Link></p>
    </section>
    {error && <p role="alert" className="err">{error}</p>}
    <details className="card"><summary>Bookings & contracts</summary><p>Contracts keep the details agreed at the time. Current contact details are edited in this account.</p>{bookingError && <p role="alert">{bookingError}</p>}{!bookingError && !bookings.length && <p>No linked online bookings.</p>}{bookings.map(booking => <section key={booking.id}><h3>{booking.reservation_code} · {booking.status}</h3>{[...(booking.contracts || [])].sort((a,b) => b.version-a.version).map(contract => <p key={contract.id}>Version {contract.version} · {contract.status}{contract.document_path && <button type="button" className="small" onClick={() => download(contract.document_path)}>Open PDF</button>}{contract.signed_document_path && <button type="button" className="small" onClick={() => download(contract.signed_document_path)}>Signed copy</button>}</p>)}</section>)}</details>
    <TenantStatements db={db} today={today} fixedPersonId={person.id} />
    <details className="card"><summary>Remove an empty test record</summary><p>Only unused test records can be removed. Accounts with recorded transactions, a declared paid bond or linked bookings are retained; check those tenants out instead. Activity logs remain unchanged.</p>
      {hasFinance || bookings.length ? <p>Recorded financial history or a linked booking prevents deletion.</p> : <form onSubmit={remove}><label>Reason<input required minLength={5} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label><button type="submit" disabled={busy}>{busy ? 'Removing…' : 'Remove test tenant'}</button></form>}

    </details>
  </section>;
}
