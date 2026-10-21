import { classifyStay } from './accommodation-rules.js';

// The ledger's historical "long" value means weekly rent on the house cycle.
// Keep old "short" records nightly: changing their interpretation rewrites debt.
export function residentStayOption(person) {
  if (['short', 'per_night'].includes(person.stay_type)) return 'per_night';
  if (person.start_date && person.end_date) {
    try { if (classifyStay(person.start_date, person.end_date) === 'short') return 'short_weekly'; } catch { /* Form validates dates. */ }
  }
  return 'long';
}

export function residentBillingRow(row) {
  if (row.stay_type === 'short_weekly') {
    if (!row.end_date || row.end_date <= row.start_date) throw Error('Short-term stays need a check-out date after move-in.');
    return { ...row, stay_type: 'long', nightly_rate: null };
  }
  if (row.stay_type === 'long') return { ...row, nightly_rate: null };
  return { ...row, rent_cycle_anchor: null };
}
