import { tenantReference } from '../../tenant-model.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isLocalMode } from '../../store.js';
import { eligibleRecipients, uniqueRecipientEmails, hasUnfilledPlaceholders, isValidTenantEmail } from './email-utils.js';

export default function TenantCommunications({ db, today }) {
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailError, setGmailError] = useState('');
  const [gmailConnected, setGmailConnected] = useState(() => new URLSearchParams(window.location.search).get('gmail') === 'connected');
  const [showGmailSettings, setShowGmailSettings] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('gmail')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('gmail');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  }, []);
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
  const [expandedProperties, setExpandedProperties] = useState([]);
  const [search, setSearch] = useState('');
  const [customRecipients, setCustomRecipients] = useState('');
  const sendLock = useRef(false);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const sender = preview?.sender || 'Connected business Gmail account';
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sentConfirmation, setSentConfirmation] = useState('');
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
  const tenants = useMemo(() => db.people.filter((p) => p.start_date <= today && (!p.end_date || p.end_date > today)), [db.people, today]);
  const recipients = useMemo(() => eligibleRecipients(db.people, today, ''), [db.people, today]);
  const chosen = recipients.filter((p) => selected.includes(String(p.id)));
  const propertyGroups = db.properties.map((property) => {
    const residents = tenants.filter((person) => String(person.property_id) === String(property.id));
    const eligible = residents.filter((person) => isValidTenantEmail(person.email));
    const selectedCount = eligible.filter((person) => selected.includes(String(person.id))).length;
    return { property, residents, eligible, selectedCount };
  });
  const missingEmails = tenants.filter((p) => !isValidTenantEmail(p.email));
  const toggleProperty = (group, checked) => {
    const ids = group.eligible.map((p) => String(p.id));
    setSelected((old) => checked ? [...new Set([...old, ...ids])] : old.filter((id) => !ids.includes(id)));
    setPreview(false);
  };
  const customEmails = customRecipients.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const invalidCustomEmails = customEmails.filter((email) => !isValidTenantEmail(email));
  const emailList = [...new Set([...uniqueRecipientEmails(chosen), ...customEmails])];
  const draft = { recipients: emailList, subject: subject.trim(), body: message.trim() };
  const draftKey = JSON.stringify(draft);
  const reviewed = preview && preview.draftKey === draftKey;
  const canCompose = emailList.length > 0 && emailList.length <= 100 && subject.trim() && subject.length <= 250 && message.trim() && message.length <= 60000 && !/[\r\n]/.test(subject) && !hasUnfilledPlaceholders(subject) && !hasUnfilledPlaceholders(message) && invalidCustomEmails.length === 0;
  const preparePreview = async () => {
    if (!canCompose || preparing || needsReconciliation || isLocalMode || !supabase) return;
    setPreparing(true); setSendError(''); setPreview(false);
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.access_token) throw new Error('Please sign in again.');
      const response = await fetch('/api/gmail/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify(draft),
      });
      const result = await response.json();
      if (!response.ok || !result.reviewId) throw new Error(result.error || 'Unable to prepare email preview.');
      setPreview({ ...result, draftKey });
    } catch (error) { setSendError(error.message || 'Unable to prepare email preview.'); }
    finally { setPreparing(false); }
  };
  const send = async () => {
    if (!reviewed || !canCompose || sendLock.current || needsReconciliation || isLocalMode || !supabase) return;
    if (!window.confirm(`Send this email to ${emailList.length} recipient(s) from ${sender}? This action cannot be undone.`)) return;
    sendLock.current = true;
    setSending(true);
    setSendError('');
    setSentConfirmation('');
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.access_token) throw new Error('Please sign in again.');
      const response = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ reviewId: preview.reviewId, confirmation: 'SEND_REVIEWED_EMAIL' })
      });
      const result = await response.json();
      if (!response.ok || !result.sent) throw new Error(result.error || 'Gmail could not confirm sending.');
      setSentConfirmation(`Email sent successfully to ${result.recipientCount} recipient(s). Gmail message ID: ${result.messageId}${result.logged ? ' · Recorded in Activity.' : ' · Activity logging failed; email was sent. Please retain the Gmail message ID.'}`);
      setPreview(false);
      setSelected([]);
      setCustomRecipients('');
      setSubject('');
      setMessage('');
      setTemplate('general');
    } catch (error) {
      setNeedsReconciliation(true);
      setPreview(false);
      setSendError((error.message || 'Unable to confirm sending.') + ' Check Gmail Sent Mail before preparing another email.');
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  };
  return <section className="card tenant-communications" style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, maxWidth: 1080, margin: '0 auto', padding: 'clamp(1rem, 3vw, 2rem)' }}>
    <style>{`.tenant-communications { overflow-wrap: anywhere; } .tenant-communications input:not([type="checkbox"]), .tenant-communications select, .tenant-communications textarea { max-width: 100%; min-width: 0; box-sizing: border-box; font-size: 16px; } .tenant-communications button { min-height: 44px; max-width: 100%; white-space: normal; } .tenant-communications input[type="checkbox"] { width: 18px; height: 18px; flex: 0 0 auto; vertical-align: middle; } .tenant-communications label { overflow-wrap: anywhere; } @media (max-width: 600px) { .tenant-communications { padding: 16px !important; } .tenant-communications h1 { font-size: clamp(1.55rem, 7vw, 2rem); } .tenant-communications button { width: 100%; } }`}</style>
    <header style={{ marginBottom: '1.5rem' }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '.12em', fontSize: '.75rem', fontWeight: 700, opacity: .65, marginBottom: '.35rem' }}>Sakan Lodge · Communications</p>
      <h1 style={{ margin: 0 }}>Tenant emails</h1>
      <p style={{ marginTop: '.5rem', opacity: .8 }}>Select recipients, compose your message and review before sending.</p>
    </header>
    {gmailConnected && <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '.75rem 1rem', marginBottom: '1rem', borderRadius: 12, background: '#e8f3ea', color: '#235c3e' }}>
      <span><strong>Gmail connected.</strong> Connection completed. Prepare a preview to check the stored sender.</span>
      <button type="button" aria-label="Dismiss Gmail confirmation" onClick={() => setGmailConnected(false)} style={{ width: 'auto', minHeight: 36, flexShrink: 0 }}>Dismiss</button>
    </div>}
    {!isLocalMode && <div style={{ marginBottom: '1.25rem' }}>
      <button type="button" onClick={() => setShowGmailSettings((value) => !value)} aria-expanded={showGmailSettings} style={{ width: 'auto' }}>{showGmailSettings ? 'Hide Gmail settings' : 'Gmail settings'}</button>
      {showGmailSettings && <div className="card" style={{ marginTop: '.75rem', padding: '1rem', borderRadius: 12 }}>
        <p style={{ marginTop: 0 }}><strong>Business account:</strong> {sender}</p>
        <p style={{ opacity: .75 }}>Reconnect only if access needs to be renewed. Direct sending uses this connected Gmail account.</p>
        <button type="button" disabled={gmailBusy} aria-busy={gmailBusy} onClick={connectGmail}>{gmailBusy ? 'Opening Google…' : 'Reconnect Gmail'}</button>
        {gmailError && <p role="alert" className="err">{gmailError}</p>}
      </div>}
    </div>}
    <h2 style={{ marginTop: '1.25rem' }}>1. Recipients</h2>
    <p style={{ opacity: .75 }}>Select tenants, enter other email addresses, or use both.</p>
    <p aria-live="polite" style={{ fontWeight: 600, margin: '.75rem 0' }}>{chosen.length} tenant(s) selected · {recipients.length} eligible across {db.properties.length} properties</p>
    <label>Find a tenant<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or room" /></label>
    <div style={{ display: 'grid', gap: '.65rem', marginTop: '1rem', marginBottom: '1.25rem' }}>
      {propertyGroups.map((group) => {
        const id = String(group.property.id);
        const matching = group.residents.filter((person) => [person.name, person.id, person.email, db.rooms.find((room) => String(room.id) === String(person.room_id))?.label].some((value) => String(value || '').toLowerCase().includes(search.trim().toLowerCase())));
        const expanded = expandedProperties.includes(id) || (search.trim().length > 0 && matching.length > 0);
        return <div key={id} style={{ border: '1px solid var(--border, #d8dfd8)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', padding: '.7rem .85rem', background: 'var(--surface, #f4f7f4)' }}>
            <input type="checkbox" aria-label={`Select all eligible tenants at ${group.property.name}`} checked={group.eligible.length > 0 && group.selectedCount === group.eligible.length} ref={(node) => { if (node) node.indeterminate = group.selectedCount > 0 && group.selectedCount < group.eligible.length; }} disabled={group.eligible.length === 0} onChange={(e) => toggleProperty(group, e.target.checked)} style={{ width: 20, height: 20, flexShrink: 0 }} />
            <button type="button" aria-expanded={expanded} onClick={() => setExpandedProperties((old) => old.includes(id) ? old.filter((value) => value !== id) : [...old, id])} style={{ flex: 1, width: 'auto', minWidth: 0, textAlign: 'left', background: 'transparent', border: 0, padding: '.2rem', fontWeight: 700 }}>
              {group.property.name} <span style={{ fontWeight: 400, opacity: .75 }}>({group.selectedCount}/{group.eligible.length})</span> <span aria-hidden="true" style={{ float: 'right' }}>{expanded ? '▴' : '▾'}</span>
            </button>
          </div>
          {expanded && <div style={{ padding: '.4rem .85rem .7rem' }}>
            {matching.length === 0 && <p style={{ opacity: .7 }}>No matching tenants.</p>}
            {matching.map((person) => <label key={person.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '.7rem', padding: '.65rem 0', borderBottom: '1px solid var(--border, #edf0ed)' }}>
              <input type="checkbox" disabled={!isValidTenantEmail(person.email)} checked={selected.includes(String(person.id))} onChange={(e) => { setSelected((old) => e.target.checked ? [...new Set([...old, String(person.id)])] : old.filter((value) => value !== String(person.id))); setPreview(false); }} style={{ width: 20, height: 20, flexShrink: 0, marginTop: 3 }} />
              <span style={{ minWidth: 0 }}><strong>{person.name}</strong><small className="tenant-reference" style={{display:'block'}}>Tenant ID {tenantReference(person)}</small><span style={{ display: 'block', opacity: .7, fontSize: '.85rem' }}>{db.rooms.find((room) => String(room.id) === String(person.room_id))?.label || 'Room not assigned'} · {isValidTenantEmail(person.email) ? person.email : 'Email missing or invalid'}</span></span>
            </label>)}
          </div>}
        </div>;
      })}
    </div>
    {missingEmails.length > 0 && <p style={{ opacity: .7, fontSize: '.85rem' }}>{missingEmails.length} active tenants have no valid email saved and cannot be selected.</p>}
    <label>Additional recipients (optional)
      <textarea rows={2} value={customRecipients} onChange={(e) => { setCustomRecipients(e.target.value); setPreview(false); }} placeholder="name@example.com, another@example.com" />
    </label>
    <p style={{ opacity: .7, marginTop: '.25rem' }}>Separate addresses with commas, spaces or new lines. Duplicate addresses are removed.</p>
    {invalidCustomEmails.length > 0 && <p role="alert" className="err">Please correct the additional recipient email addresses before continuing.</p>}
    <p aria-live="polite"><strong>{emailList.length} unique recipient(s)</strong> ready for review.</p>
    <h2 style={{ marginTop: '1.75rem' }}>2. Compose message</h2>
    <p><strong>CC (automatic):</strong> {reviewed ? preview.cc.join(', ') : 'Approved staff addresses are resolved when preparing the preview.'}</p>
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
    {template !== 'general' && <p>Review and replace all bracketed placeholders before sending. Receipts must be checked against the recorded payment. Inspection notices must meet applicable notice requirements.</p>}
    <label>Subject<input value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(false); }} placeholder="e.g. Property notice" /></label>
    <label>Message<textarea rows={7} value={message} onChange={(e) => { setMessage(e.target.value); setPreview(false); }} placeholder="Write your message to tenants" /></label>
    {(hasUnfilledPlaceholders(subject) || hasUnfilledPlaceholders(message)) && <p role="alert">Replace all bracketed template placeholders before preparing this email.</p>}
    <h2 style={{ marginTop: '1.75rem' }}>3. Review and send</h2>
    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
      <button type="button" disabled={!canCompose || preparing || sending || needsReconciliation || isLocalMode} onClick={preparePreview}>{preparing ? 'Preparing…' : 'Preview email'}</button>
      {reviewed && !isLocalMode && <button type="button" disabled={!canCompose || sending} onClick={send}>{sending ? 'Sending…' : `Confirm & Send (${emailList.length})`}</button>}
    </div>
    {needsReconciliation && <button type="button" onClick={() => { if (window.confirm('Have you checked Gmail Sent Mail and confirmed that another send is necessary?')) { setNeedsReconciliation(false); setSendError(''); } }}>I checked Sent Mail — allow another preview</button>}
    {sendError && <p role="alert" className="err">{sendError}</p>}
    {sentConfirmation && <p role="status" style={{ color: '#235c3e', fontWeight: 700 }}>{sentConfirmation}</p>}
    {reviewed && <div className="card" style={{ marginTop: '1rem', overflowWrap: 'anywhere', border: '1px solid var(--border, #d8dfd8)', borderRadius: 12, padding: '1.25rem' }}>
      <h2>Review before sending</h2>
      <p><strong>From:</strong> {sender}</p>
      <p><strong>Recipients (BCC):</strong> {preview.recipients.join(', ')}</p>
      <p><strong>CC (automatic):</strong> {reviewed ? preview.cc.join(', ') : 'Approved staff addresses are resolved when preparing the preview.'}</p>
      <p><strong>Subject:</strong> {preview.subject}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{preview.body}</p>
      <p>No email is sent until you press Confirm & Send and approve the final confirmation.</p>
    </div>}
  </section>;
}
