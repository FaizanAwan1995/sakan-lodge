import { useMemo, useState } from 'react';
import { isActive } from '../../ledger.js';

export function eligibleRecipients(people, today, propertyId = '') {
  return people.filter((person) =>
    isActive(person, today) &&
    (!propertyId || String(person.property_id) === String(propertyId)) &&
    typeof person.email === 'string' &&
    /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(person.email.trim())
  );
}

export default function TenantCommunications({ db, today }) {
  const [propertyId, setPropertyId] = useState('');
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const recipients = useMemo(() => eligibleRecipients(db.people, today, propertyId), [db.people, today, propertyId]);
  const chosen = recipients.filter((p) => selected.includes(String(p.id)));
  const allSelected = recipients.length > 0 && chosen.length === recipients.length;
  const emailList = [...new Set(chosen.map((p) => p.email.trim().toLowerCase()))];
  const send = () => {
    if (!emailList.length || !subject.trim() || !message.trim()) return;
    const query = new URLSearchParams({ bcc: emailList.join(','), subject: subject.trim(), body: message.trim() });
    window.location.href = 'mailto:?' + query.toString();
  };
  return <section className="card">
    <h1>Tenant emails</h1>
    <p>Prepare an individual or property-wide email. Your email app opens for final review and sending; Sakan Lodge does not send or track messages.</p>
    <label>Property
      <select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setSelected([]); setPreview(false); }}>
        <option value="">All properties</option>
        {db.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <p>{recipients.length} active tenant(s) with valid email addresses.</p>
    <label><input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? recipients.map((p) => String(p.id)) : [])} /> Select all eligible tenants in this view</label>
    <div style={{ maxHeight: 260, overflowY: 'auto', margin: '1rem 0' }}>
      {recipients.map((p) => <label key={p.id} style={{ display: 'block', padding: '0.4rem 0' }}>
        <input type="checkbox" checked={selected.includes(String(p.id))} onChange={(e) => setSelected((old) => e.target.checked ? [...old, String(p.id)] : old.filter((id) => id !== String(p.id)))} />
        {' '}{p.name} — {p.email}
      </label>)}
    </div>
    <label>Subject<input value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(false); }} placeholder="e.g. Property notice" /></label>
    <label>Message<textarea rows={7} value={message} onChange={(e) => { setMessage(e.target.value); setPreview(false); }} placeholder="Write your message to tenants" /></label>
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
      <button type="button" disabled={!emailList.length || !subject.trim() || !message.trim()} onClick={() => setPreview(true)}>Preview email</button>
      {preview && <button type="button" onClick={send}>Open in email app ({emailList.length})</button>}
    </div>
    {preview && <div className="card" style={{ marginTop: '1rem', overflowWrap: 'anywhere' }}>
      <h2>Review before sending</h2>
      <p><strong>Recipients (BCC):</strong> {emailList.join(', ')}</p>
      <p><strong>Subject:</strong> {subject}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{message}</p>
      <p>For large groups, your email application's recipient limits may apply. No emails are sent until you confirm in your email application.</p>
    </div>}
  </section>;
}
