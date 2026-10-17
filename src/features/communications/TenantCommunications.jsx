import { useMemo, useState } from 'react';
import { supabase, isLocalMode } from '../../store.js';
import { eligibleRecipients, uniqueRecipientEmails, hasUnfilledPlaceholders, isValidTenantEmail } from './email-utils.js';

export default function TenantCommunications({ db, today }) {
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailError, setGmailError] = useState('');
  const connectGmail = async () => {
    if (!supabase || isLocalMode) return;
    setGmailBusy(true);
    setGmailError('');
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.access_token) throw new Error('Please sign in again.');
      const response = await fetch('/api/gmail/start', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token }
      });
      const raw = await response.text();
      let payload = {};
      try { payload = JSON.parse(raw); } catch { /* Server may return plain-text errors. */ }
      if (!response.ok || !payload.url) throw new Error(payload.error || (!response.ok && raw && raw.length < 180 ? raw : 'Gmail connection is not available yet.'));
      if (!payload.url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')) throw new Error('Unexpected authorisation destination.');
      window.location.assign(payload.url);
    } catch (error) {
      setGmailError(error.message || 'Unable to start Gmail connection.');
      setGmailBusy(false);
    }
  };
  const [propertyId, setPropertyId] = useState('');
  const [search, setSearch] = useState('');
  const [cc, setCc] = useState('faizanasif117@gmail.com, danish.mihm@gmail.com');
  const sender = 'sakanlodges@gmail.com';
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [template, setTemplate] = useState('general');
  const templates = {
    general: { subject: '', body: '' },
    inspection: { subject: 'Routine property inspection notice', body: 'Dear tenant,\n\nWe are writing to notify you of an upcoming routine property inspection. Inspection date and time: [ENTER DATE AND TIME].\n\nPlease contact Sakan Lodge if you have any questions.\n\nKind regards,\nSakan Lodge' },
    reminder: { subject: 'Reminder: upcoming routine property inspection', body: 'Dear tenant,\n\nThis is a reminder of the upcoming routine inspection at your property. Date and time: [ENTER DATE AND TIME].\n\nKind regards,\nSakan Lodge' },
    receipt: { subject: 'Rent receipt — Sakan Lodge', body: 'Dear tenant,\n\nThank you for your rent payment.\n\nPayment date: [VERIFY PAYMENT DATE]\nAmount received: [VERIFY AMOUNT]\nPeriod covered: [VERIFY PERIOD]\n\nKind regards,\nSakan Lodge' },
    checkout: { subject: 'Tenancy checkout confirmation', body: 'Dear tenant,\n\nThis email confirms your tenancy checkout arrangements.\n\nCheckout date: [VERIFY DATE]\nKeys and room condition: [ADD DETAILS]\nBond settlement: [CONFIRM SEPARATELY]\n\nKind regards,\nSakan Lodge' },
    onboarding: { subject: 'Sakan Lodge — tenant onboarding details', body: 'Dear tenant,\n\nWelcome to Sakan Lodge. Please review the onboarding details and form, which will be provided separately.\n\n[FORM TEMPLATE TO BE ADDED]\n\nKind regards,\nSakan Lodge' },
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
  return <section className="card tenant-communications" style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, maxWidth: 1080, margin: '0 auto', padding: 'clamp(1rem, 3vw, 2rem)' }}>
    <style>{`.tenant-communications { overflow-wrap: anywhere; } .tenant-communications input:not([type="checkbox"]), .tenant-communications select, .tenant-communications textarea { max-width: 100%; min-width: 0; box-sizing: border-box; font-size: 16px; } .tenant-communications button { min-height: 44px; max-width: 100%; white-space: normal; } .tenant-communications input[type="checkbox"] { width: 18px; height: 18px; flex: 0 0 auto; vertical-align: middle; } .tenant-communications label { overflow-wrap: anywhere; } @media (max-width: 600px) { .tenant-communications { padding: 16px !important; } .tenant-communications h1 { font-size: clamp(1.55rem, 7vw, 2rem); } .tenant-communications button { width: 100%; } }`}</style>
    <header style={{ marginBottom: '1.5rem' }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '.12em', fontSize: '.75rem', fontWeight: 700, opacity: .65, marginBottom: '.35rem' }}>Sakan Lodge · Communications</p>
      <h1 style={{ margin: 0 }}>Tenant emails</h1>
      <p style={{ marginTop: '.5rem', opacity: .8 }}>Choose recipients, prepare a notice and review it before opening your email app.</p>
    </header>
    {!isLocalMode && <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem', border: '1px solid var(--border, #d8dfd8)', borderRadius: 14, background: 'var(--surface, #f6f9f6)' }}>
      <h2 style={{ marginTop: 0 }}>Connect business Gmail</h2>
      <p>Authorise <strong>sakanlodges@gmail.com</strong> for future direct sending. The composer below currently opens your email app; connecting Gmail does not send messages automatically.</p>
      <button type="button" disabled={gmailBusy} aria-busy={gmailBusy} onClick={connectGmail}>{gmailBusy ? 'Opening Google…' : 'Connect Sakan Lodge Gmail'}</button>
      {gmailError && <p role="alert" className="err">{gmailError}</p>}
    </div>}
    <h2 style={{ marginTop: '1.5rem' }}>1. Select recipients</h2>
    <p style={{ opacity: .75 }}>Only Faizan and Danish can use this internal composer. Tenants never log in.</p>
    <p style={{ padding: '.75rem 1rem', borderRadius: 10, background: 'var(--surface, #f4f7f4)' }}><strong>Preferred sender:</strong> {sender}. Confirm this account is selected in your email app before sending.</p>
    <label>Property
      <select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setSelected([]); setPreview(false); }}>
        <option value="">All properties (review carefully)</option>
        {db.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <p aria-live="polite" style={{ fontWeight: 600 }}>{tenants.length} active tenants · {recipients.length} valid email addresses · {chosen.length} selected</p>
    {missingEmails.length > 0 && <p role="status">{missingEmails.length} tenant(s) cannot receive emails until their address is added or corrected in Rooms → resident record.</p>}
    <h3 style={{ marginBottom: '.5rem' }}>Choose individual tenants</h3>
    <label>Search by name, email or room<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Chauhan Zaman or MZ Avinash" /></label>
    <label><input type="checkbox" checked={allSelected} onChange={(e) => { setSelected(e.target.checked ? recipients.map((p) => String(p.id)) : []); setPreview(false); }} /> Select all eligible tenants at this property (including search-hidden tenants)</label>
    <div style={{ maxHeight: 300, overflowY: 'auto', margin: '1rem 0', padding: '.5rem', border: '1px solid var(--border, #d8dfd8)', borderRadius: 12 }}>
      {visibleTenants.length === 0 && <p style={{ padding: '.75rem' }}>No matching tenants. Try a different search or property.</p>}
      {visibleTenants.map((p) => <label key={p.id} style={{ display: 'block', padding: '.65rem .5rem', borderBottom: '1px solid var(--border, #edf0ed)', cursor: 'pointer' }}>
        <input type="checkbox" disabled={!isValidTenantEmail(p.email)} checked={selected.includes(String(p.id))} onChange={(e) => { setSelected((old) => e.target.checked ? [...old, String(p.id)] : old.filter((id) => id !== String(p.id))); setPreview(false); }} />
        {' '}{p.name} · {propertyName(p.property_id)} · {db.rooms.find((r) => String(r.id) === String(p.room_id))?.label || 'Room not assigned'} — {isValidTenantEmail(p.email) ? p.email.trim() : 'No valid email saved (edit resident record)'}
      </label>)}
    </div>
    <p aria-live="polite">{chosen.length} tenant(s) selected across {new Set(chosen.map((p) => String(p.property_id))).size} property/properties.</p>
    <h2 style={{ marginTop: '1.75rem' }}>2. Compose message</h2>
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
    <h2 style={{ marginTop: '1.75rem' }}>3. Review and open</h2>
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
      <button type="button" disabled={!canCompose} onClick={() => setPreview(true)}>Preview email</button>
      {preview && <button type="button" onClick={send}>Open in email app ({emailList.length})</button>}
    </div>
    {preview && <div className="card" style={{ marginTop: '1rem', overflowWrap: 'anywhere', border: '1px solid var(--border, #d8dfd8)', borderRadius: 12, padding: '1.25rem' }}>
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
