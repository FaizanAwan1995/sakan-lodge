import { useState } from 'react';
import { supabase, isLocalMode } from '../../store.js';

export default function AdminTenantActions({ person, reload, allowCheckout = true }) {
  const [mode, setMode] = useState('');
  const [amount, setAmount] = useState(person.owed || 0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const checkout = mode === 'checkout_now';

  if (isLocalMode) return <p className="muted">Immediate checkout and audited credits require the shared ledger.</p>;

  function open(action) {
    setMode(action);
    setAmount(person.owed || 0);
    setReason('');
    setError('');
    setSuccess('');
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (reason.trim().length < 5) {
      setError('Enter a reason of at least five characters.');
      return;
    }
    const credit = Number(amount);
    if (!checkout && (!Number.isFinite(credit) || credit <= 0 || credit > person.owed || !/^\d+(?:\.\d{1,2})?$/.test(String(amount)))) {
      setError('Enter a credit within the outstanding balance, with no more than two decimal places.');
      return;
    }
    if (!confirm(checkout
      ? `Check ${person.name} out now and free the room? Rent already due and bond records remain; this does not clear the balance.`
      : `Credit $${credit.toFixed(2)} against ${person.name}'s balance? This is not money received.`)) return;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.rpc('admin_tenant_action', {
        p_id: person.id,
        p_action: mode,
        p_amount: checkout ? null : credit,
        p_reason: reason.trim(),
        p_expected: person.owed,
      });
      if (error) throw error;
      setMode('');
      setReason('');
      setSuccess(checkout ? 'Checkout saved. The room has been freed.' : `Balance credit of $${credit.toFixed(2)} saved.`);
      await reload();
    } catch (error) {
      setError(error.message || 'Unable to save. Refresh and check the account before retrying.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="admin-tenant-actions" aria-busy={busy}>
    {allowCheckout && !person.checked_out_at && <button type="button" className="small checkout-button" disabled={busy} onClick={() => open('checkout_now')}>Check out now</button>}
    {person.owed > 0 && <button type="button" className="small" disabled={busy} onClick={() => open('clear_balance')}>Clear outstanding balance</button>}
    {error && <p className="err" role="alert">{error}</p>}
    {success && <p className="ok" role="status">{success}</p>}
    {mode && <form onSubmit={submit}>
      <h3>{checkout ? 'Immediate checkout' : 'Admin balance credit'}</h3>
      <p>{checkout ? 'The room is freed immediately. A same-day departure retains the existing minimum-night billing; you can separately clear any amount owed.' : 'Original charges and payments stay in the account. This adjustment reduces the balance without recording a payment. Bond is unchanged.'}</p>
      {!checkout && <label>Credit amount (maximum ${person.owed.toFixed(2)})<input type="number" min="0.01" max={person.owed} step="0.01" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} required /></label>}
      <label>Reason<input value={reason} disabled={busy} onChange={event => setReason(event.target.value)} minLength={5} placeholder="Explain why this action is needed" required /></label>
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : checkout ? 'Confirm immediate checkout' : 'Confirm balance credit'}</button>
      <button type="button" disabled={busy} onClick={() => { setMode(''); setError(''); }}>Cancel</button>
    </form>}
  </div>;
}
