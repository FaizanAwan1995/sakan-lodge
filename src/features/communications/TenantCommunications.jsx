import { useMemo, useState } from 'react';
import { eligibleRecipients, uniqueRecipientEmails, hasUnfilledPlaceholders, isValidTenantEmail } from './email-utils.js';

export default function TenantCommunications({ db, today }) {
  const [propertyId, setPropertyId] = useState('');
  const [search, setSearch] = useState('');
  const [cc, setCc] = useState('faizanasif117@gmail.com, danish.mihm@gmail.com');
  const [sender, setSender] = useState('sakanlodges@gmail.com');
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [template, setTemplate] = useState('general');
  const templates = {
    general: { subject: '', body: '' },
    inspection: { subject: 'Routine property inspection notice', body: 'Dear tenant,\\n\\nWe are writing to notify you of an upcoming routine property inspection. Inspection date and time: [ENTER DATE AND TIME].\\n\\nPlease contact Sakan Lodge if you have any questions.\\n\\nKind regards,\\nSakan Lodge' },
    reminder: { subject: 'Reminder: upcoming routine property inspection', body: 'Dear tenant,\\n\\nThis is a reminder of the upcoming routine inspection at your property. Date and time: [ENTER DATE AND TIME].\\n\\nKind regards,\\nSakan Lodge' },
    receipt: { subject: 'Rent receipt — Sakan Lodge', body: 'Dear tenant,\\n\\nThank you for your rent payment.\\n\\nPayment date: [VERIFY PAYMENT DATE]\\nAmount received: [VERIFY AMOUNT]\\nPeriod covered: [VERIFY PERIOD]\\n\\nKind regards,\\nSakan Lodge' },
    checkout: { subject: 'Tenancy checkout confirmation', body: 'Dear tenant,\\n\\nThis email confirms your tenancy checkout arrangements.\\n\\nCheckout date: [VERIFY DATE]\\nKeys and room condition: [ADD DETAILS]\\nBond settlement: [CONFIRM SEPARATELY]\\n\\nKind regards,\\nSakan Lodge' },
    onboarding: { subject: 'Sakan Lodge — tenant onboarding details', body: 'Dear tenant,\\n\\nWelcome to Sakan Lodge. Please review the onboarding details and form, which will be provided separately.\\n\\n[FORM TEMPLATE TO BE ADDED]\\n\\nKind regards,\\nSakan Lodge' },
  };
  const chooseTemplate = (value) => {
    setTemplate(value);
    setSubject(templates[value].subject);
    setMessage(templates[value].body);
    setPreview(false);
  };
  const tenants = useMemo(() => db.people.filter((p) => (!p.end_date || p.end_date > today) && (!propertyId || String(p.property_id) === String(propertyId))), [db.people, today, propertyId]);
  const recipients = useMemo(() => eligibleRecipients(db.people, today, propertyId), [db.people, today, propertyId]);
  const visibleTenants = tenants.filter((p) => [p.name, p.email, db.rooms.find((r) => String(r.id) === String(p.room_id))?.label].some((v) => String(v || '').toLowerCase().includes(search.trim().toLowerCase())));
  const propertyName = (id) => db.properties.find((p) => String(p.id) === String(id))?.name || 'Unknown property';
  const missingEmails = tenants.filter((p) => !isValidTenantEmail(p.email));
  const chosen = recipients.filter((p) => selected.includes(String(p.id)));
  const allSelected = recipients.length > 0 && chosen.length === recipients.length;
  const emailList = uniqueRecipientEmails(chosen);
  const ccEmails = [...new Set(cc.split(/[;,\n]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const ccValid = ccEmails.every(isValidTenantEmail);
  const canCompose = emailList.length > 0 && subject.trim() && message.trim() && !hasUnfilledPlaceholders(message) && ccValid;
  const send = () => {
    if (!canCompose) return;
    const fields = { subject: subject.trim(), body: message.trim() };
    if (ccEmails.length) fields.cc = ccEmails.join(',');
    if (emailList.length > 1) fields.bcc = emailList.join(',');
    const query = new URLSearchParams(fields);
    window.location.href = 'mailto:' + (emailList.length === 1 ? encodeURIComponent(emailList[0]) : '') + '?' + query.toString();
  };
  return <section className="card">
    <h1>Tenant emails</h1>
    <p>Internal staff composer for Faizan and Danish. Choose tenants from existing resident records; tenants never log into Sakan Lodge. Your email app opens for final review and sending.</p>
    <p role="note"><strong>Sender:</strong> {sender}. To send from this address, sign in to that Gmail account in your email app or configure it as an authorised sending alias. The app cannot force the From address.</p>
    <label>Property
      <select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setSelected([]); setPreview(false); }}>
        <option value="">All properties (review carefully)</option>
        {db.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <p>{tenants.length} active tenant(s) at the selected property; {recipients.length} with valid email addresses saved in their tenant records.</p>
    {missingEmails.length > 0 && <p role="status">{missingEmails.length} tenant(s) cannot receive emails until their address is added or corrected in Rooms → resident record.</p>}
    <h2>Choose individual tenants</h2>
    <label>Search by name, email or room<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Chauhan Zaman or MZ Avinash" /></label>
    <label><input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? recipients.map((p) => String(p.id)) : [])} /> Select all eligible tenants in this view</label>
    <div style={{ maxHeight: 260, overflowY: 'auto', margin: '1rem 0' }}>
      {visibleTenants.map((p) => <label key={p.id} style={{ display: 'block', padding: '0.4rem 0' }}>
        <input type="checkbox" disabled={!isValidTenantEmail(p.email)} checked={selected.includes(String(p.id))} onChange={(e) => setSelected((old) => e.target.checked ? [...old, String(p.id)] : old.filter((id) => id !== String(p.id)))} />
        {' '}{p.name} · {propertyName(p.property_id)} · {db.rooms.find((r) => String(r.id) === String(p.room_id))?.label || 'Room not assigned'} — {isValidTenantEmail(p.email) ? p.email.trim() : 'No valid email saved (edit resident record)'}
      </label>)}
    </div>
    <p>{chosen.length} tenant(s) selected across {new Set(chosen.map((p) => String(p.property_id))).size} property/properties.</p>
    <label>CC (Faizan and Danish; separate addresses with commas)<input type="text" value={cc} onChange={(e) => { setCc(e.target.value); setPreview(false); }} placeholder="faizan@example.com, danish@example.com" /></label>
    {!ccValid && <p role="alert" className="err">Please correct the CC email addresses.</p>}
    <label>Email purpose
      <select value={template} onChange={(e) => chooseTemplate(e.target.value)}>
        <option value="general">General notice</option>
        <option value="inspection">Quarterly inspection notice</option>
        <option value="reminder">Inspection reminder</option>
        <option value="receipt">Rent receipt</option>
        <option value="checkout">Checkout confirmation</option>
        <option value="onboarding">Tenant onboarding (form pending)</option>
      </select>
    </label>
    {template !== 'general' && <p>Review and replace all bracketed placeholders before opening your email app. Receipts must be checked against the recorded payment. Inspection notices must meet applicable notice requirements.</p>}
    <label>Subject<input value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(false); }} placeholder="e.g. Property notice" /></label>
    <label>Message<textarea rows={7} value={message} onChange={(e) => { setMessage(e.target.value); setPreview(false); }} placeholder="Write your message to tenants" /></label>
    {hasUnfilledPlaceholders(message) && <p role="alert">Replace all bracketed template placeholders before preparing this email.</p>}
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
      <button type="button" disabled={!canCompose} onClick={() => setPreview(true)}>Preview email</button>
      {preview && <button type="button" onClick={send}>Open in email app ({emailList.length})</button>}
    </div>
    {preview && <div className="card" style={{ marginTop: '1rem', overflowWrap: 'anywhere' }}>
      <h2>Review before sending</h2>
      <p><strong>From (configure in your email app):</strong> {sender}</p>
      <p><strong>Recipients ({emailList.length > 1 ? 'BCC' : 'To'}):</strong> {emailList.join(', ')}</p>
      <p><strong>CC:</strong> {ccEmails.join(', ') || 'None'}</p>
      <p><strong>Subject:</strong> {subject}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{message}</p>
      <p>For large groups, your email application's recipient limits may apply. No emails are sent until you confirm in your email application.</p>
    </div>}
  </section>;
}
